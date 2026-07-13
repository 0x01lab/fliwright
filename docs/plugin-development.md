# Codex Plugin Development

Use this loop while turning Fliwright skills and the MCP server into a local
Codex plugin.

## Commands

```bash
pnpm plugin:marketplace
pnpm plugin:sync
pnpm plugin:check
pnpm plugin:reload
```

By default both commands target `plugins/fliwright`. Override that when the
plugin lives elsewhere:

```bash
pnpm plugin:check -- --plugin /path/to/fliwright-plugin
pnpm plugin:reload -- --plugin /path/to/fliwright-plugin
```

`plugin:check` runs the MCP package build and test suite, validates the plugin
manifest when present, and validates every `SKILL.md`. If `plugins/fliwright`
does not exist yet, it still checks the repository skills under `.agents/skills`
and warns that plugin manifest validation was skipped.
It also sets `FLIWRIGHT_RUNS_ROOT` for child commands to a temp directory when
the variable is not already set, so test artifacts do not write to the user's
home directory during plugin validation.

`plugin:sync` copies the canonical Fliwright skills from `.agents/skills` into
the plugin bundle. `plugin:check` fails when those copies drift.

`plugin:marketplace` registers this repository's `.agents/plugins` directory
with Codex by passing the repository root, where Codex discovers
`.agents/plugins/marketplace.json`. Run it once before the first
`plugin:reload`; future reloads only need to update the cachebuster and
reinstall the plugin. Use `--dry-run` to inspect the command, or
`--path /path/to/repository` for another marketplace source.

`plugin:reload` runs `plugin:sync`, updates `.codex-plugin/plugin.json` with a single
`+codex.<timestamp>` cachebuster suffix, then runs:

```bash
codex plugin add <plugin-name>@<marketplace-name>
```

The marketplace name comes from `FLIWRIGHT_CODEX_MARKETPLACE`, an explicit
`--marketplace`, the repo-local `.agents/plugins/marketplace.json`, or the
personal marketplace when available. Use `--dry-run` to inspect the command
without writing anything.

After reinstalling, open a new Codex task. Existing tasks do not reliably pick
up changed skills and MCP tools.

## Useful Variants

```bash
pnpm plugin:check -- --strict-plugin
pnpm plugin:check -- --skip-mcp
pnpm plugin:marketplace -- --dry-run
pnpm plugin:reload -- --dry-run
pnpm plugin:reload -- --no-install
pnpm plugin:reload -- --marketplace personal
```

The check script uses built-in validation first. When Python has `PyYAML`
installed, it also runs the Codex plugin and skill validators from the local
system skills.

## Manual Smoke Tests

Use the prompts in [plugins/fliwright/test-cases.md](../plugins/fliwright/test-cases.md)
after each reinstall. They cover skill triggering, MCP profile expectations,
and the Fliwright-specific workflows that should stay stable across plugin
iterations.
