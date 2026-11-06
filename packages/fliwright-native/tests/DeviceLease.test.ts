import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../src/DeviceLease.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function manager() {
  const rootDir = await mkdtemp(join(tmpdir(), 'fliwright-device-lease-'));
  roots.push(rootDir);
  return { rootDir, first: new DeviceLeaseManager({ rootDir, retryDelayMs: 2 }), second: new DeviceLeaseManager({ rootDir, retryDelayMs: 2 }) };
}
describe('device leases', () => {
  it('serializes two managers for the same device but permits different devices', async () => {
    const { first, second } = await manager();
    const a = await first.acquire('android', 'phone');
    const other = await second.acquire('android', 'other');
    let acquired = false;
    const next = second.acquire('android', 'phone').then(lease => { acquired = true; return lease; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(acquired).toBe(false);
    await a.release();
    const b = await next;
    await Promise.all([other.release(), b.release()]);
  });
  it('cancels a waiting acquire without deleting the live owner lock', async () => {
    const { first, second, rootDir } = await manager();
    const lease = await first.acquire('ios', 'simulator');
    await expect(second.acquire('ios', 'simulator', { signal: AbortSignal.timeout(10) })).rejects.toMatchObject({ code: 'cancelled' });
    expect(await readdir(rootDir)).toHaveLength(1);
    await lease.release();
    expect(await readdir(rootDir)).toHaveLength(0);
  });
  it('retains quarantine after failed cleanup and refuses reuse', async () => {
    const { first, second } = await manager();
    const lease = await first.acquire('android', 'phone');
    await lease.quarantine('Runner cleanup could not be confirmed.');
    await lease.release();
    await expect(second.acquire('android', 'phone')).rejects.toMatchObject({ code: 'cleanup_failed' });
  });
  it('releases idempotently and never treats a live PID as stale just because its heartbeat is old', async () => {
    const { first, second } = await manager();
    const lease = await first.acquire('android', 'phone');
    await expect(second.acquire('android', 'phone', { signal: AbortSignal.timeout(10) })).rejects.toMatchObject({ code: 'cancelled' });
    await Promise.all([lease.release(), lease.release()]);
    const next = await second.acquire('android', 'phone');
    await next.release();
  });
  it.each(['pending-record', 'dangling-link'] as const)('refuses to discard %s permission evidence even without an earlier quarantine', async kind => {
    const { first, second } = await manager();
    const lease = await first.acquire('android', 'phone');
    if (kind === 'pending-record') await writeFile(lease.permissionRecoveryPath!, '{"status":"pending"}');
    else await symlink('missing-original-evidence', lease.permissionRecoveryPath!);
    await expect(lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await lstat(lease.permissionRecoveryPath!)).toBeDefined();
    await expect(second.acquire('android', 'phone')).rejects.toMatchObject({ code: 'cleanup_failed' });
  });
});
