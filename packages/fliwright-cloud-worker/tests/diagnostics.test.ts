import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerDiagnostics, readWorkerLogs, reportWorkerDiagnostics } from '../src/diagnostics.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function setup(maxBytes = 4096) {
  const root = mkdtempSync(join(tmpdir(), 'worker-diagnostics-')); roots.push(root);
  return { root, log: new WorkerDiagnostics(root, { secrets: ['private-worker-token'], maxBytes }) };
}
it('persists correlated errors and stack traces without credentials, even before a Cloud connection exists', () => {
  const { root, log } = setup();
  log.record('error', 'executor.failed', new Error('Bearer private-worker-token at ws://localhost:12/token=/ws password=hidden'), { slotId: 'ios', attemptId: 'attempt' });
  const entries = readWorkerLogs(root);
  expect(entries.at(-1)).toMatchObject({ level: 'error', event: 'executor.failed', slotId: 'ios', attemptId: 'attempt', sessionId: log.sessionId });
  expect(entries.at(-1)?.stack).toContain('Error:');
  const text = JSON.stringify(entries);
  for (const secret of ['private-worker-token', 'token=/ws', 'hidden']) expect(text).not.toContain(secret);
  expect(statSync(join(root, 'logs', 'worker.jsonl')).mode & 0o777).toBe(0o600);
});
it('rotates bounded files and reports abnormal previous sessions after restart', () => {
  const { root, log } = setup(1024);
  for (let i = 0; i < 20; i++) log.record('warn', 'test.failure', 'x'.repeat(250));
  expect(readdirSync(join(root, 'logs')).filter(name => name.startsWith('worker.jsonl')).length).toBeLessThanOrEqual(4);
  const next = new WorkerDiagnostics(root);
  expect(readWorkerLogs(root).some(entry => entry.event === 'service.concurrent_instance')).toBe(true);
  expect(next.sessionId).not.toBe(log.sessionId);
});
it('keeps diagnostic persistence failures from crashing or hiding the original error', () => {
  const { root, log } = setup();
  rmSync(root, { recursive: true, force: true });
  expect(() => log.record('fatal', 'service.failed', new Error('original'))).not.toThrow();
});
it('reports stopped service state and failed components independently of any running test', () => {
  const { log } = setup();
  log.component('catalog', 'failed');
  expect(log.snapshot()).toMatchObject({ state: 'degraded', components: { catalog: 'failed' } });
  log.record('fatal', 'service.failed', new Error('failure'));
  expect(log.snapshot()).toMatchObject({ state: 'failed' });
  expect(JSON.parse(readFileSync(log.path, 'utf8').trim().split('\n').at(-1)!)).toMatchObject({ event: 'service.failed' });
});
it('replays retained logs in acknowledged batches after an offline period without dropping the middle', async () => {
  const { log } = setup(1000000);
  for (let i = 0; i < 220; i++) log.record('info', 'batch.event', String(i));
  const delivered: Array<{ sessionId: string; seq: number }> = [];
  let offline = true;
  const control = { request: vi.fn(async (_path: string, options?: { body?: unknown }) => {
    if (offline) throw new Error('offline');
    delivered.push(...(options!.body as { logs: typeof delivered }).logs);
    return {} as never;
  }) };
  const stop = reportWorkerDiagnostics(log, control, 5);
  try {
    await new Promise(resolve => setTimeout(resolve, 15)); offline = false;
    await vi.waitFor(() => expect(new Set(delivered.filter(entry => entry.sessionId === log.sessionId).map(entry => entry.seq)).size).toBeGreaterThanOrEqual(221));
  } finally { await stop(); }
});
