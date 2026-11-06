import { describe, expect, it, vi } from 'vitest';
import { NativeError, NativeRuntime, type NativeSessionAdapter, type NativeSnapshot } from '../../src/native/index.js';
import { RunSession } from '../../src/RunSession.js';

const identity = { platform: 'android' as const, deviceId: 'test-device', appId: 'test.app', backend: 'test', generation: 'g1' };
function snapshot(overrides: Partial<NativeSnapshot> = {}): NativeSnapshot {
  return {
    id: 's1', identity, capturedAt: new Date().toISOString(),
    screen: { width: 400, height: 800, scale: 2, orientation: 'portrait' },
    nodes: [{ id: 'n1', appId: 'test.app', resourceId: 'test.app:id/submit', text: 'Submit', label: 'Send',
      enabled: true, visible: true, hittable: 'unknown', frame: { x: 10, y: 20, width: 80, height: 40 } }],
    ...overrides,
  };
}
function setup(snapshots: NativeSnapshot[] = [snapshot()]) {
  let index = 0;
  const adapter: NativeSessionAdapter = {
    identity,
    capabilities: vi.fn(async () => Object.fromEntries([
      'native.query', 'native.click', 'native.fill.basic', 'native.swipe', 'native.back', 'screen.capture',
    ].map(key => [key, { support: 'supported', ready: true, backend: 'test' }]))),
    snapshot: vi.fn(async () => snapshots[Math.min(index++, snapshots.length - 1)]),
    execute: vi.fn(async () => ({ acknowledged: true })),
    screenshot: vi.fn(async () => Buffer.from('image')),
    dispose: vi.fn(async () => {}),
  };
  const runtime = new NativeRuntime(adapter, { timeoutMs: 80, pollIntervalMs: 1, systemAppIds: ['system.ui'], externalAppIds: ['external.sdk'] });
  return { adapter, runtime, page: runtime.native, device: runtime.device };
}

