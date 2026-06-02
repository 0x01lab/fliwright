---
module: "run"
package: "@fliwright/cli"
source: "src/commands/run.ts"
generated: "2026-06-02"
---

# fliwright run

> Run Fliwright tests via Vitest with auto-discovered VM Service URL and embedded mock server.

## Usage

```bash
fliwright run [options]
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--test <pattern>` | `string` | `tests/**/*.test.ts` | Test file or glob pattern |
| `--vm-url <url>` | `string` | auto-discover | Dart VM Service WebSocket URL |
| `--reporter <format>` | `pretty \| json \| junit` | `pretty` | Output format |
| `--timeout <ms>` | `number` | `30000` | Per-test timeout |
| `--screenshot <mode>` | `file \| base64 \| off` | `file` | Screenshot mode |

## Behavior

1. Loads config from `fliwright.config.ts`
2. Resolves VM Service URL (CLI flag → config → auto-discovery)
3. Starts embedded ToolMockServer and loads `.fliwright/mocks/` rules
4. Spawns Vitest with JSON reporter
5. Sets FLIWRIGHT_VM_URL, FLIWRIGHT_MOCK_CONTROLLER_URL, FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH
6. Formats and prints results
7. Cleans up mock server

## Exit Code

- `0` if all tests pass
- `1` if any test fails
