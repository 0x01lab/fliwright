---
module: "setup"
package: "@fliwright/ai-plugin"
source: "src/setup.ts"
tests: "tests/setup.test.ts"
generated: "2026-06-02"
---

# `fliwright-ai-setup`

> CLI that installs Fliwright into Claude Code (`.claude/skills/fliwright/`) and/or Codex CLI (`AGENTS.md`).

## Overview

`setup.ts` exposes `parseArgs`, `setupClaudeCode`, `setupCodex`, and `runSetup` plus a `main()` invoked when the bin is run. The CLI is non-destructive: it refuses to overwrite an existing Claude Code skill unless `--force` is set, and uses marker-delimited regions (`<!-- FLIWRIGHT-PLUGIN-START -->` / `<!-- FLIWRIGHT-PLUGIN-END -->`) for Codex so subsequent runs update only that region.

## CLI Flags

| Flag | Description |
|------|-------------|
| `--all` | Install for both Claude Code and Codex CLI |
| `claude` | Install Claude Code skill only |
| `codex` | Install Codex CLI instructions only |
| `--target <dir>` | Target project directory (default: current directory) |
| `--force` | Replace an existing Claude Code fliwright skill |

## Public Functions

### `parseArgs(args, cwd?): ParsedArgs`

Returns `{ platform, targetDir, force }`. Throws on missing platform or unknown args.

### `validateTargetDir(targetDir): void`

Throws if the directory doesn't contain at least one of `pubspec.yaml`, `package.json`, `.git`, or `.fliwright` (i.e. doesn't look like a project root).

### `setupClaudeCode(targetDir, options?): void`

Copies `templates/claude-code/fliwright/` → `<targetDir>/.claude/skills/fliwright/`. Throws if destination already exists unless `options.force` is true.

### `setupCodex(targetDir): void`

Reads `templates/codex/fliwright.md` and injects it into `<targetDir>/AGENTS.md`:

- If `AGENTS.md` doesn't exist → creates it with the marker block.
- If it exists with both markers → replaces only the delimited region.
- If only one marker is present → throws (corrupted/orphaned marker).

### `runSetup(parsed): void`

Orchestrates: validate → run platform-specific setup(s). Prints progress and a reminder that the MCP server must be configured separately.

## Example

Programmatic use:

```typescript
import { parseArgs, runSetup } from '@fliwright/ai-plugin';

const parsed = parseArgs(['--all', '--target', '/path/to/project']);
runSetup(parsed);
```

## Related

- **Source:** `packages/fliwright-ai-plugin/src/setup.ts`
- **Templates:** `packages/fliwright-ai-plugin/templates/claude-code/` and `templates/codex/`
