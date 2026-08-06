# Fliwright

Flutter automation inside VS Code.

Fliwright connects to a running Flutter VM Service and brings app automation,
test recording, local API mocks, failure context, traces, and Riverpod state
inspection into one native VS Code sidebar.

## Features

- Connect to a local Flutter app through the VM Service.
- Discover and run Fliwright TypeScript scripts and Vitest E2E tests.
- Record device interactions into editable TypeScript test code.
- Apply and clear local API mock rules from `.fliwright/mocks`.
- Generate and fill form data from `.fliwright/forms` rules.
- Inspect screenshots, run history, failure context, and traces.
- List, read, watch, copy, and override Riverpod providers exposed by the
  Fliwright bridge.

## Requirements

- A Flutter app with `fliwright_bridge` initialized in a debug or test
  entrypoint.
- A reachable Flutter VM Service URL, or a locally running app on a common
  Flutter debug port.
- TypeScript Fliwright packages installed in the workspace when running tests or
  automation scripts.

Mock files are JSON-only. Legacy YAML mock files are not supported.

## Running Scripts

Put runnable automation scripts under `.fliwright/scripts/`, for example:

```text
.fliwright/scripts/auto-register-fill.mjs
```

Start the Flutter app with the Fliwright bridge enabled, then connect the VS Code
extension from the `Devices` view or let it auto-discover the VM Service. The
`Scripts` view lists discovered scripts. Select one and click the inline Run
action, or use `Fliwright: Run Script`.

The script process receives both `FLIWRIGHT_VM_SERVICE_URL` and
`FLIWRIGHT_VM_URL` from the connected session. Runtime stdout/stderr is streamed
to the `Fliwright` output channel, and the final pass/fail result is added to
the `Runs` view.

## Recording Tests

1. Start the Flutter app with `FliwrightBridge.init()` enabled and connect the extension to the VM Service.
2. Run `Fliwright: Start Recording` from the Command Palette, Runs view, status bar, or CodeLens, then enter a generated test name.
3. Interact with the app on the device or simulator.
4. Run `Fliwright: Stop Recording` to preview the generated TypeScript test.
5. Choose `Insert Test`, then save the result as a new test file or insert it at the active editor cursor.

Recording requires the running app to expose the bridge recording extensions (`ext.fliwright.startRecording`, `ext.fliwright.stopRecording`, and `ext.fliwright.hitTest`). If those extensions are unavailable, the command returns to the connected idle state and shows the VM Service error in the Fliwright output channel.

## Riverpod Setup

Use the Riverpod observer adapter in a debug or test entrypoint. This keeps
business provider definitions unchanged and avoids a hard Riverpod dependency in
the base bridge package.

```dart
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge_riverpod/fliwright_bridge_riverpod.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  FliwrightBridge.init();

  runApp(ProviderScope(
    observers: kDebugMode ? const [FliwrightRiverpodObserver()] : const [],
    child: const MyApp(),
  ));
}
```

If the app creates its own `ProviderContainer` and uses
`UncontrolledProviderScope`, attach the observer to that container:

```dart
final container = ProviderContainer(
  observers: kDebugMode ? const [FliwrightRiverpodObserver()] : const [],
);

runApp(
  UncontrolledProviderScope(container: container, child: const MyApp()),
);
```

Observer-only providers support list, read, and watch. Override requires an
explicit writable registration:

```dart
registerFliwrightWritableProvider(
  'counterProvider',
  (value) {
    final next = value as int;
    ref.read(counterProvider.notifier).state = next;
    return next;
  },
);
```

## Development

```bash
pnpm --filter fliwright-vscode build
pnpm --filter fliwright-vscode lint
pnpm --filter fliwright-vscode test
pnpm --filter fliwright-vscode test:integration
```

Open `packages/fliwright-vscode` in VS Code or launch an Extension Development Host using this package as the extension root.

## Local Packaging

```bash
pnpm --filter fliwright-vscode package
```

The package script builds the extension and invokes the repository-managed
`@vscode/vsce` binary, so generated `dist/` output does not need to be committed.

Run the full release gate before publishing:

```bash
pnpm --filter fliwright-vscode verify:release
```

Publish to the VS Code Marketplace with a configured `VSCE_PAT`:

```bash
pnpm --filter fliwright-vscode publish:vsce
```

Release checklist:

- Run `pnpm --filter fliwright-vscode lint`.
- Run `pnpm --filter fliwright-vscode test`.
- Run `pnpm --filter fliwright-vscode build`.
- Run `pnpm --filter fliwright-vscode test:integration` in a local VS Code-capable environment.
- Run `pnpm --filter fliwright-vscode package` and install the generated VSIX in an Extension Development Host.
- Bump `package.json` and `CHANGELOG.md` together, then push a matching
  `vscode-v<version>` tag to trigger the GitHub Marketplace release workflow.
- Start `examples/riverpod_demo` through a Fliwright bridge entrypoint, connect from VS Code, refresh State, read `counterProvider`, watch it, tap Increment, verify the value updates, then override `counterProvider` with `2`.
- Publish only after Marketplace metadata, publisher credentials, and manual smoke testing are complete.
