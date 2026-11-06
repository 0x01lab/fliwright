# Runtime Configuration Memory

Fliwright keeps authored team assets in the target project's `.fliwright/`
directory. Machine-local runtime state lives in a separate project partition.
The complete project path becomes its identifier by replacing `/` and `\`
with `-`, preserving the leading `-` for Unix absolute paths.

For `/Users/leo.he/projects/exio/exio_app`, the runtime config file is:

```text
~/.fliwright/-Users-leo.he-projects-exio-exio_app/runtime/config.json
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
5. Machine-local runtime config `<runtimeRoot>/runtime/config.json`.
6. Local VM Service discovery/port scan.

The runtime config contains machine-specific ports and VM Service tokens and
must remain outside version control. `FLIWRIGHT_RUNTIME_ROOT` overrides the
local project partition (the final project directory, not the parent of all
projects). Old `.fliwright/config.json` files are not read or moved automatically.

Runs default to `<runtimeRoot>/runs`, caches to `<runtimeRoot>/cache`, raw
recordings to `<runtimeRoot>/recordings`, and review evidence to
`<runtimeRoot>/reviews`. `fliwright.config.ts` can independently override
`runsRoot`, `cacheRoot`, and `paths.recordings`. Explicit invocation settings
win over environment settings, then project configuration, then defaults.
`FLIWRIGHT_RUNS_ROOT` and `FLIWRIGHT_CACHE_ROOT` provide per-area environment
overrides. Relative configured paths resolve against the project; `~/` expands
to the current user's home. Tests, scripts, mock/form rules and flow definitions
remain in the project and may be committed.

Local CLI tests and GitLab Item acceptance use the same resolved `runsRoot` as
the VS Code Run Viewer. Keep Item plans, bindings, coverage and report summaries
under `.fliwright/test-plans/<iid>/`, referencing returned run IDs and artifact
paths. Do not add an Item-local run-root override just to group evidence.
`run --output` changes only the JSON report destination. Deliberate user or CI
overrides remain supported; a root supplied only to a separate CLI invocation
is not automatically discovered by the Viewer.

Existing artifacts remain in place. To view old runs, explicitly configure
`runsRoot` to their directory; the runtime never silently selects an old root.
