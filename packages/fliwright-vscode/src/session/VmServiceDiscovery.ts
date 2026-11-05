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
  const candidates = new Map<string, VmServiceCandidate>();

  const add = (candidate: VmServiceCandidate) => {
    const previous = candidates.get(candidate.url);
    if (!previous || candidate.confidence > previous.confidence) {
      candidates.delete(candidate.url);
      candidates.set(candidate.url, candidate);
    }
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
      label: 'Local Fliwright runtime config',
      confidence: 90,
    });
  }

  for (const url of extractVmServiceUrls(options.logText ?? '').reverse()) {
    add({
      url,
      source: 'log',
      label: 'Flutter debug output',
      confidence: 100,
    });
  }

  const ports = options.ports ?? SCAN_PORTS;
  const discovered = await Promise.all(ports.map(discoverOnPort));
  for (const [index, url] of discovered.entries()) {
    if (url) {
      add({
        url,
        source: 'port-scan',
        label: `Local port ${ports[index]}`,
        confidence: 50,
      });
    }
  }

  return [...candidates.values()].sort((a, b) => b.confidence - a.confidence);
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
        if (normalized) {
          urls.delete(normalized);
          urls.add(normalized);
        }
      }
    }
  }

  return [...urls];
}

/** Keeps fragmented DAP output while notifying only when its latest endpoint changes. */
export class VmServiceDebugOutput {
  private buffer = '';
  private latestUrl: string | undefined;
  private debuggerUrl: string | undefined;

  get text(): string {
    // Retain the current endpoint even if verbose application output evicts its log line.
    return this.latestUrl ? `${this.buffer}\nDart VM Service: ${this.latestUrl}\n` : this.buffer;
  }

  accept(message: unknown): string | undefined {
    if (typeof message !== 'object' || message === null) return undefined;
    const event = message as { type?: string; event?: string; body?: Record<string, unknown> };
    if (event.type !== 'event') return undefined;
    if (event.event === 'output' && typeof event.body?.output === 'string') {
      return this.append(event.body.output);
    }
    if (event.event === 'dart.debuggerUris') {
      // Dart-Code exposes the host-accessible address separately for forwarded devices.
      for (const value of [event.body?.clientVmServiceUri, event.body?.vmServiceUri, event.body?.observatoryUri]) {
        const url = typeof value === 'string' ? normalizeVmServiceUrl(value) : null;
        if (url) {
          this.debuggerUrl = url;
          return this.append('');
        }
      }
    }
    return undefined;
  }

  append(text: string): string | undefined {
    this.buffer = `${this.buffer}${text}`.slice(-20000);
    const latestUrl = this.debuggerUrl ?? extractVmServiceUrls(this.buffer).at(-1);
    if (!latestUrl || latestUrl === this.latestUrl) return undefined;
    this.latestUrl = latestUrl;
    return latestUrl;
  }

  clear(): void {
    this.buffer = '';
    this.latestUrl = undefined;
    this.debuggerUrl = undefined;
  }
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
