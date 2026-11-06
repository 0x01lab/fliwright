import { describe, expect, it, vi } from 'vitest';
import { XctestSession } from '../src/ios/XctestSession.js';
import { NativeRuntime, type NativeOperationContext } from '@fliwright/core';

const identity = { platform: 'ios' as const, deviceId: 'simulator', appId: 'example.app', backend: 'xctest', generation: 'one' };
const context = (): NativeOperationContext => ({ requestId: 'request', deadline: Date.now() + 1000, signal: AbortSignal.timeout(1000) });
function setup(node: Record<string, unknown> = {}) {
  const request = vi.fn(async (operation: string) => operation === 'snapshot'
    ? { id: 's1', capturedAt: new Date().toISOString(), screen: { width: 400, height: 800, scale: 3, orientation: 'portrait' },
      nodes: [{ id: 'n1', appId: 'example.app', resourceId: 'button', text: 'Button', enabled: true, visible: true, hittable: true,
        frame: { x: 0, y: 0, width: 40, height: 40 }, ...node }] } : { acknowledged: true });
  const dispose = vi.fn(async () => {});
  const session = new XctestSession({ identity, broker: { request }, allowedAppIds: ['example.app', 'com.apple.springboard'],
    systemAppIds: ['com.apple.springboard'], close: dispose });
  return { session, request, dispose };
}
describe('XCTest native adapter', () => {
  it('pushes a scoped query into XCTest and validates the returned snapshot', async () => {
    const { session, request } = setup();
    const query = { field: 'resourceId' as const, value: 'button', exact: true, scope: 'app' as const };
    const snapshot = await session.snapshot(context(), query);
    expect(request).toHaveBeenCalledWith('snapshot', { query, appIds: ['example.app'] }, expect.anything());
    expect(snapshot.identity).toEqual(identity);
  });
  it('uses the last snapshot to address a click and does not implement Android back', async () => {
    const { session, request } = setup();
    const snapshot = await session.snapshot(context());
    await session.execute({ kind: 'click', node: snapshot.nodes[0], snapshotId: snapshot.id }, context());
    expect(request.mock.calls.at(-1)).toMatchObject(['click', { snapshotId: 's1', node: { id: 'n1' } }, expect.anything()]);
    await expect(session.execute({ kind: 'back' }, context())).rejects.toMatchObject({ code: 'unsupported_capability' });
    expect((await session.capabilities(context()))['native.back'].support).toBe('unsupported');
    expect((await session.capabilities(context()))['biometrics.match'].support).toBe('unverified');
  });
  it('does not let a system query escape its declared application scope', async () => {
    const { session, request } = setup();
    await session.snapshot(context(), { field: 'text', value: 'Allow', exact: true, scope: 'system' });
    expect(request).toHaveBeenCalledWith('snapshot', expect.objectContaining({ appIds: ['com.apple.springboard'] }), expect.anything());
  });
  it('rejects unverified text replacement before querying or dispatching input', async () => {
    const { session, request } = setup({ resourceId: 'input', value: 'Original value' });
    const runtime = new NativeRuntime(session);
    try {
      await expect(runtime.native.getById('input').fill('Replacement with spaces')).rejects.toMatchObject({ code: 'unsupported_capability' });
      await expect(runtime.native.getById('input').fill('中文')).rejects.toMatchObject({ code: 'unsupported_capability' });
      expect(request).not.toHaveBeenCalled();
      expect((await session.capabilities(context()))['native.fill.basic']).toMatchObject({ support: 'unverified', ready: false });
    } finally { await runtime.dispose(); }
  });
  it.each(['中文', '\n', 'a'.repeat(4097)])('rejects unsupported input at the adapter boundary before typing', async text => {
    const { session, request } = setup({ resourceId: 'input', value: 'Original value' });
    try {
      const snapshot = await session.snapshot(context());
      await expect(session.execute({ kind: 'fill', node: snapshot.nodes[0], snapshotId: snapshot.id, text }, context()))
        .rejects.toMatchObject({ code: 'unsupported_capability' });
      expect(request.mock.calls.map(call => call[0])).toEqual(['snapshot']);
    } finally { await session.dispose(); }
  });
  it('refuses password replacement at the adapter boundary before dispatching input', async () => {
    const { session, request } = setup({ resourceId: 'password', password: true, value: 'private-value' });
    try {
      const snapshot = await session.snapshot(context());
      await expect(session.execute({ kind: 'fill', node: snapshot.nodes[0], snapshotId: snapshot.id, text: 'new-value' }, context()))
        .rejects.toMatchObject({ code: 'unsupported_capability' });
      expect(request.mock.calls.map(call => call[0])).toEqual(['snapshot']);
    } finally { await session.dispose(); }
  });
  it('closes once and rejects subsequent operations', async () => {
    const { session, dispose } = setup();
    await Promise.all([session.dispose(), session.dispose()]);
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(session.snapshot(context())).rejects.toMatchObject({ code: 'cancelled' });
  });
});
