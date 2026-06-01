import { loadConfig } from '../config.js';

const SCAN_PORTS = [8181, 9189, 54321];

export interface ResolveVmServiceOptions {
  userInput?: string;
  configUrl?: string | null;
  envUrl?: string;
  autoDiscover?: boolean;
}

export async function resolveVmServiceUrl(options: ResolveVmServiceOptions = {}): Promise<string | null> {
  const explicit = normalizeVmServiceUrl(options.userInput);
  if (explicit) return explicit;

  const configUrl = normalizeVmServiceUrl(options.configUrl ?? loadConfig().vmServiceUrl);
  if (configUrl) return configUrl;

  const envUrl = normalizeVmServiceUrl(options.envUrl ?? process.env.FLIWRIGHT_VM_URL);
  if (envUrl) return envUrl;

  const autoDiscover = options.autoDiscover ?? loadConfig().autoDiscoverVmService;
  return autoDiscover ? discoverVmServiceUrl() : null;
}

export async function discoverVmServiceUrl(ports = SCAN_PORTS): Promise<string | null> {
  for (const port of ports) {
    const url = await discoverOnPort(port);
    if (url) return url;
  }
  return null;
}

export function normalizeVmServiceUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed;
  if (trimmed.startsWith('http://')) return `${trimmed.replace(/^http:\/\//, 'ws://').replace(/\/$/, '')}/ws`;
  if (trimmed.startsWith('https://')) return `${trimmed.replace(/^https:\/\//, 'wss://').replace(/\/$/, '')}/ws`;
  return trimmed;
}

async function discoverOnPort(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { webSocketDebuggerUrl?: string };
    return body.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}/ws`;
  } catch {
    return null;
  }
}
