# Migrating to the CLI-first Developer Preview

This guide covers migration from earlier Fliwright pre-release snapshots to
the current product surface. Fliwright remains a Flutter-specific white-box
E2E runtime; the change is which adapter owns the public workflow.

## Required environment changes

- Use Node.js 20 or newer and Vitest 4.1.11.
- Install `@fliwright/cli` and `@fliwright/vitest` for the normal test path.
- Keep `fliwright_bridge` behind a dedicated debug or test Flutter entrypoint.
- Install `@fliwright/mcp` only when a coding agent needs MCP access.
- Import Design QA from `fliwright_design_qa`; it is no longer exported by the
  base bridge.

## Surface migration

| Earlier workflow | Current workflow |
| --- | --- |
| Treat the MCP server as the primary runner | Use `fliwright run` and its exit code in local scripts and CI. |
| Configure every low-level MCP tool | Start with the default eight-tool `core` profile. Opt into `development`, `tdd`, `flow`, or `full` only for a specialist session. |
| Call `fliwright_snap`, `fliwright_tap`, or `fliwright_type` in ordinary sessions | Use `fliwright_observe` followed by `fliwright_interact`; granular tools remain in `development`. |
| Call `fliwright_mock_list` and `fliwright_mock_switch` | Use CLI `fliwright mock ...` or the intent-level `fliwright_mock` core tool. |
| Read failure data only through `fliwright_get_failure` | Use `fliwright artifacts show|export` or the read-only `test_report` MCP resource; `fliwright_get_failure` remains in `development`. |
| Put Design QA dependencies in `fliwright_bridge` | Add `fliwright_design_qa` separately and register `FliwrightDesignQaExtension` only in a debug/profile entrypoint. |

## MCP configuration

An existing MCP host configuration can keep launching `fliwright-mcp`. With no
profile variable, it now receives the compact `core` profile. Generate an
explicit configuration with:

```bash
fliwright mcp config --profile core
fliwright mcp doctor
```

Choose `full` only as a temporary migration or debugging surface. It registers
all implemented tool families and therefore increases tool-selection ambiguity
and agent context usage.

## Compatibility policy

The Developer Preview does not promise compatibility paths for replaced
behavior. The deprecated top-level `mock:start` alias currently remains for
migration, but new scripts should use the grouped `fliwright mock start`
command. Update other scripts and agent configurations to the current CLI
commands and profiles before promoting them to CI. Public stable-version
deprecation periods will be defined before 1.0.
