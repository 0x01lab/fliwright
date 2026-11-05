import { describe, expect, it, vi } from 'vitest';
import * as core from '../src/index.js';

function probe() {
  let generation = 0;
  let pending = 0;
  let consumed = 0;
  const status = () => ({ schemaVersion: 1, surface: 'app-test-seam', generation: `g${generation}`, pending, consumed,
    enqueued: pending + consumed, loading: false, consumedResults: Array.from({ length: consumed }, () => ({ kind: 'cancel' })) });
  const invoke = vi.fn(async (_capability: string, method: string, input?: any) => {
    if (input?.generation && input.generation !== `g${generation}`) throw new Error('previous attempt');
    if (method === 'reset') { generation++; pending = 0; consumed = 0; }
    if (method === 'enqueueResult') pending++;
    return status();
  });
  const app = { listCapabilities: vi.fn(async () => [{ name: 'cameraTest', methods: ['reset', 'enqueueResult', 'getStatus'] }]), invoke };
  return { app, consume() { pending--; consumed++; }, status };
}

describe('CameraTestController', () => {
  it('uses only the registered app capability, binds generations and marks seam coverage', async () => {
    const f = probe();
    const session = new core.RunSession({ runId: 'r', testId: 't', testName: 'camera' });
    const camera = await core.CameraTestController.create(f.app, { runSession: session });
    await camera.enqueueResult({ kind: 'image', fixtureId: 'portrait' });
    f.consume();
    expect(await camera.getStatus()).toMatchObject({ consumed: 1, pending: 0 });
    await camera.dispose();
    expect(f.app.invoke).toHaveBeenCalledWith('cameraTest', 'enqueueResult', {
      generation: 'g1', result: { kind: 'image', fixtureId: 'portrait' },
    });
    expect(f.app.invoke).toHaveBeenLastCalledWith('cameraTest', 'reset', { generation: 'g1' });
    expect(session.snapshot().operations).toContainEqual(expect.objectContaining({
      title: 'Camera test consumption', metadata: expect.objectContaining({ coverage: 'app-test-seam', consumed: 1, pending: 0 }),
    }));
    expect(session.snapshot().operations.every(op => op.metadata?.coverage === 'app-test-seam')).toBe(true);
  });

  it('fails for unused queued results while still resetting and invalidating the old generation', async () => {
    const f = probe();
    const camera = await core.CameraTestController.create(f.app);
    await camera.enqueueResult({ kind: 'cancel' });
    await expect(camera.dispose()).rejects.toThrow(/1.*unconsumed/);
    expect(f.status()).toMatchObject({ generation: 'g2', pending: 0 });
    await expect(camera.enqueueResult({ kind: 'cancel' })).rejects.toThrow(/closed/);
    await expect(camera.dispose()).rejects.toThrow(/unconsumed/);
    expect(f.app.invoke.mock.calls.filter(call => call[1] === 'reset')).toHaveLength(2);
  });

  it('never resets a newer attempt when an old controller tears down', async () => {
    const f = probe();
    const first = await core.CameraTestController.create(f.app);
    const second = await core.CameraTestController.create(f.app);
    await second.enqueueResult({ kind: 'cancel' });
    await expect(first.dispose()).rejects.toThrow();
    expect(f.status()).toMatchObject({ generation: 'g2', pending: 1 });
    f.consume();
    await second.dispose();
  });

  it.each([{ capabilities: [] }, { capabilities: [{ name: 'cameraTest', methods: ['reset'] }] }])('fails missing or incomplete capabilities without invoking them', async ({ capabilities }) => {
    const f = probe(); f.app.listCapabilities.mockResolvedValue(capabilities);
    await expect(core.CameraTestController.create(f.app)).rejects.toThrow(/cameraTest/);
    expect(f.app.invoke).not.toHaveBeenCalled();
  });

  it('rejects host paths before sending and refuses writes after an unknown enqueue outcome', async () => {
    const f = probe();
    const camera = await core.CameraTestController.create(f.app);
    await expect(camera.enqueueResult({ kind: 'image', fixtureId: '/host/image.png' })).rejects.toThrow(/fixture/);
    expect(f.app.invoke).toHaveBeenCalledTimes(1);
    f.app.invoke.mockRejectedValueOnce(new Error('transport lost'));
    await expect(camera.enqueueResult({ kind: 'cancel' })).rejects.toThrow('transport lost');
    await expect(camera.enqueueResult({ kind: 'cancel' })).rejects.toThrow(/unknown/);
    expect(f.app.invoke.mock.calls.filter(call => call[1] === 'enqueueResult')).toHaveLength(1);
    await camera.dispose();
  });

  it.each([
    { surface: 'native' }, { schemaVersion: 99 }, { pending: -1 }, { enqueued: 5 }, { generation: 'other' },
  ])('rejects incompatible or stale consumption status: %j', async (override) => {
    const f = probe();
    const camera = await core.CameraTestController.create(f.app);
    f.app.invoke.mockResolvedValueOnce({ ...f.status(), ...override });
    await expect(camera.getStatus()).rejects.toThrow(/camera.*(status|generation)/i);
    await camera.dispose();
  });

  it('bounds a stalled cleanup and never sends a reset after its cleanup signal expires', async () => {
    const f = probe();
    const camera = await core.CameraTestController.create(f.app, { timeoutMs: 15 });
    f.app.invoke.mockImplementationOnce(async () => new Promise(() => {}));
    await expect(camera.dispose({ signal: AbortSignal.timeout(5) })).rejects.toThrow();
    expect(f.app.invoke.mock.calls.filter(call => call[1] === 'reset')).toHaveLength(1);
  });
});
