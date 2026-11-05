import { expect, it, vi } from 'vitest';
import { ManagedNativeTelemetry, type ManagedNativePhaseEvent } from '../src/ManagedNativeTelemetry.js';
import { createHash } from 'node:crypto';

it('emits paired phases without reporting success while owned work is pending and hashes the attempt key', async () => {
  const events: ManagedNativePhaseEvent[] = [];
  const telemetry = new ManagedNativeTelemetry(event => { events.push(event); });
  let finish!: () => void;
  const work = telemetry.run('native.install', () => new Promise<void>(resolve => { finish = resolve; }), { attemptKey: 'run/private test/0' });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'started', phase: 'native.install', attemptKeyHash: createHash('sha256').update('run/private test/0').digest('hex') });
  finish(); await work;
  expect(events[1]).toMatchObject({ type: 'finished', id: events[0].id, phase: 'native.install', status: 'succeeded' });
  expect(JSON.stringify(events)).not.toContain('private test');
});

it('preserves original failures and reports cancellation without accepting raw diagnostics', async () => {
  const events: ManagedNativePhaseEvent[] = [], telemetry = new ManagedNativeTelemetry(event => { events.push(event); });
  const failure = new Error('secret ws://token/ /private/app.apk');
  await expect(telemetry.run('native.verify', async () => { throw failure; })).rejects.toBe(failure);
  const controller = new AbortController();
  await expect(telemetry.run('native.launch', async () => { controller.abort(new DOMException('deadline', 'TimeoutError')); throw failure; }, { signal: controller.signal })).rejects.toBe(failure);
  expect(events[1]).toMatchObject({ status: 'failed' });
  expect(events[3]).toMatchObject({ status: 'interrupted', reason: 'timeout' });
  expect(JSON.stringify(events)).not.toMatch(/secret|token|app\.apk|deadline/);
});

it('isolates faulty observers and emits a single end for an idempotently closed phase', async () => {
  const observer = vi.fn(() => { throw Error('broken telemetry sink'); });
  expect(await new ManagedNativeTelemetry(observer).run('native.cleanup', async () => 42)).toBe(42);
  const events: ManagedNativePhaseEvent[] = [], telemetry = new ManagedNativeTelemetry(event => { events.push(event); });
  const phase = telemetry.start('native.build');
  phase.finish(); phase.finish(new Error('late')); phase.finish();
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ status: 'succeeded' });
});
