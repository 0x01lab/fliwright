# Fliwright Test Authoring Reference — Index

This directory is the backing knowledge base for the **`write-fliwright-tests`** skill.
Load the topic you need on demand; you do not need to read all of it before writing a test.

> Start with **[getting-started.md](./getting-started.md)** if you are new to the framework.
> Jump to **[api-quick-reference.md](./api-quick-reference.md)** for a one-page cheat-sheet of every signature.

## Topic Map

| Doc | What it covers | Read when… |
| --- | --- | --- |
| [getting-started.md](./getting-started.md) | Bridge setup, first test, env vars, running a test | You are writing your first Fliwright test |
| [test-harness.md](./test-harness.md) | `@fliwright/vitest` fixture: `test`, `expect`, `createFliwrightTest`, hooks, env vars, failure context | You are choosing how to wire the driver lifecycle |
| [selectors.md](./selectors.md) | Selector formats, `getByX`, scoping (`descendant`/`ancestor`/`and`/`or`/`nth`/`first`/`last`/`filter`/`containing`), `subtype`/`tooltip`/`state` | You need to locate a widget reliably |
| [actions.md](./actions.md) | `click`/`longPress`/`drag`/`dragTo`/`slideTo`/`pinch`/`type`/`fill`/`clear`/`pressKey`/`setCheckbox`/`selectOption`/`scrollIntoView` + raw `clickAt`/`dragFrom` | You are performing gestures / input |
| [assertions.md](./assertions.md) | `expect()` matchers, auto-wait, `.not`, self-healing | You are asserting visible outcomes |
| [navigation.md](./navigation.md) | `navigate` / `currentRoute` / `goBack` / `waitFor` / `waitForNew` / `settle`, go_router setup | Your test spans routes / pages |
| [forms.md](./forms.md) | `page.formHelper.analyze()` / `fill()` / `fillFields()`, semantic types, scope, form-rule JSON | You are filling or smoke-testing a form |
| [mocks.md](./mocks.md) | `driver.mock.*` (route / getCalls / loadRules / switchRule / …), JSON mock files, `fliwright mock:start` | You need to stub HTTP / assert on requests |
| [screenshots-snapshots.md](./screenshots-snapshots.md) | `screenshot` / `screenshotFullPage` / `snapshot` / `findRef` / `ref`, bridge capability table | You are exploring the tree, capturing images, or working with refs |
| [driver-lifecycle.md](./driver-lifecycle.md) | Manual `FliwrightDriver`, `connect`/`dispose`, `sendRequest`, diagnostics, raw extensions, state/Riverpod | You need custom plugins, raw extensions, or legacy-bridge compatibility |
| [cli.md](./cli.md) | `fliwright run` / `init` / `doctor` / `record` / `mock:start`, options, reporters, env, VM discovery, automation scripts | You are running tests or building automation |
| [mcp-workflow.md](./mcp-workflow.md) | `fliwright_snap` / `observe` / `record` / `generate_test` / `run` / `get_failure` | You are discovering behavior or verifying via MCP |
| [troubleshooting.md](./troubleshooting.md) | Common repairs, bridge readiness, flaky selectors, crashes | A test fails and you need the fix |
| [examples.md](./examples.md) | Copyable, commented full test scripts | You want a template to adapt |

## How to think about Fliwright

Fliwright drives a **running Flutter app** over its VM Service (Dart debug protocol).
It is not a browser tool. Every `page.*` / `locator.*` call becomes a JSON-RPC request to a
Dart-side extension registered by `FliwrightBridge` (the `fliwright_bridge` package) that the app
must initialize in debug builds.

```
Test (.test.ts, Vitest)
   │  @fliwright/vitest fixture creates one FliwrightDriver
   ▼
FliwrightDriver  ──►  VMServiceConnector (WebSocket)
   │                       │  JSON-RPC 2.0
   ▼                       ▼
Page / Locator / Mock   Flutter VM Service
                            │
                            ▼
                        FliwrightBridge extensions
                        (ext.fliwright.snap / .action / .extractForm / .mock.* / …)
```

Consequences that shape every test:

- The app must be running (`flutter run`) **before** the test connects.
- The app must expose the current bridge — older bridges lack `ext.fliwright.snap`, `ext.fliwright.action`, `ext.fliwright.extractForm`. See [troubleshooting.md](./troubleshooting.md).
- VM URLs from `flutter run` are sometimes printed as `http://…`; they must be converted to `ws://…/ws`. The fixture does this automatically; raw-driver scripts must convert manually.
- Avoid fixed `sleep()`. Prefer `waitFor()` / auto-waiting `expect()` / `page.settle()`. See [navigation.md](./navigation.md) and [assertions.md](./assertions.md).

## Conventions used in these docs

- **TypeScript-first.** Most examples use the `@fliwright/vitest` fixture. Dart equivalents are only relevant to the *app under test* (bridge init), not to the test code itself.
- Every signature is copied from current source — if a signature here disagrees with the code, the code wins. Regenerate understanding by re-reading the source rather than trusting memory.
- Code blocks marked `// e2e` are adapted from real tests in `e2e/` and `.agents/skills/write-fliwright-tests/examples/`.
