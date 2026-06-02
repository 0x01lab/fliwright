---
module: "session"
package: "@fliwright/vscode"
source: "src/session/"
generated: "2026-06-02"
---

# Session

> VM Service connection lifecycle and discovery for the VS Code extension.

## Overview

`FliwrightSession` is an Event-emitting singleton that owns the current connection state (`disconnected` / `connecting` / `connected` / `error`) and the active VM Service URL. The status bar and the Devices tree view subscribe to state changes.

## Modules

| File | Role |
|------|------|
| `src/session/FliwrightSession.ts` | Connection state machine, event emitter, disposable |
| `src/session/VmServiceDiscovery.ts` | Wraps `@fliwright/cli` `discoverVmServiceUrl()` for use in VS Code |

## Public API (FliwrightSession)

| Method / Property | Description |
|-------------------|-------------|
| `connect(url?): Promise<ConnectionState>` | Connects; if `url` is empty, falls back to discovery |
| `disconnect(): Promise<void>` | Closes the connection |
| `onDidChangeState: Event<ConnectionState>` | Subscribe to state changes |
| `state: ConnectionState` | Current state |

## Commands

- `fliwright.connect` — prompts for URL, calls `session.connect`
- `fliwright.disconnect` — calls `session.disconnect`
- `fliwright.discoverVmService` — runs discovery and copies the URL to clipboard / offers connection

## Related

- **Source:** `packages/fliwright-vscode/src/session/`
