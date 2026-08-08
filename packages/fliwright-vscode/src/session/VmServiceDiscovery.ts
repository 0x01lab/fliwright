import { loadConfig } from '../config.js';
import { normalizeVmServiceUrl as normalizeCoreVmServiceUrl, type VmServiceEndpoint, type VmServiceEndpointSource } from '@fliwright/core';

const SCAN_PORTS = [8181, 9189, 54321];
const TRAILING_URL_PUNCTUATION = /[),.;\]}]+$/;

export interface ResolveVmServiceOptions {
  userInput?: string;
  configUrl?: string | null;
  envUrl?: string;
  autoDiscover?: boolean;
}

export interface VmServiceCandidate {
  url: string;
  source: 'cache' | 'workspace-config' | 'log' | 'port-scan';
  label: string;
  confidence: number;
}

export interface DiscoverVmServiceOptions {
  cachedUrl?: string | null;
  workspaceConfigUrl?: string | null;
  logText?: string;
  ports?: number[];
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
  return (await discoverVmServiceCandidates({ ports }))[0]?.url ?? null;
}

export async function discoverVmServiceCandidates(options: DiscoverVmServiceOptions = {}): Promise<VmServiceCandidate[]> {
  const candidates: VmServiceCandidate[] = [];
  const seen = new Set<string>();

  const add = (candidate: VmServiceCandidate) => {
    if (seen.has(candidate.url)) return;
    seen.add(candidate.url);
    candidates.push(candidate);
  };

  const cached = normalizeVmServiceUrl(options.cachedUrl);
  if (cached) {
    add({
      url: cached,
      source: 'cache',
      label: 'Last successful connection',
      confidence: 80,
    });
  }

  const workspaceConfigUrl = normalizeVmServiceUrl(options.workspaceConfigUrl);
  if (workspaceConfigUrl) {
    add({
      url: workspaceConfigUrl,
      source: 'workspace-config',
      label: '.fliwright/config.json',
      confidence: 90,
    });
  }

  for (const url of extractVmServiceUrls(options.logText ?? '')) {
    add({
      url,
      source: 'log',
      label: 'Flutter debug output',
      confidence: 100,
    });
  }

  const ports = options.ports ?? SCAN_PORTS;
  for (const port of ports) {
    const url = await discoverOnPort(port);
    if (url) {
      add({
        url,
        source: 'port-scan',
        label: `Local port ${port}`,
        confidence: 50,
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

export function extractVmServiceUrls(text: string): string[] {
  const urls = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const matches = line.matchAll(/\b(?:https?|wss?):\/\/[^\s<>"'`]+/g);
    for (const match of matches) {
      const raw = cleanRawUrl(match[0]);
      const expanded = expandPossibleVmServiceUrls(raw);
      if (expanded.length === 1 && expanded[0] === raw && !isLikelyVmServiceLogLine(line)) {
        continue;
      }
      for (const value of expanded) {
        const normalized = normalizeVmServiceUrl(value);
        if (normalized) urls.add(normalized);
      }
    }
  }

  return [...urls];
}

export function normalizeVmServiceUrl(value: string | null | undefined): string | null {
  return normalizeCoreVmServiceUrl(value);
}

/** Adapter used by Core resolver consumers while retaining DAP/log ownership in VS Code. */
export function vmServiceLogEndpointSource(logText: string): VmServiceEndpointSource {
  return {
    name: 'vscode-debug-output',
    async acquire() {
      return extractVmServiceUrls(logText).map((url): VmServiceEndpoint => ({
        url,
        kind: 'direct-vm',
        source: 'vscode-debug-output',
        scope: 'developer-workspace',
        acquiredAt: new Date().toISOString(),
      }));
    },
  };
}

function isLikelyVmServiceLogLine(line: string): boolean {
  return /\b(?:dart\s+)?vm service\b|\bdebug service\b|\bobservatory\b|\bdds\b/i.test(line);
}

async function discoverOnPort(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { webSocketDebuggerUrl?: string };
    return normalizeVmServiceUrl(body.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}/ws`);
  } catch {
    return null;
  }
}

function cleanRawUrl(value: string): string {
  return value.replace(TRAILING_URL_PUNCTUATION, '');
}

function expandPossibleVmServiceUrls(raw: string): string[] {
  try {
    const url = new URL(raw);
    const embedded = url.searchParams.get('uri') ?? url.searchParams.get('vmServiceUri');
    if (embedded) return [embedded];
  } catch {
    // Ignore unparsable log fragments.
  }

  return [raw];
}
