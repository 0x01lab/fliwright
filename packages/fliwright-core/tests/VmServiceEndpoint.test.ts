import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VmServiceEndpointResolver,
  WorkspaceEndpointOwner,
  normalizeVmServiceUrl,
  readWorkspaceConfig,
  workspaceEndpointSource,
  workspaceConfigPath,
  writeWorkspaceVmServiceUrl,
  type VmServiceEndpoint,
  type VmServiceEndpointSource,
} from '../src/index.js';

function source(endpoint: VmServiceEndpoint | VmServiceEndpoint[] | null): VmServiceEndpointSource {
  return { acquire: vi.fn(async () => endpoint) };
}

describe('VmServiceEndpoint', () => {
  it('normalizes transport URLs without dropping the authentication token path', () => {
    expect(normalizeVmServiceUrl('http://127.0.0.1:51830/u37pq71Re0k=/')).toBe(
      'ws://127.0.0.1:51830/u37pq71Re0k=/ws',
    );
    expect(normalizeVmServiceUrl('ws://127.0.0.1:51830/u37pq71Re0k=/ws')).toBe(
      'ws://127.0.0.1:51830/u37pq71Re0k=/ws',
    );
    expect(normalizeVmServiceUrl('http://127.0.0.1:9100/?uri=http%3A%2F%2F127.0.0.1%3A51830%2Ftoken%3D%2F'))
      .toBe('ws://127.0.0.1:51830/token=/ws');
    expect(normalizeVmServiceUrl('wss://relay.example/vm?token=query-token')).toBe(
      'wss://relay.example/vm?token=query-token',
    );
  });

  it('returns the first verified endpoint and persists only successful discoveries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-'));
    const rejected = source({ url: 'ws://stale:1/old-token=/ws', kind: 'direct-vm', source: 'stale', scope: 'developer-workspace', acquiredAt: '2026-01-01T00:00:00.000Z' });
    const accepted = source({ url: 'http://live:2/live-token=/', kind: 'direct-vm', source: 'daemon', scope: 'developer-workspace', appId: 'app-1', deviceId: 'device-1', acquiredAt: '2026-01-02T00:00:00.000Z' });
    const verify = vi.fn(async (endpoint: VmServiceEndpoint) => endpoint.source === 'daemon'
      ? { status: 'ok' as const, checkedAt: '2026-01-02T00:00:00.000Z' }
      : { status: 'invalid' as const, checkedAt: '2026-01-02T00:00:00.000Z', reason: 'stale' });

    const lease = await new VmServiceEndpointResolver([rejected, accepted], { cwd, verify }).acquire();

    expect(lease.url).toBe('ws://live:2/live-token=/ws');
    expect(lease.source).toBe('daemon');
    expect(verify).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(workspaceConfigPath(cwd), 'utf8'))).toMatchObject({
      vmServiceUrl: 'ws://live:2/live-token=/ws',
      vmServiceSource: 'daemon',
      vmServiceLeaseId: lease.leaseId,
      vmServiceAppId: 'app-1',
      vmServiceDeviceId: 'device-1',
    });
  });

  it('throws a structured error when every candidate fails verification', async () => {
    const verify = vi.fn(async () => ({ status: 'invalid' as const, checkedAt: new Date().toISOString(), reason: 'bridge-missing' }));
    await expect(new VmServiceEndpointResolver([
      source({ url: 'ws://one/ws', kind: 'direct-vm', source: 'one', scope: 'developer-workspace', acquiredAt: new Date().toISOString() }),
    ], { verify }).acquire()).rejects.toMatchObject({ code: 'VM_SERVICE_UNAVAILABLE', failures: [{ reason: 'bridge-missing' }] });
  });

  it('rejects an otherwise healthy endpoint when required bridge capabilities are missing', async () => {
    const verify = vi.fn(async () => ({
      status: 'ok' as const,
      checkedAt: new Date().toISOString(),
      bridgeCapabilities: { screenshotWaitForFrame: true },
    }));
    await expect(new VmServiceEndpointResolver([
      source({ url: 'ws://one/ws', kind: 'direct-vm', source: 'one', scope: 'developer-workspace', acquiredAt: new Date().toISOString() }),
    ], { verify }).acquire({ requiredCapabilities: ['query'] })).rejects.toMatchObject({
      failures: [{ reason: 'missing-capabilities:query' }],
    });
  });

  it('clears an invalid workspace endpoint cache before reporting acquisition failure', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-invalid-cache-'));
    await writeWorkspaceVmServiceUrl('ws://stale/token=/ws', { cwd, source: 'previous' });
    const verify = vi.fn(async () => ({ status: 'invalid' as const, checkedAt: new Date().toISOString(), reason: 'closed' }));

    await expect(new VmServiceEndpointResolver([workspaceEndpointSource({ cwd })], { cwd, verify }).acquire())
      .rejects.toMatchObject({ code: 'VM_SERVICE_UNAVAILABLE' });
    expect((await readWorkspaceConfig(cwd)).vmServiceUrl).toBeUndefined();
  });

  it('updates the exposed lease state after validation, invalidation, and disposal', async () => {
    const verify = vi.fn()
      .mockResolvedValueOnce({ status: 'ok' as const, checkedAt: '2026-01-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ status: 'invalid' as const, checkedAt: '2026-01-02T00:00:00.000Z', reason: 'closed' });
    const lease = await new VmServiceEndpointResolver([
      source({ url: 'ws://one/ws', kind: 'direct-vm', source: 'one', scope: 'developer-workspace', acquiredAt: new Date().toISOString() }),
    ], { verify, persistWorkspaceCache: false }).acquire();

    await lease.verify();
    expect(lease).toMatchObject({ status: 'invalid', verifiedAt: '2026-01-02T00:00:00.000Z' });
    await lease.invalidate();
    expect(lease.status).toBe('invalid');
    await lease.dispose();
    expect(lease.status).toBe('disposed');
  });

  it('allows a stale owner to be taken over and prevents a live owner from being overwritten', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-owner-'));
    const first = new WorkspaceEndpointOwner({ cwd, ownerId: 'first', pid: 100, isProcessAlive: () => true });
    const firstLease = await first.acquire();
    await expect(new WorkspaceEndpointOwner({ cwd, ownerId: 'second', pid: 200, isProcessAlive: () => true }).acquire())
      .rejects.toThrow(/owned by first/);
    await firstLease.release();
    const second = new WorkspaceEndpointOwner({ cwd, ownerId: 'second', pid: 200, isProcessAlive: () => true });
    await expect(second.acquire()).resolves.toMatchObject({ ownerId: 'second', generation: 2 });
  });

  it('allows only one concurrent owner acquisition', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-owner-race-'));
    const first = new WorkspaceEndpointOwner({ cwd, ownerId: 'first', pid: 100, isProcessAlive: () => true });
    const second = new WorkspaceEndpointOwner({ cwd, ownerId: 'second', pid: 200, isProcessAlive: () => true });

    const results = await Promise.allSettled([first.acquire(), second.acquire()]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
