import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { buildFlowFromTimeline, type TimelineData } from '@fliwright/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';

export const TimelineGetParamsSchema = z.object({
  runId: z.string().optional().describe('Run id to inspect; defaults to the last run result'),
  path: z.string().optional().describe('Direct path to a timeline.json file'),
  includeArtifacts: z.boolean().optional().describe('Include artifact refs in returned nodes'),
  includeFlow: z.boolean().optional().describe('Include an editable business flow generated from the timeline'),
  nodeId: z.string().optional().describe('Return only a selected node plus nearby context'),
});

export async function handleTimelineGet(
  params: z.infer<typeof TimelineGetParamsSchema>,
  state: ServerState,
): Promise<unknown> {
  const timelinePath = params.path ?? findTimelinePath(params.runId, state);
  if (!timelinePath) {
    return {
      error: 'No timeline is available. Run fliwright_run first or pass path.',
    };
  }

  const data = JSON.parse(await readFile(timelinePath, 'utf8')) as {
    nodes?: Array<{ id?: string; parentId?: string; artifacts?: unknown[] }>;
  } & Record<string, unknown>;
  const compact = params.includeArtifacts ? data : stripArtifacts(data);
  const flow = params.includeFlow ? buildFlowFromTimeline({ timeline: data as unknown as TimelineData }) : undefined;
  if (!params.nodeId) {
    return {
      path: timelinePath,
      timeline: compact,
      ...(flow ? { flow } : {}),
    };
  }

  const nodes = compact.nodes ?? [];
  const index = nodes.findIndex((node) => node.id === params.nodeId);
  if (index === -1) {
    return {
      path: timelinePath,
      error: `Timeline node not found: ${params.nodeId}`,
      ...(flow ? { flow } : {}),
    };
  }
  const node = nodes[index];
  const parent = node.parentId ? nodes.find((candidate) => candidate.id === node.parentId) : undefined;
  const children = nodes.filter((candidate) => candidate.parentId === node.id);
  const previous = index > 0 ? nodes[index - 1] : undefined;
  const next = index < nodes.length - 1 ? nodes[index + 1] : undefined;
  return {
    path: timelinePath,
    node,
    parent,
    children,
    previous,
    next,
    ...(flow ? { flow } : {}),
  };
}

export function registerTimelineTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_timeline_get',
    'Read the latest Fliwright timeline or a selected timeline node',
    TimelineGetParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleTimelineGet(params, state), null, 2) }],
    }),
  );
}

function findTimelinePath(runId: string | undefined, state: ServerState): string | undefined {
  const result = state.getLastRunResult();
  const timelines = result?.artifacts?.timelines ?? result?.timelines?.map((timeline) => timeline.path) ?? [];
  if (!runId) return timelines[0];
  return timelines.find((path) => path.includes(runId));
}

function stripArtifacts<T extends { nodes?: Array<Record<string, unknown>> }>(data: T): T {
  return {
    ...data,
    nodes: data.nodes?.map((node) => {
      const { artifacts: _artifacts, ...rest } = node;
      return rest;
    }),
  };
}
