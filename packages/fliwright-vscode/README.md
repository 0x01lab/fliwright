# Fliwright

![Fliwright — See. Adapt. Test. Repeat.](media/brand/banner.png)

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
- Use **Take Long App Screenshot** (expand icon beside the camera in the Devices toolbar) to preview vertical scroll content as one PNG. The preview scrolls vertically and the app's original scroll position is restored. Capture requires one visible, non-reversed vertical scroll view; nested scrolling and sticky headers are unsupported.
- Long capture isolates the scroll viewport's painted content, so floating bottom tabs and other sibling overlays are excluded without leaving gaps in the list. Ordinary viewport screenshots still include them.
- Long screenshots require the updated `fliwright_bridge` to be loaded in the running Flutter app; installing the VSIX alone does not update it. Hot reload or relaunch the app after updating the bridge. Capturing scrolls the live viewport, so brief visible jumps are expected; an outdated bridge is rejected before scrolling.
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

## Discovering Tests

Expand a file in the **Tests** view to collect its cases through Vitest in a
separate process. Discovery shares the CLI/Cloud catalog implementation and
supports `test.scenario(...)`, parameterized cases, imported data and generated
titles. Collection needs a trusted workspace and its installed Vitest; it does
not need a running Flutter app. Scenario names must be declared in the project.

Collection loads module-level code but does not run test bodies, hooks or app
fixtures. Results are cached until refresh or a source/configuration change.
File expansions arriving together are batched (up to 32 files) into one Vitest
context; only one collection process runs at a time. Listing cases skips Mock
catalog scanning. Build output, coverage and Fliwright run/cache artifacts do
not invalidate the cache, and completed runs refresh statuses without collecting
again. Refresh cancels pending work, and each batch has a 30-second deadline. Failures appear below the file and in the
**Fliwright** output channel. Use the file's Refresh action to retry.

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

Publishing runs from the matching `vscode-v<version>` tag in GitHub Actions.
Before the first tag, configure a Marketplace Trusted Publishing policy for
`0x01lab/fliwright` and `release-vscode.yml`; the workflow publishes with OIDC
and does not require a PAT secret.

Release checklist:

- Run `pnpm --filter fliwright-vscode lint`.
- Run `pnpm --filter fliwright-vscode test`.
- Run `pnpm --filter fliwright-vscode build`.
- Run `pnpm --filter fliwright-vscode test:integration` in a local VS Code-capable environment.
- Run `pnpm --filter fliwright-vscode package` and `pnpm --filter fliwright-vscode test:vsix` to install and test the generated VSIX in an isolated VS Code profile.
- Bump `package.json` and `CHANGELOG.md` together, then push a matching
  `vscode-v<version>` tag to trigger the GitHub Marketplace release workflow.
- Start `examples/riverpod_demo` through a Fliwright bridge entrypoint, connect from VS Code, refresh State, read `counterProvider`, watch it, tap Increment, verify the value updates, then override `counterProvider` with `2`.
- Publish only after Marketplace metadata, the Trusted Publishing policy, and manual smoke testing are complete.

## Shared project assets and local runtime data

Commit authored `.fliwright/tests`, `scripts`, `mocks`, `forms`, `flows`, and
support modules with the project configuration. Runs, screenshots, traces,
caches, raw recordings, review evidence and VM Service metadata default to
`~/.fliwright/<project-path>/` outside the working tree. The identifier is the
complete project path with `/` and `\` replaced by `-`, including the leading
`-` for a Unix absolute path.

For `/Users/alice/app`, the local partition is `~/.fliwright/-Users-alice-app/`:

| Area | Default location |
| --- | --- |
| Run history and test status | `runs/` |
| Reusable caches and inspection captures | `cache/` |
| Raw recording manifests and frame images | `recordings/` |
| Design review captures and reports | `reviews/` |
| VM Service metadata and TDD status | `runtime/` |
| CLI session journals | `sessions/` |
| Temporary script runner configuration | `tmp/` |

Set `FLIWRIGHT_RUNTIME_ROOT` to override this project partition. Existing
`fliwright.config.ts` settings `runsRoot`, `cacheRoot`, and `paths.recordings`
continue to override their individual areas. Absolute paths, project-relative
paths and `~/` are supported; invocation options override environment settings,
which override project configuration. Shared Flow files store target test paths
relative to the project; their recording screenshots remain local.

Existing project-local artifacts are preserved. They are not moved, merged or
deleted automatically. Point `runsRoot` at an old directory to inspect its runs.
Remove explicit `.fliwright/runs` / `.fliwright/cache` / `.fliwright/recordings`
settings to adopt the new defaults. An unwritable local directory reports an
error instead of silently writing runtime data back into the project.

Local CLI tests and GitLab Item acceptance should use the same project run root
as the extension. Keep Item plans, bindings, coverage and report summaries under
`.fliwright/test-plans/<iid>/` and link the returned run ID and artifact paths.
`run --output <path>` changes only the JSON report destination. A `--runs-root`
override applies to that CLI invocation; the Run Viewer does not discover it
unless the same root is configured for the workspace. CI can still use an
explicit artifact root for upload.
