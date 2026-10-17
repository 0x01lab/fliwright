import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { normalizeVmServiceUrl } from './VmServiceEndpoint.js';

interface QueueEntry { owner: symbol; resolve: () => void; }
interface ExternalLease { release(): Promise<void>; }
interface LeaseState { owner?: symbol; queue: QueueEntry[]; }
interface LeaseContext { key: string; active: () => boolean; }

/** A lease retained across callbacks whose async contexts are independent. */
export interface EndpointLease {
  run<T>(execute: () => Promise<T>): Promise<T>;
  release(): Promise<void>;
}

export interface EndpointLeaseManagerOptions {
  rootDir?: string;
  retryDelayMs?: number;
  /** Reclaim age for directories without a valid owner; live process leases never expire by heartbeat age. */
  staleAfterMs?: number;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
}

const currentOwners = new AsyncLocalStorage<LeaseContext>();

/** Serializes tests and action/evidence work per normalized app endpoint. */
export class EndpointLeaseManager {
  private readonly states = new Map<string, LeaseState>();
  private readonly options: {
    rootDir: string;
    retryDelayMs: number;
    staleAfterMs: number;
    pid: number;
    isProcessAlive?: (pid: number) => boolean;
  };

  constructor(options: EndpointLeaseManagerOptions = {}) {
    this.options = {
      rootDir: options.rootDir ?? join(homedir(), '.fliwright', 'endpoint-leases'),
      retryDelayMs: options.retryDelayMs ?? 25,
      staleAfterMs: options.staleAfterMs ?? 15_000,
      pid: options.pid ?? process.pid,
      isProcessAlive: options.isProcessAlive,
    };
  }

  async run<T>(endpoint: string, execute: () => Promise<T>): Promise<T> {
    const key = normalizeEndpoint(endpoint);
    const context = currentOwners.getStore();
    if (context?.key === key && context.active()) return execute();
    const lease = await this.acquire(endpoint);
    try { return await lease.run(execute); }
    finally { await lease.release(); }
  }

  async acquire(endpoint: string, options: { signal?: AbortSignal } = {}): Promise<EndpointLease> {
    const { signal } = options;
    signal?.throwIfAborted();
    const key = normalizeEndpoint(endpoint);
    const owner = Symbol(key);
    const state = this.states.get(key) ?? { queue: [] };
    this.states.set(key, state);
    if (state.owner) {
      await new Promise<void>((resolve, reject) => {
        const entry = { owner, resolve: () => { signal?.removeEventListener('abort', abort); resolve(); } };
        const abort = () => {
          const index = state.queue.indexOf(entry);
          if (index >= 0) state.queue.splice(index, 1);
          signal?.removeEventListener('abort', abort);
          reject(signal?.reason);
        };
        state.queue.push(entry);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    state.owner = owner;
    let external: ExternalLease;
    try {
      signal?.throwIfAborted();
      external = await acquireExternalLease(key, this.options, signal);
    } catch (error) {
      state.owner = undefined;
      this.advanceQueueOrDelete(key, state);
      throw error;
    }
    let released = false;
    let releasePromise: Promise<void> | undefined;
    let workQueue = Promise.resolve();
    const leaseContext = { key, active: () => !released };
    return {
      async run<T>(execute: () => Promise<T>): Promise<T> {
        if (released) throw new Error('Endpoint lease has been released.');
        if (currentOwners.getStore() === leaseContext) return execute();
        const work = workQueue.then(() => {
          if (released) throw new Error('Endpoint lease has been released.');
          return currentOwners.run(leaseContext, execute);
        });
        workQueue = work.then(() => undefined, () => undefined);
        return work;
      },
      release: () => releasePromise ??= (async () => {
        released = true;
        try { await external.release(); }
        finally {
          state.owner = undefined;
          this.advanceQueueOrDelete(key, state);
        }
      })(),
    };
  }

  private advanceQueueOrDelete(key: string, state: LeaseState): void {
    const next = state.queue.shift();
    if (next) {
      state.owner = next.owner;
      next.resolve();
    } else {
      this.states.delete(key);
    }
  }
}

interface LeaseOwner { token: string; pid: number; heartbeatAt: number; }

async function acquireExternalLease(key: string, options: {
  rootDir: string;
  retryDelayMs: number;
  staleAfterMs: number;
  pid: number;
  isProcessAlive?: (pid: number) => boolean;
}, signal?: AbortSignal): Promise<ExternalLease> {
  await mkdir(options.rootDir, { recursive: true });
  const lockPath = join(options.rootDir, `${createHash('sha256').update(key).digest('hex')}.lock`);
  const token = randomUUID();
  for (;;) {
    signal?.throwIfAborted();
    let created = false;
    try {
      await mkdir(lockPath);
      created = true;
      await writeLeaseOwner(lockPath, { token, pid: options.pid, heartbeatAt: Date.now() });
      let released = false;
      const heartbeat = setInterval(() => {
        void writeLeaseOwner(lockPath, { token, pid: options.pid, heartbeatAt: Date.now() }).catch(() => undefined);
      }, Math.max(10, Math.floor(options.staleAfterMs / 3)));
      heartbeat.unref?.();
      return {
        async release() {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          const owner = await readLeaseOwner(lockPath);
          if (owner?.token === token) await rm(lockPath, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (created) {
        // No lease handle was published, so its normal release path cannot run.
        // Preserve the initialization error even when the filesystem also rejects cleanup.
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = await readLeaseOwner(lockPath);
      // A delayed heartbeat does not prove the process stopped using the App.
      const alive = owner && (options.isProcessAlive ? options.isProcessAlive(owner.pid) : isProcessAlive(owner.pid));
      if (alive || (!owner && await isFreshLock(lockPath, options.staleAfterMs))) {
        await delay(options.retryDelayMs, signal);
        continue;
      }
      const quarantine = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
      try {
        await rename(lockPath, quarantine);
        await rm(quarantine, { recursive: true, force: true });
      } catch (reclaimError) {
        if ((reclaimError as NodeJS.ErrnoException).code !== 'ENOENT') await delay(options.retryDelayMs);
      }
    }
  }
}

async function isFreshLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const details = await stat(join(lockPath, 'owner.json')).catch(() => stat(lockPath));
    return Date.now() - details.mtimeMs < staleAfterMs;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

async function writeLeaseOwner(lockPath: string, owner: LeaseOwner): Promise<void> {
  const path = join(lockPath, 'owner.json');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(owner), 'utf8');
  await rename(temporary, path);
}

async function readLeaseOwner(lockPath: string): Promise<LeaseOwner | undefined> {
  try { return JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as LeaseOwner; } catch { return undefined; }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function normalizeEndpoint(endpoint: string): string {
  const value = endpoint.trim();
  const normalized = normalizeVmServiceUrl(value);
  if (normalized) return normalized.replace(/\/+$/, '');
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:';
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/ws';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/+$/, '').toLowerCase();
  }
}
