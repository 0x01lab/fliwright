---
module: "recording"
package: "@fliwright/vscode"
source: "src/recording/"
generated: "2026-06-02"
---

# Recording

> Start/stop recording, stream operations to a webview panel, and insert the generated code into the active editor.

## Overview

`RecorderService` wraps `@fliwright/core` `RecorderController`. When recording starts, a `RecordingPanel` webview is revealed that streams each captured operation. When stopped, the generated code is shown in the panel and the `fliwright.insertRecordedTest` command pastes it into the active editor at the cursor.

## Modules

| File | Role |
|------|------|
| `src/recording/RecorderService.ts` | Lifecycle: start, stop, getOperations |
| `src/webview/RecordingPanel.ts` | Webview rendering operations and generated code |

## Commands

| Command | Action |
|---------|--------|
| `fliwright.startRecording` | Connect (if needed) and start the recorder |
| `fliwright.stopRecording` | Stop and emit generated code to the webview |
| `fliwright.insertRecordedTest` | Insert the latest generated code at the cursor |

## Related

- **Pipeline:** [recording-pipeline.md](../recording-pipeline.md)
- **Source:** `packages/fliwright-vscode/src/recording/`
