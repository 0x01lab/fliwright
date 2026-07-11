import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BridgeContext, SourceMapResult } from '@fliwright/core';
import { diagnosticsInteraction, type DiagnosticEvent, type SnapshotResult } from '@fliwright/cli/capabilities/interaction';
import type { ServerState } from '../state.js';
import type { FailureEntry } from '../types.js';
import { ensureConnected, type ConnectOptions } from './connect.js';
import { handleMockStatus, type MockStatusResult } from './mockTools.js';

export const DebugSnapshotParamsSchema = z.object({
  depth: z.number().optional().describe('Max traversal depth for the agent snapshot.'),
  includeRects: z.boolean().optional().default(true).describe('Include widget rects in snapshot refs.'),
  includeProperties: z.boolean().optional().default(false).describe('Include widget properties in snapshot refs.'),
  includeScreenshot: z.boolean().optional().default(false).describe('Include a PNG screenshot as base64 in this JSON bundle. Prefer fliwright_screenshot for visual inspection; if persistence is needed, the host coding agent chooses where to save the image.'),
  pixelRatio: z.number().optional().default(1).describe('Screenshot pixel ratio.'),
  includeDiagnostics: z.boolean().optional().default(true).describe('Include buffered Flutter diagnostics when supported.'),
  diagnosticLimit: z.number().int().positive().optional().default(20).describe('Maximum diagnostic events to return.'),
  includeMockStatus: z.boolean().optional().default(true).describe('Include mock rules, active routes, and recent calls.'),
  mockDir: z.string().optional().describe('Optional mock directory to load before reading mock status.'),
  mockRecentCallsLimit: z.number().int().positive().optional().default(20).describe('Maximum recent mock calls to return.'),
  includeSourceMap: z.boolean().optional().default(false).describe('Include visible UI to Dart source mapping when bridge support is available.'),
  sourceMapLimit: z.number().int().positive().optional().describe('Maximum source map nodes to return.'),
});

export interface DebugSnapshotResult {
  connected: boolean;
  capturedAt: string;
  route?: BridgeContext['route'] | { location: string };
  focused?: BridgeContext['focused'];
  capabilities?: Record<string, boolean>;
  snapshot?: SnapshotResult;
  screenshot?: {
    mimeType: 'image/png';
    base64: string;
  };
  diagnostics?: {
    events: DiagnosticEvent[];
    count: number;
  };
  mock?: MockStatusResult;
  sourceMap?: SourceMapResult;
  lastFailures: FailureEntry[];
  tddStatus?: unknown;
  errors?: Array<{ section: string; message: string }>;
}

export async function handleDebugSnapshot(
  params: z.infer<typeof DebugSnapshotParamsSchema>,
  state: ServerState,
  options: ConnectOptions = {},
): Promise<DebugSnapshotResult> {
  const input = DebugSnapshotParamsSchema.parse(params);
  const driver = await ensureConnected(state, options);
  const errors: NonNullable<DebugSnapshotResult['errors']> = [];
  const result: DebugSnapshotResult = {
    connected: true,
    capturedAt: new Date().toISOString(),
    lastFailures: state.getLastFailures(),
  };

  const context = await captureSection(errors, 'context', async () => {
    const page = driver.page as unknown as {
      context?: () => Promise<BridgeContext>;
      currentRoute?: () => Promise<string>;
    };
    if (page.context) return await page.context();
    if (page.currentRoute) return { route: { location: await page.currentRoute() } };
    return undefined;
  });
  if (context) {
    result.route = context.route;
    result.focused = context.focused;
    result.capabilities = context.capabilities;
  }

  result.snapshot = await captureSection(errors, 'snapshot', async () => driver.page.snapshot({
    depth: input.depth,
    includeRects: input.includeRects,
    includeProperties: input.includeProperties,
  }));

  if (input.includeScreenshot) {
    const screenshot = await captureSection(errors, 'screenshot', async () => {
      if (!driver.page.screenshot) throw new Error('Connected page does not support screenshots.');
      return await driver.page.screenshot({ pixelRatio: input.pixelRatio });
    });
    if (screenshot) {
      result.screenshot = {
        mimeType: 'image/png',
        base64: screenshot.toString('base64'),
      };
    }
  }

  if (input.includeDiagnostics) {
    result.diagnostics = await captureSection(errors, 'diagnostics', async () => {
      const diagnostics = await diagnosticsInteraction(driver, { limit: input.diagnosticLimit });
      return { events: diagnostics.events, count: diagnostics.count };
    });
  }

  if (input.includeMockStatus) {
    result.mock = await captureSection(errors, 'mock', async () => handleMockStatus({
      mockDir: input.mockDir,
      includeRoutes: true,
      includeCalls: true,
      recentCallsLimit: input.mockRecentCallsLimit,
    }, state));
  }

  if (input.includeSourceMap) {
    result.sourceMap = await captureSection(errors, 'sourceMap', async () => {
      const page = driver.page as unknown as {
        sourceMap?: (options?: { includeFramework?: boolean; includeRects?: boolean; includeProperties?: boolean; limit?: number }) => Promise<SourceMapResult>;
      };
      if (!page.sourceMap) throw new Error('Connected page does not support source maps.');
      return await page.sourceMap({
        includeRects: input.includeRects,
        includeProperties: input.includeProperties,
        limit: input.sourceMapLimit,
      });
    });
  }

  const tddRuntime = state.getTddRuntime();
  if (tddRuntime) result.tddStatus = tddRuntime.snapshot();
  if (errors.length > 0) result.errors = errors;
  return result;
}

export function registerDebugSnapshotTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_debug_snapshot',
    'Capture a coding-agent-friendly Flutter runtime bundle for the current running app: route, page snapshot refs, diagnostics, mocks, and recent failures. It uses the current MCP connection or auto-connects from vmServiceUrl/env/.fliwright/config.json. Screenshot bytes are omitted by default to keep context compact; use fliwright_screenshot for visual inspection. This tool does not choose output file paths.',
    DebugSnapshotParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleDebugSnapshot(params, state), null, 2) }],
    }),
  );
}

async function captureSection<T>(
  errors: Array<{ section: string; message: string }>,
  section: string,
  body: () => Promise<T | undefined>,
): Promise<T | undefined> {
  try {
    return await body();
  } catch (error) {
    errors.push({ section, message: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}
