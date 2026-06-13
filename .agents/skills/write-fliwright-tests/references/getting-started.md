# Getting Started

Write your first Fliwright test in five steps: wire the bridge, start the app, set a VM URL, write a `.test.ts`, run it.

## 1. Initialize the bridge in the app under test

Fliwright drives Flutter through Dart VM Service extensions registered by the
`fliwright_bridge` package. Initialize it **only in debug builds** in your app's `main()`:

```dart
import 'package:flutter/foundation.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

Future<void> main() async {
  if (kDebugMode) {
    await FliwrightBridge.init();
  }
  runApp(const MyApp());
}
```

If your tests use route navigation (`page.navigate('/login')`), pass your router:

```dart
await FliwrightBridge.init(router: myGoRouter);
```

Rebuild/restart the app after adding this. The bridge registers extensions like
`ext.fliwright.snap`, `ext.fliwright.action`, `ext.fliwright.extractForm`, and `ext.fliwright.mock.*`.

## 2. Start the app and copy the VM Service URL

```bash
fvm flutter run -d macos --debug     # or ios / android / windows / linux
```

The console prints a line like:

```
A Dart VM Service on macOS is available at: http://127.0.0.1:54321/abc=/
```

The fixture accepts the HTTP URL and converts it to `ws://…/ws` automatically, so either form works.
Keep the app running — tests connect to it.

## 3. Set the VM URL for the test process

Pick one mechanism (the fixture reads them in this priority order):

```bash
# Option A — recommended env var
export FLIWRIGHT_VM_URL="http://127.0.0.1:54321/abc=/"

# Option B — compatibility alias (older docs)
export FLIWRIGHT_VM_SERVICE_URL="http://127.0.0.1:54321/abc=/"
```

If neither is set, the test throws:

```
No VM Service URL provided. Set FLIWRIGHT_VM_URL or FLIWRIGHT_VM_SERVICE_URL,
or use createFliwrightTest({ vmServiceUrl }).
```

## 4. Write the test

A minimal test using the default `@fliwright/vitest` fixture:

```typescript
// counter.test.ts
import { test, expect } from '@fliwright/vitest';

test('counter increments when the increment button is tapped', async ({ page }) => {
  await expect(page.getByText('Count: 0')).toBeVisible();

  await page.getByText('Increment').click();

  await expect(page.getByText('Count: 1')).toBeVisible({ timeout: 3_000 });
});
```

That's it. The fixture:

- reads `FLIWRIGHT_VM_URL` (with `FLIWRIGHT_VM_SERVICE_URL` fallback),
- creates **one shared `FliwrightDriver`** and connects it,
- injects `{ page, driver }` into each test,
- wires failure context (screenshot + widget tree + diagnostics + source) when run through the CLI/MCP.

See [test-harness.md](./test-harness.md) for custom configs and lifecycle control.

## 5. Run the test

Through the CLI (recommended — emits the AI/human report, persists screenshots, prints a reproduce command):

```bash
fliwright run \
  --test path/to/counter.test.ts \
  --vm-url "ws://127.0.0.1:54321/abc=/ws" \
  --reporter ai-json
```

For a quick smoke check you can call Vitest directly, but you will **not** get the persisted report
unless you go through `fliwright run`:

```bash
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm vitest run path/to/counter.test.ts
```

See [cli.md](./cli.md) for all flags and reporters.

## Prerequisites checklist

| Requirement | How to verify |
| --- | --- |
| App runs the **current** bridge | `ext.fliwright.snap` responds (see [screenshots-snapshots.md](./screenshots-snapshots.md)). `fliwright doctor` checks capabilities. |
| VM Service URL exported | `echo $FLIWRIGHT_VM_URL` is non-empty. |
| `@fliwright/vitest` + `@fliwright/core` resolvable | your `package.json` depends on them; `fliwright init` can scaffold a config. |
| App stable (no crash loop) | the screen is interactive in the running app. |

If `ext.fliwright.snap` returns `Unknown method …`, the app is on an older bridge. **Do not** keep
clicking through an unstable screen — restart/rebuild the app first. Details in
[troubleshooting.md](./troubleshooting.md).

## Where to go next

- Learn the fixture and hooks → [test-harness.md](./test-harness.md)
- Locate widgets reliably → [selectors.md](./selectors.md)
- Assert on visible outcomes → [assertions.md](./assertions.md)
- Copy a full template → [examples.md](./examples.md)
