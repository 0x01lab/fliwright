import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EndpointLeaseManager } from '../src/EndpointLease.js';

const fault = vi.hoisted(() => ({ stage: '', root: '', error: new Error('not armed') }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (fault.stage === 'write' && String(args[0]).startsWith(fault.root)
        && dirname(String(args[0])).endsWith('.lock') && basename(String(args[0])).startsWith('owner.json.')) {
        fault.stage = '';
        throw fault.error;
      }
      return actual.writeFile(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fault.stage === 'publish' && String(args[1]).startsWith(fault.root)
        && dirname(String(args[1])).endsWith('.lock') && basename(String(args[1])) === 'owner.json') {
        fault.stage = '';
        throw fault.error;
      }
      return actual.rename(...args);
    },
  };
});

describe('endpoint lease initialization failures', () => {
  it.each([
    ['write', 'ENOSPC'], ['publish', 'ENOSPC'], ['write', 'EEXIST'], ['publish', 'EEXIST'],
  ])('removes its lock after owner %s fails with %s, retaining the original error', async (stage, code) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-lease-initialization-'));
    const manager = new EndpointLeaseManager({ rootDir: root, retryDelayMs: 5 });
    const error = Object.assign(new Error(`original owner ${stage} failed`), { code });
    try {
      Object.assign(fault, { stage, root, error });
      await expect(manager.acquire('ws://initialization-app/ws', { signal: AbortSignal.timeout(500) })).rejects.toBe(error);
      expect(await readdir(root)).toEqual([]);
      const next = await manager.acquire('ws://initialization-app/ws', { signal: AbortSignal.timeout(500) });
      await next.release();
      const independent = await new EndpointLeaseManager({ rootDir: root }).acquire('ws://initialization-app/ws', {
        signal: AbortSignal.timeout(500),
      });
      await independent.release();
      expect(await readdir(root)).toEqual([]);
    } finally {
      fault.stage = '';
      await rm(root, { recursive: true, force: true });
    }
  });
});
