import { afterEach, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readWorkerLogs } from '../src/diagnostics.js';
import { CloudStore, createCloudServer } from '@fliwright/cloud';
import { createHash } from 'node:crypto';

const roots: string[] = [], children: ChildProcess[] = [];
afterEach(() => { for (const child of children.splice(0)) child.kill('SIGKILL'); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const main = resolve('dist/main.js');
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'worker-service-cli-')); roots.push(root);
  const config = join(root, 'worker.json');
  writeFileSync(config, JSON.stringify({ serverUrl: 'http://127.0.0.1:1', tokenEnv: 'TEST_DIAGNOSTIC_TOKEN', root }));
  return { root, config };
}
function launch(config: string, extra: string[] = []) {
  const child = spawn(process.execPath, [...extra, main, 'run', config], { env: { ...process.env, TEST_DIAGNOSTIC_TOKEN: 'private-cli-diagnostic-token' }, stdio: 'pipe' });
  children.push(child); child.stdout?.resume(); child.stderr?.resume();
  return child;
}
async function started(root: string) {
  for (let i = 0; i < 100; i++) { if (existsSync(join(root, 'logs', 'service.json'))) return; await delay(20); }
  throw new Error('Worker did not initialize diagnostics');
}
it('persists an unhandled rejection before exiting nonzero, and exposes it through offline logs', async () => {
  const { root, config } = setup();
  const preload = join(root, 'reject.mjs');
  writeFileSync(preload, "setTimeout(() => Promise.reject(new Error('unexpected Bearer private-cli-diagnostic-token')), 500);");
  const child = launch(config, ['--import', preload]);
  const code = await new Promise(resolve => child.once('exit', resolve));
  expect(code).toBe(1);
  expect(readWorkerLogs(root).at(-1)).toMatchObject({ level: 'fatal', event: 'service.unhandled_rejection', stack: expect.stringContaining('Error:') });
  const result = spawnSync(process.execPath, [main, 'logs', config], { encoding: 'utf8' });
  expect(result.status).toBe(0); expect(result.stdout).toContain('service.unhandled_rejection');
  expect(result.stdout).not.toContain('private-cli-diagnostic-token');
});
it('identifies a previous SIGKILL on the next startup without discarding its diagnostics', async () => {
  const { root, config } = setup();
  const first = launch(config); await started(root);
  const ended = new Promise(resolve => first.once('exit', resolve)); first.kill('SIGKILL'); await ended;
  const oldSession = JSON.parse(readFileSync(join(root, 'logs', 'service.json'), 'utf8')).sessionId;
  const second = launch(config);
  for (let i = 0; i < 100 && !readWorkerLogs(root).some(log => log.event === 'service.previous_unclean_exit'); i++) await delay(20);
  expect(readWorkerLogs(root).some(log => log.event === 'service.previous_unclean_exit' && log.message.includes(oldSession))).toBe(true);
  const done = new Promise(resolve => second.once('exit', resolve)); second.kill('SIGTERM'); await done;
});

it('records uncaught exceptions and exits without leaking the raw credential to supervisor stderr', async () => {
  const { root, config } = setup();
  const preload = join(root, 'throw.mjs');
  writeFileSync(preload, "setTimeout(() => { throw new Error('Bearer private-cli-diagnostic-token'); }, 500);");
  const child = launch(config, ['--import', preload]); let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk; });
  expect(await new Promise(resolve => child.once('exit', resolve))).toBe(1);
  expect(readWorkerLogs(root).at(-1)).toMatchObject({ level: 'fatal', event: 'service.uncaught_exception' });
  expect(stderr).not.toContain('private-cli-diagnostic-token');
});

it('reports a real idle Worker service to Cloud and retains its fatal log after process restart', async () => {
  const { root, config } = setup();
  const store = new CloudStore(join(root, 'db')); store.configure([], [{ id: 'mac', slots: [] }]);
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'https://cloud.test', proxySecret: 'proxy', publicationSecret: 'publication', users: {}, ciTokens: [], workerTokens: [{ workerId: 'mac', hash: createHash('sha256').update('private-cli-diagnostic-token').digest('hex') }], minFreeBytes: 0 });
  let first: ChildProcess | undefined, second: ChildProcess | undefined;
  try {
    const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    const tool = join(root, 'device-tool');
    writeFileSync(tool, `#!${process.execPath}\nif(process.argv.includes('track-devices')||process.argv.includes('observe')) setInterval(()=>{},10000);else console.log(process.argv.includes('simctl')?'{}':process.argv.includes('xcdevice')?'[]':'List of devices attached');`, { mode: 0o700 });
    writeFileSync(config, JSON.stringify({ serverUrl, tokenEnv: 'TEST_DIAGNOSTIC_TOKEN', root, deviceTools: { adb: tool, emulator: tool, xcrun: tool } }));
    const preload = join(root, 'crash-after-monitor.mjs');
    writeFileSync(preload, "setTimeout(() => { throw new Error('Service crashed after monitoring'); }, 1200);");
    first = launch(config, ['--import', preload]);
    for (let i = 0; i < 100 && !store.listWorkers()[0].service; i++) await delay(20);
    expect(store.listWorkers()[0].service?.status).toBe('healthy');
    await new Promise(resolve => first!.once('exit', resolve));
    second = launch(config);
    for (let i = 0; i < 100 && !store.workerDiagnostics.view('mac').logs.some(log => log.event === 'service.uncaught_exception'); i++) await delay(20);
    expect(store.workerDiagnostics.view('mac').logs.some(log => log.message === 'Service crashed after monitoring')).toBe(true);
    expect(store.workerDiagnostics.view('mac').sessions.some(session => session.status === 'failed')).toBe(true);
    const done = new Promise(resolve => second!.once('exit', resolve)); second.kill('SIGTERM'); await done;
    expect(store.workerDiagnostics.view('mac').sessions[0].status).toBe('stopped');
  } finally {
    for (const child of [first, second]) if (child && child.exitCode === null) child.kill('SIGKILL');
    await server.close(); store.close();
  }
}, 15000);

it('retains the real missing configuration error before any credentials can be loaded', () => {
  const { root } = setup(); const path = join(root, 'missing-worker.json');
  const result = spawnSync(process.execPath, [main, 'run', path], { encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(readWorkerLogs(join(root, 'runtime')).at(-1)).toMatchObject({ event: 'service.failed', message: expect.stringContaining('ENOENT') });
});
