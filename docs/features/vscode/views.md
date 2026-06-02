---
module: "views"
package: "@fliwright/vscode"
source: "src/views/, src/webview/"
generated: "2026-06-02"
---

# Views

> Tree views in the Fliwright activity bar and webview panels.

## Activity Bar Container

`fliwright` (icon: `media/fliwright.svg`)

## Tree Views

| View ID | Name | Provider | Shows |
|---------|------|----------|-------|
| `fliwright.devices` | Devices | `DevicesTreeProvider` | VM Service connection state + URL |
| `fliwright.mockApis` | Mock APIs | `MockApiTreeProvider` | Endpoints, rules, currently active rule per endpoint |
| `fliwright.formData` | Form Data | `FormDataTreeProvider` | Loaded form rules + analyze/fill commands |
| `fliwright.tests` | Tests | `TestsTreeProvider` | Discovered `.test.ts` files |
| `fliwright.runs` | Runs | `RunsTreeProvider` | Recent test runs with status |
| `fliwright.state` | State | `StateTreeProvider` | Riverpod providers (live values) |

## Webview Panels

| Panel | Purpose | Trigger |
|-------|---------|---------|
| `FailurePanel` | Display failure context (screenshot, widget tree, source, healing report) | `fliwright.openFailure` |
| `RecordingPanel` | Live recorded operations stream + generated code preview | `fliwright.startRecording` |

## CodeLens

A `FliwrightCodeLensProvider` registers CodeLenses for `typescript` and `typescriptreact` files — adds `Run Current Test` above `test(...)` blocks. Implemented in `src/runner/FliwrightCodeLensProvider.ts`.

## Related

- **Source:** `packages/fliwright-vscode/src/views/*Provider.ts`, `src/webview/*.ts`
