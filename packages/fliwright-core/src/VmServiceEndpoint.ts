import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { VMServiceConnector } from './VMServiceConnector.js';
import {
  readWorkspaceConfig,
  clearWorkspaceVmServiceUrl,
  writeWorkspaceConfig,
  writeWorkspaceVmServiceUrl,
  type FliwrightWorkspaceConfig,
} from './WorkspaceConfig.js';

export type VmServiceEndpointKind = 'direct-vm' | 'dds' | 'relay';
export type VmServiceEndpointScope = 'developer-workspace' | 'execution-worker';

export interface VmServiceEndpoint {
  url: string;
  kind: VmServiceEndpointKind;
  source: string;
  scope: VmServiceEndpointScope;
  appId?: string;
  deviceId?: string;
  acquiredAt: string;
}

export interface VmServiceAcquisitionRequest {
  appId?: string;
  deviceId?: string;
  scope?: VmServiceEndpointScope;
  requiredCapabilities?: string[];
}

export interface VmServiceEndpointSource {
  name?: string;
  acquire(request: VmServiceAcquisitionRequest): Promise<VmServiceEndpoint | VmServiceEndpoint[] | null | undefined>;
}

export interface VmServiceEndpointHealth {
  status: 'ok' | 'invalid';
  checkedAt: string;
  reason?: string;
  dartSdkVersion?: string;
  bridgeCapabilities?: Record<string, unknown>;
}

export type VmServiceEndpointVerifier =
  (endpoint: VmServiceEndpoint) => Promise<VmServiceEndpointHealth>;

export interface VmServiceEndpointLease extends VmServiceEndpoint {
  leaseId: string;
  verifiedAt: string;
  status: 'active' | 'invalid' | 'disposed';
  verify(): Promise<VmServiceEndpointHealth>;
  invalidate(): Promise<void>;
  dispose(): Promise<void>;
}

export interface VmServiceEndpointResolverOptions {
  cwd?: string;
  verify?: VmServiceEndpointVerifier;
  persistWorkspaceCache?: boolean;
}

export interface WorkspaceEndpointOwnerLease {
  ownerId: string;
  pid: number;
  generation: number;
  heartbeatAt: string;
  heartbeat(): Promise<void>;
  release(): Promise<void>;
}

export interface WorkspaceEndpointOwnerOptions {
  cwd?: string;
  ownerId?: string;
  pid?: number;
  heartbeatTtlMs?: number;
  isProcessAlive?: (pid: number) => boolean;
}

export class VmServiceUnavailableError extends Error {
  readonly code = 'VM_SERVICE_UNAVAILABLE';

  constructor(readonly failures: Array<{ source: string; reason: string }>) {
    super('No verified Flutter VM Service endpoint is available.');
    this.name = 'VmServiceUnavailableError';
  }
}

