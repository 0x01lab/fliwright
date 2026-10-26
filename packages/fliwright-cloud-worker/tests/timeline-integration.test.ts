import { expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { CloudStore, createCloudServer } from '@fliwright/cloud';
import { WorkerControlClient } from '@fliwright/cloud-protocol';
import { workerConfigSchema } from '../src/config.js';

it.skipIf(process.platform === 'win32')('records a real executor failure and reset child through durable IPC and authenticated WebSocket batches without a report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-timeline-integration-'));
  const store = new CloudStore(join(root, 'db'));
  store.configure([{ id: 'app', name: 'App', repository: join(root, 'missing-repository'), suites: { smoke: '*.test.ts' }, scenarios: ['clean'] }],
    [{ id: 'mac', slots: [{ id: 'ios', deviceId: 'phone', targets: ['app'] }] }]);
  store.recordDeviceInventory('mac', { scannedAt: new Date().toISOString(), devices: [{ id: 'phone', name: 'Synthetic', platform: 'ios', kind: 'physical', state: 'online' }], diagnostics: [] });
  const token = 'synthetic-timeline-token';
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'http://localhost', proxySecret: 'proxy', publicationSecret: 'publication', users: {}, ciTokens: [], workerTokens: [{ workerId: 'mac', hash: createHash('sha256').update(token).digest('hex') }], minFreeBytes: 0 });
  const url = await server.listen({ host: '127.0.0.1', port: 0 });
  const client = new WorkerControlClient(url, token);
  const request = store.submit({ targetId: 'app', commit: 'a'.repeat(40), suite: 'smoke', scenario: 'clean' }, 'synthetic', 'timeline-integration');
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'));
    const source = fileURLToPath(new URL('../src', import.meta.url));
    for (const file of readdirSync(source).filter(name => name.endsWith('.ts'))) {
      writeFileSync(join(root, file.replace(/\.ts$/, '.js')), ts.transpileModule(readFileSync(join(source, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    }
    vi.stubEnv('TEST_TIMELINE_TOKEN', token);
    const { createWorker } = await import(pathToFileURL(join(root, 'worker.js')).href);
    const worker = createWorker(workerConfigSchema.parse({ serverUrl: url, tokenEnv: 'TEST_TIMELINE_TOKEN', workerId: 'mac', slotId: 'ios', deviceId: 'phone', root: join(root, 'spool-root'), heartbeatMs: 500,
      resetCommands: [{ program: process.execPath, args: ['-e', 'process.exit(0)'] }] }), client);
    expect(await worker.runOnce()).toBe(true);
    const attempt = store.attempts(request.id)[0];
    const view = store.workerTimelines.view(request.id, attempt.attemptId);
    expect(view).toMatchObject({ executionStatus: 'finished', testVerdict: 'unknown', quality: 'complete', outcome: { publication: 'unavailable', cleanup: 'clean' } });
    expect(view.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'execution.prepare', status: 'succeeded' }),
      expect.objectContaining({ phase: 'repository.checkout', operation: 'clone', status: 'failed', exitCode: 128 }),
      expect.objectContaining({ phase: 'device.reset.after', operation: 'command', commandIndex: 0, status: 'succeeded' }),
    ]));
    expect(view.spans.some(span => span.phase === 'report.publish')).toBe(false);
    expect(view.report).toBeUndefined();
    const local = readFileSync(join(root, 'spool-root', 'spool', attempt.attemptId, 'worker-timeline.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(view.cursor).toBe(local.length);
  } finally {
    vi.unstubAllEnvs(); client.close(); await server.close(); store.close(); rmSync(root, { recursive: true, force: true });
  }
}, 15000);