describe('native runtime', () => {
  it('checks preparation capabilities without freezing recording before fixture initialization', async () => {
    const { adapter } = setup();
    const session = new RunSession({ runId: 'r', testId: 't', testName: 'prepare' });
    const runtime = new NativeRuntime(adapter, { runSession: session });
    await expect(runtime.preflightCapabilities()).resolves.toHaveProperty('native.query');
    expect(session.snapshot().operations).toEqual([]);
    expect(() => session.configureRecording({ mode: 'standard' })).not.toThrow();
    await runtime.device.capabilities();
    expect(session.snapshot().operations).toHaveLength(1);
    await runtime.dispose();
    await expect(runtime.preflightCapabilities()).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('bounds unrecorded preparation reads and fences a timed-out session', async () => {
    const { adapter } = setup();
    vi.mocked(adapter.capabilities).mockImplementation(async () => new Promise(() => {}));
    const runtime = new NativeRuntime(adapter, { timeoutMs: 20 });
    await expect(runtime.preflightCapabilities()).rejects.toMatchObject({ code: 'timeout' });
    await expect(runtime.device.capabilities()).rejects.toMatchObject({ code: 'precondition_failed' });
    await runtime.dispose();
  });

  it('locates lazily, scopes to the target app, and resolves again for every click', async () => {
    const first = snapshot();
    const second = snapshot({ id: 's2', nodes: [{ ...first.nodes[0], id: 'n2', frame: { x: 100, y: 30, width: 40, height: 40 } }] });
    const { adapter, page } = setup([first, second]);
    const locator = page.getByText('Submit');
    expect(adapter.snapshot).not.toHaveBeenCalled();
    await locator.click();
    await locator.click();
    expect(vi.mocked(adapter.execute).mock.calls.map(([command]) => command)).toMatchObject([
      { kind: 'click', snapshotId: 's1', node: { id: 'n1' } },
      { kind: 'click', snapshotId: 's2', node: { id: 'n2' } },
    ]);
  });

  it('keeps identical text in app, system and allowlisted external apps separate', async () => {
    const base = snapshot();
    const { page } = setup([snapshot({ nodes: [base.nodes[0], { ...base.nodes[0], id: 'sys', appId: 'system.ui' },
      { ...base.nodes[0], id: 'ext', appId: 'external.sdk' }, { ...base.nodes[0], id: 'other', appId: 'untrusted.app' }] })]);
    expect(await page.getByText('Submit').count()).toBe(1);
    expect(await page.getByText('Submit', { scope: 'system' }).count()).toBe(1);
    expect(await page.getByText('Submit', { scope: { appId: 'external.sdk' } }).count()).toBe(1);
    await expect(page.getByText('Submit', { scope: { appId: 'untrusted.app' } }).count()).rejects.toMatchObject({ code: 'precondition_failed' });
  });

  it('rejects ambiguous targets immediately and never clicks an arbitrary first match', async () => {
    const base = snapshot();
    const { adapter, page } = setup([snapshot({ nodes: [base.nodes[0], { ...base.nodes[0], id: 'n2' }] })]);
    await expect(page.getByText('Submit').click()).rejects.toMatchObject({ code: 'strict_mode_violation' });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('preserves structured native error codes and session identity in recorded failures', async () => {
    const { adapter } = setup([snapshot({ nodes: [] })]);
    vi.mocked(adapter.snapshot).mockRejectedValue(new NativeError('transport_lost', 'native transport disconnected', { cause: new Error('socket closed') }));
    const session = new RunSession({ runId: 'r', testId: 't', testName: 'error codes' });
    const runtime = new NativeRuntime(adapter, { runSession: session });
    await expect(runtime.native.getByText('Submit').click()).rejects.toMatchObject({ code: 'transport_lost' });
    expect(session.snapshot().operations[0]).toMatchObject({ error: { name: 'NativeError', code: 'transport_lost', cause: { message: 'socket closed' } },
      metadata: { generation: 'g1', deviceKey: expect.stringMatching(/^[a-f0-9]{64}$/), timeoutMs: 10000 } });
    expect(JSON.stringify(session.snapshot().operations[0].metadata)).not.toContain('test-device');
    await runtime.dispose();
  });

  it('waits for missing and disabled elements before issuing exactly one action', async () => {
    const base = snapshot();
    const { adapter, page } = setup([snapshot({ nodes: [] }), snapshot({ nodes: [{ ...base.nodes[0], enabled: false }] }), base]);
    await page.getById('test.app:id/submit').click();
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects stale or mismatched device/generation snapshots before acting', async () => {
    for (const mismatch of [{ deviceId: 'other' }, { generation: 'old' }, { appId: 'other.app' }]) {
      const { adapter, page } = setup([snapshot({ identity: { ...identity, ...mismatch } })]);
      await expect(page.getByText('Submit').click()).rejects.toMatchObject({ code: 'device_mismatch' });
      expect(adapter.execute).not.toHaveBeenCalled();
    }
  });

  it('does not treat a transport failure as absence for negative waits or assertions', async () => {
    const { adapter, page } = setup();
    vi.mocked(adapter.snapshot).mockRejectedValue(new Error('connection closed'));
    await expect(page.getByText('Submit').waitFor({ state: 'detached' })).rejects.toThrow('connection closed');
    await expect(page.getByText('Submit').expect().not.toBeVisible()).rejects.toThrow('connection closed');
  });

  it('supports exact text, labels and explicit substring matching without matching value as label', async () => {
    const { page } = setup([snapshot({ nodes: [{ ...snapshot().nodes[0], value: 'secret' }] })]);
    expect(await page.getByText('Sub').count()).toBe(0);
    expect(await page.getByText('Sub', { exact: false }).count()).toBe(1);
    expect(await page.getByLabel('Send').count()).toBe(1);
    expect(await page.getByLabel('secret').count()).toBe(0);
  });

  it('passes the scoped query to adapters that can avoid an expensive complete-tree traversal', async () => {
    const { page, adapter } = setup();
    await page.getByText('Submit').count();
    expect(adapter.snapshot).toHaveBeenCalledWith(expect.anything(), { field: 'text', value: 'Submit', exact: true, scope: 'app' });
  });

  it('refuses unsupported capabilities before invoking a write', async () => {
    const { adapter, device } = setup();
    await expect(device.biometrics.match()).rejects.toMatchObject({ code: 'unsupported_capability' });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('does not retry an action whose outcome is unknown', async () => {
    const { adapter, page } = setup();
    vi.mocked(adapter.execute).mockRejectedValue(new Error('response lost'));
    await expect(page.getByText('Submit').click()).rejects.toMatchObject({ code: 'action_outcome_unknown' });
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('marks a transport error after write dispatch as unknown and prevents more actions', async () => {
    const { adapter, page } = setup();
    vi.mocked(adapter.execute).mockRejectedValue(new NativeError('transport_lost', 'ADB connection lost'));
    await expect(page.getByText('Submit').click()).rejects.toMatchObject({ code: 'action_outcome_unknown' });
    await expect(page.back()).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent actions across native and device operations', async () => {
    const { adapter, page } = setup();
    let active = 0;
    let maximum = 0;
    vi.mocked(adapter.execute).mockImplementation(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return {};
    });
    await Promise.all([page.getByText('Submit').click(), page.back(), page.getByText('Submit').click()]);
    expect(maximum).toBe(1);
  });

  it('bounds a hung adapter by the operation deadline and cancels its context', async () => {
    const { adapter, page } = setup();
    let signal: AbortSignal | undefined;
    vi.mocked(adapter.snapshot).mockImplementation(async context => {
      signal = context.signal;
      return new Promise(() => {});
    });
    await expect(page.getByText('Submit').click({ timeout: 10 })).rejects.toMatchObject({ code: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('refuses reuse when a cancelled read may still be running inside the adapter', async () => {
    const { adapter, runtime, page } = setup();
    const controller = new AbortController();
    vi.mocked(adapter.snapshot).mockImplementation(async () => {
      controller.abort();
      return new Promise(() => {});
    });
    await expect(page.snapshot({ signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    await expect(page.back()).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(adapter.execute).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it('records logical actions and native assertions in the existing run session', async () => {
    const { adapter } = setup();
    const session = new RunSession({ runId: 'run', testId: 'native', testName: 'native' });
    const runtime = new NativeRuntime(adapter, { runSession: session });
    await runtime.native.getByText('Submit').click();
    await runtime.native.getByText('Submit').expect('button visible').toBeVisible();
    const result = await session.finish({ status: 'passed', evidenceStatus: 'complete' });
    expect(result.operations).toMatchObject([
      { kind: 'action', outcome: 'passed', metadata: { surface: 'native', action: 'click' } },
      { kind: 'assertion', outcome: 'passed', title: 'button visible', metadata: { surface: 'native' } },
    ]);
  });

  it('masks sensitive fill values in the operation metadata', async () => {
    const { adapter } = setup();
    const session = new RunSession({ runId: 'run', testId: 'fill', testName: 'fill' });
    const runtime = new NativeRuntime(adapter, { runSession: session });
    await runtime.native.getByText('Submit').fill('private-value');
    const result = await session.finish({ status: 'passed', evidenceStatus: 'complete' });
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(adapter.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fill', text: 'private-value' }), expect.anything());
  });

  it('disposes only once and rejects work after closing', async () => {
    const { adapter, runtime, page } = setup();
    await Promise.all([runtime.dispose(), runtime.dispose()]);
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    await expect(page.getByText('Submit').click()).rejects.toMatchObject({ code: 'cancelled' });
  });
});
