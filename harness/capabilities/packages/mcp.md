---
package: "@fliwright/mcp"
path: "packages/fliwright-mcp"
source_fingerprint: "1ec36f96fd4db6f9f8f7e071dedd22eb7dc9ae856f6f1fe1be681c631d23a3f8"
generated: true
---

# Mcp Capabilities

## Responsibility

Expose agent-facing MCP tools and resources that adapt CLI, TDD, and core capabilities.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/cli`
- `@fliwright/tdd`

### Must Not Own

- `automation primitives`
- `CLI command ownership`
- `editor UX`
- `Flutter instrumentation`

## Owned Capabilities

- `MCP server`
- `MCP tool contracts`

## Package Entrypoints

- `.`

## Binary Entrypoints

- `fliwright-mcp`

## MCP Tools

- `fliwright_action`
- `fliwright_agent_diagnose`
- `fliwright_connect`
- `fliwright_debug_snapshot`
- `fliwright_diagnostics`
- `fliwright_drag`
- `fliwright_find`
- `fliwright_flow_agent_spec`
- `fliwright_flow_bind_figma`
- `fliwright_flow_clean`
- `fliwright_flow_generate_test`
- `fliwright_flow_get`
- `fliwright_flow_list`
- `fliwright_flow_review_bundle`
- `fliwright_flow_review_capture_figma`
- `fliwright_flow_review_capture_runtime`
- `fliwright_flow_review_plan`
- `fliwright_flow_review_report`
- `fliwright_flow_review_run`
- `fliwright_flow_validate`
- `fliwright_generate_test`
- `fliwright_get_failure`
- `fliwright_hot_reload_and_snap`
- `fliwright_mock_clear_calls`
- `fliwright_mock_list`
- `fliwright_mock_status`
- `fliwright_mock_switch`
- `fliwright_navigate`
- `fliwright_observe`
- `fliwright_record`
- `fliwright_run`
- `fliwright_screenshot`
- `fliwright_snap`
- `fliwright_source_map`
- `fliwright_status`
- `fliwright_tap`
- `fliwright_tdd_cycle`
- `fliwright_tdd_focus`
- `fliwright_tdd_prepare`
- `fliwright_tdd_reconnect`
- `fliwright_tdd_reload`
- `fliwright_tdd_repair`
- `fliwright_tdd_restart`
- `fliwright_tdd_set_scenario`
- `fliwright_tdd_start`
- `fliwright_tdd_status`
- `fliwright_tdd_stop`
- `fliwright_tdd_validate_spec`
- `fliwright_timeline_get`
- `fliwright_type`
- `fliwright_wait`

## MCP Tool Modules

- `action`
- `agentDiagnose`
- `connect`
- `debugSnapshot`
- `diagnostics`
- `drag`
- `find`
- `flow`
- `generateTest`
- `getFailure`
- `hotReloadAndSnap`
- `mockTools`
- `navigate`
- `observe`
- `record`
- `runTest`
- `screenshot`
- `snap`
- `sourceMap`
- `tap`
- `tdd`
- `timeline`
- `type`
- `wait`

## Source Anchors

- `packages/fliwright-mcp/src/index.ts`
- `packages/fliwright-mcp/src/resources/testReport.ts`
- `packages/fliwright-mcp/src/server.ts`
- `packages/fliwright-mcp/src/state.ts`
- `packages/fliwright-mcp/src/tools/action.ts`
- `packages/fliwright-mcp/src/tools/agentDiagnose.ts`
- `packages/fliwright-mcp/src/tools/connect.ts`
- `packages/fliwright-mcp/src/tools/debugSnapshot.ts`
- `packages/fliwright-mcp/src/tools/diagnostics.ts`
- `packages/fliwright-mcp/src/tools/drag.ts`
- `packages/fliwright-mcp/src/tools/find.ts`
- `packages/fliwright-mcp/src/tools/flow.ts`
- `packages/fliwright-mcp/src/tools/generateTest.ts`
- `packages/fliwright-mcp/src/tools/getFailure.ts`
- `packages/fliwright-mcp/src/tools/hotReloadAndSnap.ts`
- `packages/fliwright-mcp/src/tools/mockTools.ts`
- `packages/fliwright-mcp/src/tools/navigate.ts`
- `packages/fliwright-mcp/src/tools/observe.ts`
- `packages/fliwright-mcp/src/tools/record.ts`
- `packages/fliwright-mcp/src/tools/runTest.ts`
- `packages/fliwright-mcp/src/tools/screenshot.ts`
- `packages/fliwright-mcp/src/tools/snap.ts`
- `packages/fliwright-mcp/src/tools/sourceMap.ts`
- `packages/fliwright-mcp/src/tools/tap.ts`
- `packages/fliwright-mcp/src/tools/tdd.ts`
- `packages/fliwright-mcp/src/tools/timeline.ts`
- `packages/fliwright-mcp/src/tools/type.ts`
- `packages/fliwright-mcp/src/tools/wait.ts`
- `packages/fliwright-mcp/src/types.ts`
