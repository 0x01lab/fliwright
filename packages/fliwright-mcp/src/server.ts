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
import { registerTapTool } from './tools/tap.js';
import { registerTypeTool } from './tools/type.js';
import { registerDragTool } from './tools/drag.js';
import { registerWaitTool } from './tools/wait.js';

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
  registerTapTool(server, state);
  registerTypeTool(server, state);
  registerDragTool(server, state);
  registerWaitTool(server, state);

  return { server, state };
}
