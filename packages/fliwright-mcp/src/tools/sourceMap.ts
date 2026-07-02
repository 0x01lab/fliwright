import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

interface SourceMapToolOptions {
  includeFramework?: boolean;
  includeRects?: boolean;
  includeProperties?: boolean;
  limit?: number;
}

interface SourceMapToolResult {
  success?: boolean;
  error?: string;
  widgetCreationTracked: boolean;
  route?: {
    location?: string;
    name?: string;
  };
  nodes: Array<Record<string, unknown>>;
  candidateFiles: string[];
  fileCounts?: Record<string, number>;
  count: number;
}

export const SourceMapParamsSchema = z.object({
  includeFramework: z.boolean().optional().describe('Include Flutter framework/package:flutter nodes (default: false)'),
  includeRects: z.boolean().optional().describe('Include widget bounds in source map nodes (default: true)'),
  includeProperties: z.boolean().optional().describe('Include widget properties in source map nodes (default: false)'),
  limit: z.number().optional().describe('Maximum number of source map nodes to return'),
});

export async function handleSourceMap(
  params: z.infer<typeof SourceMapParamsSchema>,
  state: ServerState,
): Promise<SourceMapToolResult> {
  const input = SourceMapParamsSchema.parse(params);
  const driver = requireDriver(state);
  const page = driver.page as unknown as {
    sourceMap(options?: SourceMapToolOptions): Promise<SourceMapToolResult>;
  };
  return page.sourceMap({
    includeFramework: input.includeFramework,
    includeRects: input.includeRects,
    includeProperties: input.includeProperties,
    limit: input.limit,
  });
}

export function registerSourceMapTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_source_map',
    'Map the currently visible Flutter UI to Dart creation locations and candidate source files for code agents.',
    SourceMapParamsSchema.shape,
    async (params) => {
      const result = await handleSourceMap(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
