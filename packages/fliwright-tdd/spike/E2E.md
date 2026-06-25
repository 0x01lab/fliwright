# Fliwright TDD — Real-Flutter E2E Harnesses

These two scripts verify the TDD runtime against a **real** `flutter daemon` and a **real** app.
They are intentionally **manual** (no CI gate): they need a booted device/emulator and a built
package, which the CI environment does not provide. Run them locally before relying on the loop.

They close the two gaps the unit suite (fake transport, in-memory executor) cannot cover:
1. the `flutter daemon` JSON-RPC wire format across Flutter versions, and
2. the whole runtime path (driver connect → baseline reset → persistent vitest rerun → daemon reload/restart).

## Prerequisites (both harnesses)

```bash
# 1. Build the package (the harnesses import the compiled dist).
pnpm --filter @fliwright/tdd build

# 2. Boot a device or emulator and confirm it.
flutter devices
```

## 1. Daemon protocol conformance — `e2e-daemon-conformance.mjs`

Verifies the `flutter daemon` field names the controller depends on (`appId`, `wsUri`,
`supportsRestart`, `app.restart { fullRestart }`) against your real Flutter version. This is the
**only** place those assumptions are checked against a real daemon.

```bash
FLIWR_E2E_PROJECT=/path/to/flutter_app \
  node packages/fliwright-tdd/spike/e2e-daemon-conformance.mjs
```

| Env var | Required | Meaning |
|---|---|---|
| `FLIWR_E2E_PROJECT` | yes | Absolute path to a runnable Flutter app |
| `FLIWR_E2E_DEVICE_ID` | no | Device id; defaults to the first booted device |
| `FLIWR_E2E_TARGET` | no | Entry file; default `lib/main.dart` |

It launches the app, runs reload + (hot) restart, then stops it, asserting each field at every
step. Exits non-zero with a field-level report on any mismatch.

## 2. Full TDD loop smoke — `e2e-tdd-cycle.mjs`

Drives the real `TddRuntime` end to end: daemon-start → focus → `cycle(none|reload|restart)` →
stop, against a Flutter app that already has a fliwright test suite (e.g. **exio**). Asserts the
loop completes without crashing and reports the right `lastSync`; prints each `TddCycleResult`.

```bash
FLIWR_E2E_PROJECT=/path/to/exio_app \
FLIWR_E2E_CONFIG=/path/to/exio_app/.fliwright/vitest.config.ts \
FLIWR_E2E_TEST_FILE=/path/to/exio_app/.fliwright/tests/some.test.ts \
FLIWR_E2E_TEST_NAME="shows the home screen" \
  node packages/fliwright-tdd/spike/e2e-tdd-cycle.mjs
```

| Env var | Required | Meaning |
|---|---|---|
| `FLIWR_E2E_PROJECT` | yes | Absolute path to the Flutter app |
| `FLIWR_E2E_CONFIG` | yes | Absolute path to the app's fliwright vitest config |
| `FLIWR_E2E_TEST_FILE` | yes | Absolute path to a `.fliwright` test file |
| `FLIWR_E2E_TEST_NAME` | no | Test name to focus |
| `FLIWR_E2E_DEVICE_ID` | no | Device id; defaults to the first booted device |

> **Manual verification the harness cannot automate:** to confirm reload/restart *reflect edits*,
> change a method body (expect reload to pick it up) or a structural declaration (expect restart to
> pick it up) between two `cycle` runs and eyeball the printed `TddCycleResult`. Editing source
> mid-script is fragile, so this is left to you.

## Exit codes

`0` = pass (or SKIP when required env is unset), `1` = assertion failure, `2` = harness/daemon error.
