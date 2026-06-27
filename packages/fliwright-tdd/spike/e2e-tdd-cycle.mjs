// @fliwright/tdd — full TDD loop smoke against a real Flutter app (档4 / design spec §9).
//
// Drives the REAL TddRuntime in daemon-start mode end to end: start (launch app via flutter
// daemon) -> focus -> cycle(none / reload / restart) -> stop, against a Flutter app that already
// has a fliwright test suite configured (e.g. exio). It asserts the loop completes without crashing
// and reports the correct lastSync, printing each TddCycleResult for human inspection. It also
// verifies the RuntimeSnapshot status file used by read-only monitors (VS Code TDD Loop).
//
// Unlike e2e-daemon-conformance.mjs (protocol fields), this exercises the WHOLE runtime:
// driver connect, baseline reset, persistent vitest rerun, and daemon reload/restart.
//
// Prereqs (see spike/E2E.md):
//   1. pnpm --filter @fliwright/tdd build
//   2. A booted device/emulator.
//   3. A Flutter app with .fliwright/ configured (record/generate at least one test).
//   4. Env:
//        FLIWR_E2E_PROJECT    absolute path to the Flutter app      (required)
//        FLIWR_E2E_CONFIG     absolute path to its vitest config    (required)
//        FLIWR_E2E_TEST_FILE  absolute path to a .fliwright test    (required)
//        FLIWR_E2E_TEST_NAME  test name to focus                    (optional)
//        FLIWR_E2E_DEVICE_ID  device id                             (optional; else first device)
//
// Run: node packages/fliwright-tdd/spike/e2e-tdd-cycle.mjs

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = process.env.FLIWRIGHT_E2E_PROJECT;
const CONFIG = process.env.FLIWRIGHT_E2E_CONFIG;
const TEST_FILE = process.env.FLIWRIGHT_E2E_TEST_FILE;
const TEST_NAME = process.env.FLIWRIGHT_E2E_TEST_NAME;
const DEVICE_ID = process.env.FLIWRIGHT_E2E_DEVICE_ID;

const missing = ['PROJECT', 'CONFIG', 'TEST_FILE'].filter((k) => !process.env[`FLIWR_E2E_${k}`]);
if (missing.length > 0) {
  console.log(`SKIP: set FLIWR_E2E_${missing.join(', FLIWR_E2E_')} to run this harness.`);
  process.exit(0);
}

let TddRuntime;
let SubprocessDaemonTransport;
let FlutterDaemonController;

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}
function printResult(label, result) {
  console.log(
    `\n  ${label}: status=${result.status} lastSync=${result.lastSync} `
      + `baselineVersion=${result.baselineVersion} durationMs=${result.durationMs}`
      + `${result.failureContext ? ` kind=${result.failureContext.kind}` : ''}`,
  );
}
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForStatus(statusFilePath, predicate, label) {
  let last;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      last = JSON.parse(await readFile(statusFilePath, 'utf8'));
      if (predicate(last)) return last;
    } catch {
      // Status writes are best-effort and async; keep polling for a short window.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for status file: ${label}${last ? `; last=${JSON.stringify(last)}` : ''}`);
}

async function pickDevice() {
  if (DEVICE_ID) return DEVICE_ID;
  const transport = new SubprocessDaemonTransport({ cwd: PROJECT });
  await transport.connect();
  const result = await transport.request('device.getDevices');
  await transport.dispose();
  const devices = Array.isArray(result) ? result : result?.devices ?? [];
  const device = devices.find((d) => d?.id) ?? devices[0];
  if (!device?.id) throw new Error('No booted device found. Run `flutter devices` and set FLIWR_E2E_DEVICE_ID.');
  return device.id;
}

async function main() {
  ({ TddRuntime, SubprocessDaemonTransport, FlutterDaemonController } = await import('../dist/index.js'));
  const deviceId = await pickDevice();
  const runtime = new TddRuntime({
    daemon: new FlutterDaemonController(new SubprocessDaemonTransport({ cwd: PROJECT })),
  });
  const statusDir = await mkdtemp(join(tmpdir(), 'fliwright-tdd-e2e-'));
  const statusFilePath = join(statusDir, 'tdd-status.json');

  console.log('[1/4] start (daemon-start mode)');
  const startSnap = await runtime.start({
    configRoot: CONFIG,
    app: { deviceId, projectId: PROJECT, target: 'lib/main.dart', mode: 'run' },
    statusFilePath,
  });
  check('runtime reports connected', startSnap.connected === true);
  check('runtime is in start mode (restart-capable)', startSnap.launchMode === 'start', `launchMode=${startSnap.launchMode}`);
  const startStatus = await waitForStatus(statusFilePath, (status) => status.connected === true, 'connected after start');
  check('status file reports connected after start', startStatus.connected === true);

  console.log('\n[2/4] focus');
  await runtime.focus(TEST_FILE, TEST_NAME);
  const focusStatus = await waitForStatus(statusFilePath, (status) => status.focusedTest?.file === TEST_FILE, 'focused test');
  check('status file reports focused test', focusStatus.focusedTest?.file === TEST_FILE);

  console.log('\n[3/4] cycle x3 (none, reload, restart)');
  const none = await runtime.cycle(TEST_NAME, { sync: 'none' });
  printResult('sync=none', none);
  check('cycle(none) returned red|green with lastSync none', (none.status === 'red' || none.status === 'green') && none.lastSync === 'none');
  const noneStatus = await waitForStatus(statusFilePath, (status) => status.lastResult?.lastSync === 'none', 'cycle none result');
  check('status file reports cycle(none)', noneStatus.lastResult?.lastSync === 'none');

  const reload = await runtime.cycle(TEST_NAME, { sync: 'reload' });
  printResult('sync=reload', reload);
  check('cycle(reload) returned red|green with lastSync reload', (reload.status === 'red' || reload.status === 'green') && reload.lastSync === 'reload');
  const reloadStatus = await waitForStatus(statusFilePath, (status) => status.lastResult?.lastSync === 'reload', 'cycle reload result');
  check('status file reports cycle(reload)', reloadStatus.lastResult?.lastSync === 'reload');

  if (startSnap.restartCapable) {
    const restart = await runtime.cycle(TEST_NAME, { sync: 'restart' });
    printResult('sync=restart', restart);
    check('cycle(restart) returned red|green with lastSync restart', (restart.status === 'red' || restart.status === 'green') && restart.lastSync === 'restart');
    const restartStatus = await waitForStatus(statusFilePath, (status) => status.lastResult?.lastSync === 'restart', 'cycle restart result');
    check('status file reports cycle(restart)', restartStatus.lastResult?.lastSync === 'restart');
  } else {
    console.log('\n  (skip restart cycle: app not restart-capable)');
  }

  console.log('\n[4/4] stop');
  await runtime.stop({ keepAppAlive: false });
  const stopSnap = runtime.snapshot();
  check('runtime is disconnected after stop', stopSnap.connected === false);
  const stopStatus = await waitForStatus(statusFilePath, (status) => status.connected === false, 'stopped runtime');
  check('status file reports disconnected after stop', stopStatus.connected === false);

  console.log(`\n${failures.length === 0 ? 'SMOKE PASS — the TDD loop ran end to end.' : `SMOKE FAIL — ${failures.length} check(s) failed: ${failures.join('; ')}`}`);
  console.log('Inspect each TddCycleResult above to confirm the app actually reflected your edits (manual verification).');
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nHARNESS ERROR:', error?.message ?? error);
  process.exit(2);
});
