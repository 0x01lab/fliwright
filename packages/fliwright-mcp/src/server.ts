import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServerState } from './state.js';
import { registerRunTestTool } from './tools/runTest.js';
import { registerGetFailureTool } from './tools/getFailure.js';
import { registerGenerateTestTool } from './tools/generateTest.js';
import { registerRecordTool } from './tools/record.js';
import { registerMockListTool, registerMockSwitchTool } from './tools/mockTools.js';
import { registerTestReportResource } from './resources/testReport.js';

export function createFliwrightServer() {
  const server = new McpServer({
    name: 'fliwright',
    version: '0.1.0',
  });

  const state = createServerState();

  registerRunTestTool(server, state);
  registerGetFailureTool(server, state);
  registerGenerateTestTool(server, state);
  registerRecordTool(server, state);
  registerMockListTool(server, state);
  registerMockSwitchTool(server, state);
  registerTestReportResource(server, state);

  return { server, state };
}
