---
module: "init"
package: "@fliwright/cli"
source: "src/commands/init.ts"
generated: "2026-06-02"
---

# fliwright init

> Initialize Fliwright in the current project.

## Usage

```bash
fliwright init
```

## Generated Files

| File | Description |
|------|-------------|
| `fliwright.config.ts` | Configuration file with default settings (skipped if exists) |
| `tests/example.test.ts` | Example test file (skipped if exists) |

## Next Steps

After init:
1. Start Flutter app: `flutter run`
2. Run tests: `npx fliwright run`
