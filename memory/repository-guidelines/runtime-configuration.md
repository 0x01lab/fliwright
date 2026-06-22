# Runtime Configuration

Fliwright runtime state can live under the target project's `.fliwright`
directory. The current workspace-level runtime config file is:

```text
.fliwright/config.json
```

Use this file as the default source for the active Flutter VM Service URL when a
project has been started from the Fliwright VS Code extension. The VS Code
extension clears stale VM Service data when a Flutter/Dart debug session starts,
then writes the detected URL after it sees debug output or successfully connects.

Expected shape:

```json
{
  "version": 1,
  "vmServiceUrl": "ws://127.0.0.1:49864/token=/ws",
  "vmServiceSource": "VS Code connected",
  "vmServiceUpdatedAt": "2026-06-21T13:33:31.913Z"
}
```

When resolving a VM Service URL for tests, scripts, CLI commands, or core helper
services, prefer this priority:

1. Explicit CLI/tool/test parameter.
2. `FLIWRIGHT_VM_URL`.
3. `FLIWRIGHT_VM_SERVICE_URL`.
4. Project config such as `fliwright.config.ts`.
5. Workspace runtime config `.fliwright/config.json`.
6. Local VM Service discovery/port scan.

Do not commit `.fliwright/config.json`; it is local runtime state and can contain
machine-specific ports and VM Service tokens.
