---
module: "record"
package: "@fliwright/cli"
source: "src/index.ts"
generated: "2026-06-01"
---

# record

> Record user interactions on a Flutter app and generate test code.

## Usage

```bash
fliwright record [options]
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--vm-url <url>` | `string` | Config/env | Dart VM Service WebSocket URL |
| `--output <file>` | `string` | stdout | Output file path |
| `--lang <lang>` | `ts \| dart` | `ts` | Output language |
| `--name <name>` | `string` | `'recorded test'` | Test name |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Recording completed successfully |
| `1` | Error during recording |
