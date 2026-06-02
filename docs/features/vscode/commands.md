---
module: "commands"
package: "@fliwright/vscode"
source: "src/extension.ts"
generated: "2026-06-02"
---

# Commands

> All `Fliwright: ...` commands contributed by the extension.

## Connection

| Command | Title |
|---------|-------|
| `fliwright.connect` | Fliwright: Connect to VM Service |
| `fliwright.disconnect` | Fliwright: Disconnect VM Service |
| `fliwright.discoverVmService` | Fliwright: Discover VM Service |
| `fliwright.configureMcp` | Fliwright: Configure MCP |

## Mock APIs

| Command | Title |
|---------|-------|
| `fliwright.reloadMocks` | Fliwright: Reload Mock Configs |
| `fliwright.createMockConfig` | Fliwright: Create Mock Config |
| `fliwright.openMockConfig` | Fliwright: Open Mock Config |
| `fliwright.copyMockEndpoint` | Fliwright: Copy Mock Endpoint |
| `fliwright.copyMockRuleJson` | Fliwright: Copy Mock Rule JSON |
| `fliwright.applyMockRule` | Fliwright: Apply Mock Rule |
| `fliwright.applyDefaultMocks` | Fliwright: Apply Default Mocks |
| `fliwright.stopSandbox` | Fliwright: Clear Mock Routes |

## Form

| Command | Title |
|---------|-------|
| `fliwright.reloadFormRules` | Fliwright: Reload Form Rules |
| `fliwright.createFormRules` | Fliwright: Create Form Rules |
| `fliwright.openFormRules` | Fliwright: Open Form Rules |
| `fliwright.analyzeForm` | Fliwright: Analyze Current Form |
| `fliwright.fillForm` | Fliwright: Fill Current Form |
| `fliwright.fillFormWithRules` | Fliwright: Fill Current Form With Rules |

## Tests & Runs

| Command | Title |
|---------|-------|
| `fliwright.runCurrentTest` | Fliwright: Run Current Test |
| `fliwright.runWorkspaceTests` | Fliwright: Run Workspace Tests |
| `fliwright.openFailure` | Fliwright: Open Failure Context |

## Recording

| Command | Title |
|---------|-------|
| `fliwright.startRecording` | Fliwright: Start Recording |
| `fliwright.stopRecording` | Fliwright: Stop Recording |
| `fliwright.insertRecordedTest` | Fliwright: Insert Recorded Test |

## State

| Command | Title |
|---------|-------|
| `fliwright.refreshStateProviders` | Fliwright: Refresh State Providers |
| `fliwright.readStateProvider` | Fliwright: Read State Provider |
| `fliwright.overrideStateProvider` | Fliwright: Override State Provider |

## Related

- **Source:** `packages/fliwright-vscode/src/extension.ts` (command registrations)
- **Package manifest:** `packages/fliwright-vscode/package.json` (declares contribution points)
