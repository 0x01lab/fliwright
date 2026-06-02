---
module: "failure"
package: "@fliwright/vscode"
source: "src/failure/, src/webview/FailurePanel.ts"
generated: "2026-06-02"
---

# Failure

> Persist and visualize failure context (screenshot, widget tree, source location, healing report).

## Modules

| File | Role |
|------|------|
| `src/failure/FailureContextStore.ts` | In-memory store of recent `FailureContext` entries keyed by test name |
| `src/webview/FailurePanel.ts` | Webview rendering the entry as HTML |

## Commands

| Command | Action |
|---------|--------|
| `fliwright.openFailure` | Open the Failure panel for the most recent failure (or pick a test if multiple) |

## Data Flow

1. `VitestRunner` runs a test with `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` set.
2. The Vitest reporter (`@fliwright/vitest`) appends each failure to that file.
3. `FailureContextStore` reads the file and exposes entries to the webview.
4. `FailurePanel` renders the assertion, source snippet, widget tree (collapsible JSON), and healing report (with per-dimension scores).

## Related

- **Source:** `packages/fliwright-vscode/src/failure/`, `src/webview/FailurePanel.ts`
