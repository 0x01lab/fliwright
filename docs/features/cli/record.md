---
module: "record"
package: "@fliwright/cli"
source: "src/commands/record.ts"
generated: "2026-06-02"
---

# fliwright record

> Record user interactions on a Flutter app and generate test code.

## Usage

```bash
fliwright record [options]
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--vm-url <url>` | `string` | auto-discover | VM Service WebSocket URL |
| `--output <file>` | `string` | stdout | Output file path |
| `--lang <lang>` | `ts \| dart` | `ts` | Output language |
| `--name <name>` | `string` | "recorded test" | Test name |

## Behavior

1. Connects to Flutter VM Service
2. Starts recording extension with live operation logging
3. Waits for Ctrl+C (SIGINT)
4. Stops recording and generates test code
5. Runs AssertionSuggester to add assertion comments
6. Writes to file or prints to stdout

## Output

Generated test code with assertion suggestion comments appended.
