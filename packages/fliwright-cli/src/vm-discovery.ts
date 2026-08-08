import {
  VmServiceEndpointResolver,
  explicitEndpointSource,
  normalizeVmServiceUrl,
  verifyVmServiceEndpoint,
  workspaceEndpointSource,
  type VmServiceEndpoint,
  type VmServiceEndpointHealth,
  type VmServiceEndpointSource,
} from '@fliwright/core';

const SCAN_PORTS = [8181, 9189, 54321];

export interface ResolveOptions {
  cliFlag?: string;
  configUrl?: string;
  cwd?: string;
  verify?: boolean;
  env?: Record<string, string | undefined>;
}

export async function resolveVmUrl(options: ResolveOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env;
  // Preserve the attach facade's synchronous precedence; managed commands opt into
  // the Core verifier below with `verify: true`.
  if (!options.verify) {
    if (options.cliFlag) return options.cliFlag;
    const directEnvUrl = env.FLIWRIGHT_VM_URL ?? env.FLIWRIGHT_VM_SERVICE_URL;
    if (directEnvUrl) return directEnvUrl;
    if (options.configUrl) return options.configUrl;
  }
  const sources: VmServiceEndpointSource[] = [];
  if (options.cliFlag) sources.push(explicitEndpointSource(options.cliFlag, { source: 'argument' }));
  const envUrl = env.FLIWRIGHT_VM_URL ?? env.FLIWRIGHT_VM_SERVICE_URL;
  if (envUrl) sources.push(explicitEndpointSource(envUrl, { source: 'environment' }));
  if (options.configUrl) sources.push(explicitEndpointSource(options.configUrl, { source: 'project-config' }));
  sources.push(workspaceEndpointSource({ cwd: options.cwd }));
  sources.push(portScanEndpointSource());

  const verify = options.verify ? verifyVmServiceEndpoint : acceptEndpoint;
  try {
    const lease = await new VmServiceEndpointResolver(sources, {
      cwd: options.cwd,
      verify,
      persistWorkspaceCache: options.verify,
    }).acquire();
    return lease.url;
  } catch {
    return null;
  }
}

export async function discoverVmServiceUrl(options: { ports?: number[]; verify?: boolean } | number[] = {}): Promise<string | null> {
  const ports = Array.isArray(options) ? options : options.ports;
  try {
    const lease = await new VmServiceEndpointResolver([portScanEndpointSource(ports)], {
      verify: options && !Array.isArray(options) && options.verify ? verifyVmServiceEndpoint : acceptEndpoint,
      persistWorkspaceCache: false,
    }).acquire();
    return lease.url;
  } catch {
    return null;
  }
}

function portScanEndpointSource(ports = SCAN_PORTS): VmServiceEndpointSource {
  return {
    name: 'port-scan',
    async acquire() {
      const endpoints: VmServiceEndpoint[] = [];
      for (const port of ports) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
          if (!response.ok) continue;
          const body = await response.json() as { webSocketDebuggerUrl?: string };
          const url = normalizeVmServiceUrl(body.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}/ws`);
          if (url) endpoints.push({
            url,
            kind: 'direct-vm',
            source: `port-scan:${port}`,
            scope: 'developer-workspace',
            acquiredAt: new Date().toISOString(),
          });
        } catch {
          // Port unreachable; continue with the next local candidate.
        }
      }
      return endpoints;
    },
  };
}

const acceptEndpoint = async (_endpoint: VmServiceEndpoint): Promise<VmServiceEndpointHealth> => ({
  status: 'ok',
  checkedAt: new Date().toISOString(),
});

export { normalizeVmServiceUrl };
