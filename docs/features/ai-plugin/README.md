---
package: "@fliwright/ai-plugin"
version: "0.1.0"
layer: transport
status: implemented
generated: "2026-06-02"
---

# @fliwright/ai-plugin

> Installer CLI (`fliwright-ai-setup`) that drops Fliwright skills/instructions into AI assistants' project-local config — Claude Code skills under `.claude/skills/fliwright/` and Codex CLI instructions appended to `AGENTS.md` between managed markers.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `setup` | The `fliwright-ai-setup` CLI — parses args, copies Claude Code skill template, injects Codex section into `AGENTS.md` | [setup.md](./setup.md) |

## Dependencies

- Node `>= 16.7.0` (uses `node:fs.cpSync`)
- No runtime dependencies

## Usage Example

```bash
# Install for both Claude Code and Codex CLI in the current project
npx fliwright-ai-setup --all

# Install only the Claude Code skill
npx fliwright-ai-setup claude

# Install only the Codex CLI instructions
npx fliwright-ai-setup codex

# Target a different project directory
npx fliwright-ai-setup --all --target /path/to/project

# Replace an existing Claude Code skill
npx fliwright-ai-setup claude --force
```

After running, restart the AI assistant so it picks up the new files.
