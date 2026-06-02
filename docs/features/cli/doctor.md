---
module: "doctor"
package: "@fliwright/cli"
source: "src/commands/doctor.ts"
generated: "2026-06-02"
---

# fliwright doctor

> Check your Fliwright environment and display diagnostic information.

## Usage

```bash
fliwright doctor
```

## Checks

| Check | Description |
|-------|-------------|
| Node.js | Version check (requires >= 18) |
| Flutter SDK | `flutter --version` execution |
| @fliwright/core | Package installed and version |
| @fliwright/vitest | Package installed and version |
| fliwright.config.ts | Config file exists |
| VM Service | Running Flutter app detected |

## Output

Each check shows ✅ (pass) or ⚠️ (warning) with a descriptive message.
