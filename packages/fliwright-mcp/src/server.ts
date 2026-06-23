import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServerState } from './state.js';
import { registerRunTestTool } from './tools/runTest.js';
import { registerGetFailureTool } from './tools/getFailure.js';
import { registerGenerateTestTool } from './tools/generateTest.js';
import { registerRecordTool } from './tools/record.js';
import { registerMockListTool, registerMockSwitchTool } from './tools/mockTools.js';
import { registerTestReportResource } from './resources/testReport.js';
// ── New interaction tools ──
import { registerConnectTool } from './tools/connect.js';
import { registerScreenshotTool } from './tools/screenshot.js';
import { registerSnapTool } from './tools/snap.js';
import { registerFindTool } from './tools/find.js';
import { registerObserveTool } from './tools/observe.js';
import { registerHotReloadAndSnapTool } from './tools/hotReloadAndSnap.js';
import { registerNavigateTool } from './tools/navigate.js';
import { registerTapTool } from './tools/tap.js';
import { registerTypeTool } from './tools/type.js';
import { registerDragTool } from './tools/drag.js';
import { registerWaitTool } from './tools/wait.js';
import { registerActionTool } from './tools/action.js';
import { registerDiagnosticsTool } from './tools/diagnostics.js';
import { registerTimelineTool } from './tools/timeline.js';
import { registerAgentDiagnoseTool } from './tools/agentDiagnose.js';
import { registerTddTools } from './tools/tdd.js';

export function createFliwrightServer() {
  const server = new McpServer({
    name: 'fliwright',
    version: '0.1.0',
  });

  const state = createServerState();

  // Existing tools
  registerRunTestTool(server, state);
  registerGetFailureTool(server, state);
  registerGenerateTestTool(server, state);
  registerRecordTool(server, state);
  registerMockListTool(server, state);
  registerMockSwitchTool(server, state);
  registerTestReportResource(server, state);

  // Interaction tools — direct app control via MCP
  registerConnectTool(server, state);
  registerScreenshotTool(server, state);
  registerSnapTool(server, state);
  registerFindTool(server, state);
  registerObserveTool(server, state);
  registerHotReloadAndSnapTool(server, state);
  registerNavigateTool(server, state);
  registerTapTool(server, state);
  registerTypeTool(server, state);
  registerDragTool(server, state);
  registerWaitTool(server, state);
  registerActionTool(server, state);
  registerDiagnosticsTool(server, state);
  registerTimelineTool(server, state);
  registerAgentDiagnoseTool(server, state);
  registerTddTools(server, state);

  return { server, state };
}
