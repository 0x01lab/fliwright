import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readWorkspaceConfig, type FliwrightDriver } from '@fliwright/core';
import type { ServerState } from '../state.js';

export const ConnectParamsSchema = z.object({
  vmServiceUrl: z.string().optional().describe(
    'Optional Dart VM Service URL from `flutter run`, e.g. "http://127.0.0.1:54321/xxxx/". If omitted, Fliwright MCP reuses the current connection, env, or .fliwright/config.json.',
  ),
});

export interface ResolvedVmServiceUrl {
  vmServiceUrl: string;
  source: 'argument' | 'state' | 'env:FLIWRIGHT_VM_URL' | 'env:FLIWRIGHT_VM_SERVICE_URL' | 'workspace-config';
}

export interface ConnectOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  driverFactory?: () => FliwrightDriver | Promise<FliwrightDriver>;
}

export interface ConnectResult {
  connected: boolean;
  message: string;
  vmServiceUrl: string;
  source: ResolvedVmServiceUrl['source'];
}

export async function handleConnect(
  params: z.infer<typeof ConnectParamsSchema>,
  state: ServerState,
  options: ConnectOptions = {},
): Promise<ConnectResult> {
  const input = ConnectParamsSchema.parse(params ?? {});
  const resolved = await resolveMcpVmServiceUrl({
    explicit: input.vmServiceUrl,
    state,
    cwd: options.cwd,
    env: options.env,
  });
  // Dispose previous driver if any
  const prev = state.getDriver();
  if (prev) {
    try { await prev.dispose(); } catch { /* ignore */ }
    state.setDriver(null);
  }

  // Convert http:// → ws:// for VM Service WebSocket
  const wsUrl = toWebSocketUrl(resolved.vmServiceUrl);

  const driver = options.driverFactory
    ? await options.driverFactory()
    : await createDefaultDriver();
  await driver.connect(wsUrl);

  state.setDriver(driver);
  state.setVmServiceUrl(resolved.vmServiceUrl);

  return {
    connected: true,
    message: `Connected to Flutter app at ${resolved.vmServiceUrl}`,
    vmServiceUrl: resolved.vmServiceUrl,
    source: resolved.source,
  };
}

export async function ensureConnected(
  state: ServerState,
  options: ConnectOptions = {},
): Promise<FliwrightDriver> {
  const existing = state.getDriver();
  if (existing) return existing;
  await handleConnect({}, state, options);
  const driver = state.getDriver();
  if (!driver) throw new Error('Fliwright MCP could not create a driver connection.');
  return driver;
}

export async function resolveMcpVmServiceUrl(options: {
  explicit?: string;
  state?: ServerState;
  cwd?: string;
  env?: Record<string, string | undefined>;
}): Promise<ResolvedVmServiceUrl> {
  const explicit = cleanUrl(options.explicit);
  if (explicit) return { vmServiceUrl: explicit, source: 'argument' };

  const stateUrl = cleanUrl(options.state?.getVmServiceUrl() ?? undefined);
  if (stateUrl) return { vmServiceUrl: stateUrl, source: 'state' };

  const env = options.env ?? process.env;
  const fliwrightVmUrl = cleanUrl(env.FLIWRIGHT_VM_URL);
  if (fliwrightVmUrl) return { vmServiceUrl: fliwrightVmUrl, source: 'env:FLIWRIGHT_VM_URL' };

  const vmServiceUrl = cleanUrl(env.FLIWRIGHT_VM_SERVICE_URL);
  if (vmServiceUrl) return { vmServiceUrl, source: 'env:FLIWRIGHT_VM_SERVICE_URL' };

  const config = await readWorkspaceConfig(options.cwd);
  const configUrl = cleanUrl(config.vmServiceUrl);
  if (configUrl) return { vmServiceUrl: configUrl, source: 'workspace-config' };

  throw new Error('No Flutter VM Service URL found. Pass vmServiceUrl, set FLIWRIGHT_VM_URL or FLIWRIGHT_VM_SERVICE_URL, or let Fliwright VS Code write .fliwright/config.json for the running app.');
}

export interface FliwrightStatusResult {
  tool: 'fliwright_status';
  connected: boolean;
  vmServiceUrl: string | null;
  availableVmServiceUrl?: string;
  availableVmServiceUrlSource?: ResolvedVmServiceUrl['source'];
  tddRuntimeConnected: boolean;
  tddRuntimeTool: 'fliwright_tdd_status';
  guidance: string;
}

export async function handleStatus(
  state: ServerState,
  options: ConnectOptions = {},
): Promise<FliwrightStatusResult> {
  let available: ResolvedVmServiceUrl | undefined;
  try {
    available = await resolveMcpVmServiceUrl({ state, cwd: options.cwd, env: options.env });
  } catch {
    available = undefined;
  }

  const tddRuntime = state.getTddRuntime();
  const tddSnapshot = tddRuntime?.snapshot();
  return {
    tool: 'fliwright_status',
    connected: Boolean(state.getDriver()),
    vmServiceUrl: state.getVmServiceUrl(),
    ...(available ? {
      availableVmServiceUrl: available.vmServiceUrl,
      availableVmServiceUrlSource: available.source,
    } : {}),
    tddRuntimeConnected: Boolean(tddSnapshot && (tddSnapshot as { connected?: boolean }).connected),
    tddRuntimeTool: 'fliwright_tdd_status',
    guidance: 'For the currently running app, call fliwright_screenshot directly for a visual screenshot or fliwright_debug_snapshot/fliwright_snap for structure. fliwright_tdd_status is only for the persistent TDD runtime.',
  };
}

function cleanUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  return trimmed ? trimmed : undefined;
}

async function createDefaultDriver(): Promise<FliwrightDriver> {
  const { FliwrightDriver } = await import('@fliwright/core');
  return new FliwrightDriver();
}

export function toWebSocketUrl(url: string): string {
  const converted = url
    .replace('http://', 'ws://')
    .replace('https://', 'wss://');
  return converted.endsWith('/ws') ? converted : converted.replace(/\/?$/, '/ws');
}

export function registerConnectTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_connect',
    'Connect to a running Flutter app via Dart VM Service. vmServiceUrl is optional: when omitted, this reuses the current MCP state, FLIWRIGHT_VM_URL/FLIWRIGHT_VM_SERVICE_URL, or .fliwright/config.json written by Fliwright VS Code.',
    ConnectParamsSchema.shape,
    async (params) => {
      const result = await handleConnect(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

export function registerStatusTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_status',
    'Report ordinary Fliwright MCP app-interaction connection status and any discoverable VM Service URL. Use this for the current running Flutter app; use fliwright_tdd_status only for the persistent TDD runtime.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await handleStatus(state), null, 2) }],
    }),
  );
}
