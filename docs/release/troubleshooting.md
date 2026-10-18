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

## Agent commands are unavailable

Fliwright uses Skills + CLI. Install the CLI in the target project, then inspect
`fliwright schema --json` and `fliwright doctor --strict --json`. Remove the old
MCP server configuration. If a session disconnects, inspect the operation journal
with `session status --operation-id` before retrying a mutation.

## Package installation problems

The published packages require Node.js 22.12+ (22.x), 24.x, or 26+ and Vitest 5.0.5. In a
workspace, run `pnpm install --frozen-lockfile`; in a clean consumer, install
the CLI and Vitest packages together so peer dependencies resolve explicitly.
