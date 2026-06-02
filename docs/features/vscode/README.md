---
package: "@fliwright/vscode"
version: "0.1.0"
layer: integration
status: implemented
generated: "2026-06-02"
---

# @fliwright/vscode

> VS Code extension that brings Fliwright into the editor — connect to a running Flutter VM Service, manage mock configs, analyze/fill forms, run tests with CodeLens, inspect failures in a webview panel, record interactions, and inject Riverpod state from a tree view.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| Commands | All contributed `Fliwright: ...` commands | [commands.md](./commands.md) |
| Views | Activity-bar tree views and webview panels | [views.md](./views.md) |
| Session | VM Service connection lifecycle and discovery | [session.md](./session.md) |
| Sandbox | Mock config files + active route management | [sandbox.md](./sandbox.md) |
| Form | Form rule editor + analyze/fill commands | [form.md](./form.md) |
| Recording | Start/stop recording, webview panel | [recording.md](./recording.md) |
| Runner | Vitest runner, CodeLens provider, test discovery | [runner.md](./runner.md) |
| Failure | Failure-context store + webview panel | [failure.md](./failure.md) |
| State | Riverpod provider read/override commands + tree | [state.md](./state.md) |

## Dependencies

- `@fliwright/core` — workspace:*
- VS Code API ^1.90
- Bundled with `esbuild` (output `dist/extension.js`)

## Usage Example

1. Install the extension (`fliwright-vscode-<version>.vsix`).
2. Start your Flutter app with a VM Service.
3. Command palette → `Fliwright: Connect to VM Service` (or `Discover VM Service`).
4. Open a test file — `Run Current Test` CodeLens appears above each `test()`.
5. Command palette → `Fliwright: Start Recording` to capture interactions.

See [commands.md](./commands.md) for the full command list.
