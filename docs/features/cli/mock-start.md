---
module: "mock:start"
package: "@fliwright/cli"
source: "src/commands/mock.ts"
generated: "2026-06-02"
---

# fliwright mock:start

> Start the Fliwright tool-side mock controller server.

## Usage

```bash
fliwright mock:start [options]
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--host <host>` | `string` | `127.0.0.1` | Host to bind |
| `--port <port>` | `number` | random free port | Port to bind |
| `--mock-dir <dir>` | `string` | `.fliwright/mocks` | Mock directory |

## Behavior

1. Creates a `ToolMockServer` with the specified options
2. Starts the HTTP server
3. Loads mock rules from the configured directory
4. Prints the controller URL and dart-define flag for Flutter
5. Runs until SIGINT or SIGTERM

## Output

```
Fliwright mock controller: http://127.0.0.1:PORT
Flutter dart-define: --dart-define=FLIWRIGHT_MOCK_CONTROLLER_URL=http://127.0.0.1:PORT
```
