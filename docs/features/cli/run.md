---
module: "run"
package: "@fliwright/cli"
source: "src/index.ts"
generated: "2026-06-01"
---

# run

> Run Fliwright tests using Vitest.

## Usage

```bash
fliwright run --test <pattern> [options]
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--test <pattern>` | `string` | Required | Test file or glob pattern |
| `--vm-url <url>` | `string` | Config/env | Dart VM Service WebSocket URL |
| `--reporter <format>` | `pretty \| json \| junit` | `pretty` | Output format |
| `--timeout <ms>` | `number` | `30000` | Per-test timeout |
| `--screenshot <mode>` | `file \| base64 \| off` | `file` | Screenshot mode |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed |
| `1` | One or more tests failed |