/** Normalize a complete VM service URI while preserving its tokenized path. */
export function normalizeVmServiceUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const outer = new URL(trimmed.replace(/[),.;\]}]+$/, ''));
    const embedded = outer.searchParams.get('uri') ?? outer.searchParams.get('vmServiceUri');
    const parsed = new URL(embedded ?? outer.toString());
    const suppliedWebSocket = parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
    if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
    else if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
    else if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return null;

    if (parsed.pathname === '' || parsed.pathname === '/') {
      parsed.pathname = '/ws';
    } else if (!suppliedWebSocket) {
      const path = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = path.endsWith('/ws') ? path : `${path}/ws`;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Connects to the VM, confirms a runnable isolate, and requires a ready bridge. */
export async function verifyVmServiceEndpoint(endpoint: VmServiceEndpoint): Promise<VmServiceEndpointHealth> {
  const connector = new VMServiceConnector();
  const checkedAt = new Date().toISOString();
  try {
    await connector.connect(endpoint.url);
    const handshake = await connector.sendRequest('ext.fliwright.handshake', { protocolVersion: '1' }) as {
      status?: string;
      compatible?: boolean;
      initialized?: boolean;
      dartSdkVersion?: string;
      bridgeCapabilities?: Record<string, unknown>;
    };
    if (handshake?.status !== 'ok' || handshake.compatible !== true || handshake.initialized !== true) {
      return { status: 'invalid', checkedAt, reason: 'bridge-not-ready' };
    }
    return {
      status: 'ok',
      checkedAt,
      dartSdkVersion: handshake.dartSdkVersion,
      bridgeCapabilities: handshake.bridgeCapabilities,
    };
  } catch (error) {
    return {
      status: 'invalid',
      checkedAt,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    connector.disconnect();
  }
}

export class VmServiceEndpointResolver {
  private readonly verifyEndpoint: VmServiceEndpointVerifier;
  private readonly cwd: string;
  private readonly persistWorkspaceCache: boolean;

  constructor(
    private readonly sources: VmServiceEndpointSource[],
    options: VmServiceEndpointResolverOptions = {},
  ) {
    this.verifyEndpoint = options.verify ?? verifyVmServiceEndpoint;
    this.cwd = options.cwd ?? process.cwd();
    this.persistWorkspaceCache = options.persistWorkspaceCache ?? true;
  }

  async acquire(request: VmServiceAcquisitionRequest = {}): Promise<VmServiceEndpointLease> {
    const failures: Array<{ source: string; reason: string }> = [];
    for (const provider of this.sources) {
      const providerName = provider.name ?? 'unknown';
      let values: VmServiceEndpoint[];
      try {
        const result = await provider.acquire(request);
        values = result == null ? [] : Array.isArray(result) ? result : [result];
      } catch (error) {
        failures.push({ source: providerName, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }

      for (const value of values) {
        const url = normalizeVmServiceUrl(value.url);
        if (!url) {
          failures.push({ source: value.source || providerName, reason: 'invalid-url' });
          continue;
        }
        const endpoint = { ...value, url };
        let health: VmServiceEndpointHealth;
        try {
          health = await this.verifyEndpoint(endpoint);
        } catch (error) {
          health = { status: 'invalid', checkedAt: new Date().toISOString(), reason: error instanceof Error ? error.message : String(error) };
        }
        if (health.status !== 'ok') {
          failures.push({ source: endpoint.source || providerName, reason: health.reason ?? 'verification-failed' });
          if (providerName === 'workspace-config') {
            await this.withWorkspaceOwner(() => clearWorkspaceVmServiceUrl({
              cwd: this.cwd,
              source: 'verification-failed',
            }));
          }
          continue;
        }
        const missingCapabilities = (request.requiredCapabilities ?? []).filter(
          (capability) => health.bridgeCapabilities?.[capability] !== true,
        );
        if (missingCapabilities.length > 0) {
          failures.push({ source: endpoint.source || providerName, reason: `missing-capabilities:${missingCapabilities.join(',')}` });
          continue;
        }
        const leaseId = randomUUID();
        if (this.persistWorkspaceCache && endpoint.scope === 'developer-workspace') {
          await this.withWorkspaceOwner(() => writeWorkspaceVmServiceUrl(endpoint.url, {
            cwd: this.cwd,
            source: endpoint.source,
            appId: endpoint.appId,
            deviceId: endpoint.deviceId,
            leaseId,
          }));
        }
        return this.createLease(endpoint, health, leaseId);
      }
    }
    throw new VmServiceUnavailableError(failures);
  }

  private createLease(endpoint: VmServiceEndpoint, initialHealth: VmServiceEndpointHealth, leaseId = randomUUID()): VmServiceEndpointLease {
    let status: VmServiceEndpointLease['status'] = 'active';
    let verifiedAt = initialHealth.checkedAt;
    const resolver = this;
    return {
      ...endpoint,
      leaseId,
      get verifiedAt() { return verifiedAt; },
      get status() { return status; },
      async verify() {
        if (status === 'disposed') return { status: 'invalid', checkedAt: new Date().toISOString(), reason: 'disposed' };
        const next = await resolver.verifyEndpoint(endpoint);
        verifiedAt = next.checkedAt;
        status = next.status === 'ok' ? 'active' : 'invalid';
        return next;
      },
      async invalidate() { status = 'invalid'; },
      async dispose() { status = 'disposed'; },
    };
  }

  private async withWorkspaceOwner<T>(action: () => Promise<T>): Promise<T> {
    const owner = new WorkspaceEndpointOwner({ cwd: this.cwd });
    const lease = await owner.acquire();
    try {
      return await action();
    } finally {
      await lease.release();
    }
  }
}

/** Coordinates the single writer responsible for a workspace endpoint cache. */
export class WorkspaceEndpointOwner {
  private readonly cwd: string;
  private readonly ownerId: string;
  private readonly pid: number;
  private readonly heartbeatTtlMs: number;
  private readonly isProcessAlive: (pid: number) => boolean;
  private generation = 0;
  private active = false;

  constructor(options: WorkspaceEndpointOwnerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.ownerId = options.ownerId ?? randomUUID();
    this.pid = options.pid ?? process.pid;
    this.heartbeatTtlMs = options.heartbeatTtlMs ?? 15_000;
    this.isProcessAlive = options.isProcessAlive ?? ((pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });
  }

  async acquire(): Promise<WorkspaceEndpointOwnerLease> {
    await this.withConfigLock(async () => {
      const config = await readWorkspaceConfig(this.cwd);
      const existingPid = config.vmServiceOwnerPid;
      const heartbeatAt = config.vmServiceOwnerHeartbeatAt ? Date.parse(config.vmServiceOwnerHeartbeatAt) : 0;
      const fresh = heartbeatAt > 0 && Date.now() - heartbeatAt < this.heartbeatTtlMs;
      if (config.vmServiceOwnerId && config.vmServiceOwnerId !== this.ownerId && fresh
        && existingPid !== undefined && this.isProcessAlive(existingPid)) {
        throw new Error(`Workspace VM Service endpoint is owned by ${config.vmServiceOwnerId}.`);
      }

      this.generation = (config.vmServiceGeneration ?? 0) + 1;
      this.active = true;
      await this.writeHeartbeat();
    });
    const owner = this;
    return {
      ownerId: this.ownerId,
      pid: this.pid,
      generation: this.generation,
      get heartbeatAt() { return owner.heartbeatTimestamp; },
      heartbeat: () => this.heartbeat(),
      release: () => this.release(),
    };
  }

  private heartbeatTimestamp = new Date().toISOString();

  private async writeHeartbeat(): Promise<void> {
    this.heartbeatTimestamp = new Date().toISOString();
    await writeWorkspaceConfig({
      vmServiceOwnerId: this.ownerId,
      vmServiceOwnerPid: this.pid,
      vmServiceOwnerHeartbeatAt: this.heartbeatTimestamp,
      vmServiceGeneration: this.generation,
    }, this.cwd);
  }

  private async heartbeat(): Promise<void> {
    if (!this.active) throw new Error('Workspace VM Service endpoint owner is not active.');
    await this.withConfigLock(async () => {
      const config = await readWorkspaceConfig(this.cwd);
      if (config.vmServiceOwnerId !== this.ownerId || config.vmServiceGeneration !== this.generation) {
        this.active = false;
        throw new Error('Workspace VM Service endpoint ownership was lost.');
      }
      await this.writeHeartbeat();
    });
  }

  private async release(): Promise<void> {
    if (!this.active) return;
    await this.withConfigLock(async () => {
      const config = await readWorkspaceConfig(this.cwd);
      if (config.vmServiceOwnerId !== this.ownerId || config.vmServiceGeneration !== this.generation) return;
      await writeWorkspaceConfig({
        vmServiceOwnerId: undefined,
        vmServiceOwnerPid: undefined,
        vmServiceOwnerHeartbeatAt: undefined,
      }, this.cwd);
    });
    this.active = false;
  }

  private async withConfigLock<T>(action: () => Promise<T>): Promise<T> {
    const directory = join(this.cwd, '.fliwright');
    const lockPath = join(directory, 'vm-service-owner.lock');
    await mkdir(directory, { recursive: true });
    let lock;
    try {
      lock = await open(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Workspace VM Service endpoint ownership is being updated by another process.');
      }
      throw error;
    }
    try {
      return await action();
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

export function workspaceEndpointSource(options: { cwd?: string; source?: string } = {}): VmServiceEndpointSource {
  return {
    name: options.source ?? 'workspace-config',
    async acquire() {
      const config = await readWorkspaceConfig(options.cwd);
      if (!config.vmServiceUrl) return null;
      return endpointFromConfig(config, options.source ?? config.vmServiceSource ?? 'workspace-config');
    },
  };
}

export function explicitEndpointSource(url: string, options: Partial<Omit<VmServiceEndpoint, 'url' | 'acquiredAt'>> = {}): VmServiceEndpointSource {
  return {
    name: options.source ?? 'argument',
    async acquire() {
      return {
        url,
        kind: options.kind ?? 'direct-vm',
        source: options.source ?? 'argument',
        scope: options.scope ?? 'developer-workspace',
        ...(options.appId ? { appId: options.appId } : {}),
        ...(options.deviceId ? { deviceId: options.deviceId } : {}),
        acquiredAt: new Date().toISOString(),
      };
    },
  };
}

function endpointFromConfig(config: FliwrightWorkspaceConfig, source: string): VmServiceEndpoint {
  return {
    url: config.vmServiceUrl!,
    kind: 'direct-vm',
    source,
    scope: 'developer-workspace',
    ...(typeof config.vmServiceAppId === 'string' ? { appId: config.vmServiceAppId } : {}),
    ...(typeof config.vmServiceDeviceId === 'string' ? { deviceId: config.vmServiceDeviceId } : {}),
    acquiredAt: config.vmServiceUpdatedAt ?? new Date(0).toISOString(),
  };
}
