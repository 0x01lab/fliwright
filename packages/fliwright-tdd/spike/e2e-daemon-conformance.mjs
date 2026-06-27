// @fliwright/tdd — real-daemon protocol conformance harness (档4 / design spec §9).
//
// Exercises the REAL FlutterDaemonController + SubprocessDaemonTransport against a booted
// device/emulator and a real Flutter app, asserting the `flutter daemon` wire-format fields the
// controller relies on (appId, wsUri, supportsRestart, app.restart fullRestart). This is the only
// place those assumptions are verified against a real daemon; the unit tests use a fake transport.
//
// Prereqs (see spike/E2E.md):
//   1. pnpm --filter @fliwright/tdd build      (this imports the built dist)
//   2. A booted device/emulator: `flutter devices`
//   3. Env:
//        FLIWR_E2E_PROJECT   absolute path to a runnable Flutter app (required)
//        FLIWR_E2E_DEVICE_ID device id from `flutter devices`        (optional; else first device)
//        FLIWR_E2E_TARGET    entry file                             (optional; default lib/main.dart)
//
// Run: node packages/fliwright-tdd/spike/e2e-daemon-conformance.mjs
// Exits 0 on PASS, non-zero on any field mismatch, 0 with a SKIP notice when no project is set.

const PROJECT = process.env.FLIWRIGHT_E2E_PROJECT;
const TARGET = process.env.FLIWRIGHT_E2E_TARGET ?? 'lib/main.dart';
const DEVICE_ID = process.env.FLIWRIGHT_E2E_DEVICE_ID;

if (!PROJECT) {
  console.log('SKIP: set FLIWR_E2E_PROJECT (absolute path to a Flutter app) to run this harness.');
  process.exit(0);
}

let FlutterDaemonController;
let SubprocessDaemonTransport;

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

async function pickDevice(transport) {
  if (DEVICE_ID) return DEVICE_ID;
  const result = await transport.request('device.getDevices');
  const devices = Array.isArray(result) ? result : result?.devices ?? [];
  const device = devices.find((d) => d?.id) ?? devices[0];
  if (!device?.id) throw new Error('No booted device found. Run `flutter devices` and set FLIWR_E2E_DEVICE_ID.');
  console.log(`Using device: ${device.id} (${device.name ?? device.platform ?? 'unknown'})`);
  return device.id;
}

async function main() {
  ({ FlutterDaemonController, SubprocessDaemonTransport } = await import('../dist/index.js'));
  const transport = new SubprocessDaemonTransport({ cwd: PROJECT });
  await transport.connect();
  const deviceId = await pickDevice(transport);
  const controller = new FlutterDaemonController(transport);

  console.log('\n[1/4] app.start -> appId + wsUri + supportsRestart');
  const handle = await controller.startApp({ deviceId, target: TARGET, mode: 'run' });
  check('app.start returns a non-empty appId', typeof handle.appId === 'string' && handle.appId.length > 0, `appId=${handle.appId}`);
  check('wsUri is a ws:// URL the driver can attach to', typeof handle.wsUri === 'string' && handle.wsUri.startsWith('ws://'), `wsUri=${handle.wsUri}`);
  check('supportsRestart is a boolean', typeof handle.supportsRestart === 'boolean', `supportsRestart=${handle.supportsRestart}`);

  console.log('\n[2/4] reload -> app.restart { fullRestart: false }');
  try {
    await controller.reload(handle.appId);
    check('reload accepted by the daemon (hot reload path works)', true);
  } catch (error) {
    check('reload accepted by the daemon (hot reload path works)', false, error.message);
  }

  console.log('\n[3/4] restart -> app.restart { fullRestart: true }');
  if (handle.supportsRestart) {
    try {
      await controller.restart(handle.appId);
      check('restart accepted by the daemon (hot restart path works)', true);
    } catch (error) {
      check('restart accepted by the daemon (hot restart path works)', false, error.message);
    }
  } else {
    try {
      await controller.restart(handle.appId);
      check('restart is correctly rejected when supportsRestart is false', false, 'expected a thrown doctor error');
    } catch (error) {
      check('restart is correctly rejected when supportsRestart is false', /restart not supported/i.test(error.message), error.message);
    }
  }

  console.log('\n[4/4] stop -> app.stop');
  try {
    await controller.stop(handle.appId);
    check('app.stop accepted by the daemon', true);
  } catch (error) {
    check('app.stop accepted by the daemon', false, error.message);
  }

  await controller.dispose();

  console.log(`\n${failures.length === 0 ? 'CONFORMANCE PASS — daemon protocol matches the controller assumptions.' : `CONFORMANCE FAIL — ${failures.length} mismatch(es): ${failures.join('; ')}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nHARNESS ERROR (daemon did not behave as expected):', error?.message ?? error);
  process.exit(2);
});
