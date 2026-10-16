# Fliwright Troubleshooting

## VM Service cannot be found

Fliwright resolves the endpoint in this order:

1. `--vm-url` on the CLI or `vmServiceUrl` in an explicit command.
2. `FLIWRIGHT_VM_URL` or `FLIWRIGHT_VM_SERVICE_URL`.
3. `vmServiceUrl` in `fliwright.config.ts`.
4. The cached workspace value in `.fliwright/config.json`.
5. The local development ports `8181`, `9189`, and `54321`.

Run `fliwright doctor --vm-url <url>` to separate endpoint discovery problems
from bridge capability problems. The URL may be copied from `flutter run`; it
can be an HTTP VM Service URL and is normalized for the WebSocket connection.

## Bridge handshake fails

Confirm that the app was launched through the test entrypoint and that it is a
debug/profile build:

```bash
flutter run -t test_driver/fliwright_app.dart
fliwright doctor
```

Do not add the bridge to a production release entrypoint. In release mode its
initializer intentionally returns without registering extensions.

## Tests run but artifacts are missing

Use a machine-readable reporter and inspect the reported path:

```bash
fliwright run --reporter ai-json --output .fliwright/run.json
fliwright artifacts show
```

The default run root is `.fliwright/runs`. Set `runsRoot` in
`fliwright.config.ts` or pass the command-specific override when a CI worker
needs an isolated directory.

## MCP tools are unexpectedly missing

The default MCP profile intentionally exposes only eight tools. Check the
profile and executable before changing the server configuration:

```bash
fliwright mcp doctor
fliwright mcp config --profile core
```

Use `FLIWRIGHT_MCP_TOOL_PROFILE=development`, `tdd`, `flow`, or `full` only for
specialist workflows. Use the CLI for deterministic setup, CI exit codes, and
artifact export.

## Package installation problems

The published packages require Node.js 20 or newer and Vitest 4.1.11. In a
workspace, run `pnpm install --frozen-lockfile`; in a clean consumer, install
the CLI and Vitest packages together so peer dependencies resolve explicitly.
