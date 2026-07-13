---
name: fliwright-mcp-workflows
description: Configure, operate, or debug the Fliwright MCP server and its tool profiles. Use for `fliwright-mcp`, `.mcp.json`, `FLIWRIGHT_MCP_TOOL_PROFILE`, live Flutter app connection, unavailable Fliwright MCP tools, MCP recording, diagnostics, flow tools, or TDD MCP workflows.
---

# Fliwright MCP Workflows

Use the Fliwright MCP server for live Flutter app discovery, interaction,
recording, execution, and diagnosis. It is a tool surface over the same
Fliwright runtime; it does not replace a committed test or a stable skill
workflow.

## Tool Profiles

The server always exposes the compact `core` tools. Specialist tools depend on
`FLIWRIGHT_MCP_TOOL_PROFILE`:

| Profile | Use for |
| --- | --- |
| `core` | connect, snapshot, observe, navigation, basic interaction, run, and test failure retrieval |
| `development` | recording, mocks, source maps, hot reload, extended actions, diagnostics, timelines, and agent diagnosis |
| `flow` | business-flow documents and Figma-backed flow review |
| `tdd` | persistent TDD runtime and repair loop |
| `full` | all core, development, flow, and TDD tools |

This plugin requests `full`. If a required tool is absent, inspect the server
profile and restart/reinstall the plugin before changing a test or bridge.

## Live App Workflow

1. Confirm the app is a debug build with the Fliwright bridge initialized.
2. Connect using a supplied VM Service URL, workspace configuration, or
   discovery.
3. Capture a semantic snapshot before choosing a selector or ref.
4. Use refs only to explore. Commit stable query-based selectors in test code.
5. Run generated or edited tests through `fliwright_run` when rich artifacts
   are needed.
6. On failure, inspect the failure report, timeline, diagnostics, screenshot,
   and healing suggestion before changing selectors.

## Recording And Generation

- `fliwright_record` and `fliwright_generate_test` produce drafts.
- Replace ephemeral snapshot refs, remove exploratory actions, add meaningful
  assertions, and route final authoring through `write-fliwright-tests`.
- Do not assume recording is available in the `core` profile.

## Flow And TDD

- Route `.flow.json`, Figma binding, visual review, and flow test-generation
  work to `fliwright-flows`.
- Route red-first generation, focused cycles, baseline reset, and repair-loop
  work to `fliwright-tdd`.
- Do not start multiple MCP server profiles for the same live app merely to
  obtain extra tools. Prefer one deliberate profile; this plugin uses `full`.

## MCP Server Availability

This repo-local plugin starts the workspace MCP entry point. For local
development, build the package first with:

```bash
pnpm --filter @fliwright/mcp build
```

Run `pnpm plugin:check` to build and test the workspace MCP package before
reinstalling the plugin. A published plugin should replace the local entry
point with the released `fliwright-mcp` executable.
