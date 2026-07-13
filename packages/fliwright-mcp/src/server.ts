import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServerState } from './state.js';
import { registerRunTestTool } from './tools/runTest.js';
import { registerGetFailureTool } from './tools/getFailure.js';
import { registerGenerateTestTool } from './tools/generateTest.js';
import { registerRecordTool } from './tools/record.js';
import {
  registerMockClearCallsTool,
  registerMockListTool,
  registerMockStatusTool,
  registerMockSwitchTool,
} from './tools/mockTools.js';
import { registerTestReportResource } from './resources/testReport.js';
// ── New interaction tools ──
import { registerConnectTool, registerStatusTool } from './tools/connect.js';
import { registerScreenshotTool } from './tools/screenshot.js';
import { registerSnapTool } from './tools/snap.js';
import { registerSourceMapTool } from './tools/sourceMap.js';
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
import { registerFlowTools } from './tools/flow.js';
import { registerAgentDiagnoseTool } from './tools/agentDiagnose.js';
import { registerTddTools } from './tools/tdd.js';
import { registerDebugSnapshotTool } from './tools/debugSnapshot.js';

export type FliwrightMcpToolProfile = 'core' | 'development' | 'tdd' | 'flow' | 'full';

export interface CreateFliwrightServerOptions {
  toolProfile?: FliwrightMcpToolProfile;
}

const TOOL_PROFILES = new Set<FliwrightMcpToolProfile>([
  'core',
  'development',
  'tdd',
  'flow',
  'full',
]);

export function resolveMcpToolProfile(value: string | undefined): FliwrightMcpToolProfile {
  const profile = value ?? 'core';
  if (TOOL_PROFILES.has(profile as FliwrightMcpToolProfile)) {
    return profile as FliwrightMcpToolProfile;
  }
  throw new Error(
    `Unknown Fliwright MCP tool profile "${profile}". Expected one of: ${Array.from(TOOL_PROFILES).join(', ')}.`,
  );
}

export function createFliwrightServer(options: CreateFliwrightServerOptions = {}) {
  const server = new McpServer({
    name: 'fliwright',
    version: '0.1.0',
  });

  const state = createServerState();
  const profile = resolveMcpToolProfile(options.toolProfile ?? process.env.FLIWRIGHT_MCP_TOOL_PROFILE);

  registerRunTestTool(server, state);
  registerGetFailureTool(server, state);
  registerGenerateTestTool(server, state);
  registerTestReportResource(server, state);

  registerStatusTool(server, state);
  registerConnectTool(server, state);
  registerScreenshotTool(server, state);
  registerSnapTool(server, state);
  registerFindTool(server, state);
  registerObserveTool(server, state);
  registerNavigateTool(server, state);
  registerTapTool(server, state);
  registerTypeTool(server, state);
  registerDragTool(server, state);
  registerWaitTool(server, state);
  registerDebugSnapshotTool(server, state);

  if (profile === 'development' || profile === 'full') {
    registerRecordTool(server, state);
    registerMockListTool(server, state);
    registerMockSwitchTool(server, state);
    registerMockStatusTool(server, state);
    registerMockClearCallsTool(server, state);
    registerSourceMapTool(server, state);
    registerHotReloadAndSnapTool(server, state);
    registerActionTool(server, state);
    registerDiagnosticsTool(server, state);
    registerTimelineTool(server, state);
    registerAgentDiagnoseTool(server, state);
  }

  if (profile === 'tdd' || profile === 'full') {
    registerTddTools(server, state);
  }

  if (profile === 'flow' || profile === 'full') {
    registerFlowTools(server, state);
  }

  return { server, state };
}
