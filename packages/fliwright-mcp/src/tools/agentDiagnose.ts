import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  AiRuntime,
  PassiveAgent,
  TimelineRecorder,
  resolveAiConfig,
  type AgentDiagnosis,
  type AgentVisibleFailure,
  type AiRuntimeConfig,
  type TimelineData,
} from '@fliwright/core';
import type { ServerState } from '../state.js';

export const AgentDiagnoseParamsSchema = z.object({
  path: z.string().optional().describe('Direct path to a timeline.json file'),
  runId: z.string().optional().describe('Run id to inspect; defaults to last run'),
  failureIndex: z.number().int().min(0).optional().describe('Agent-visible failure index to diagnose'),
  failure: z.object({
    code: z.string(),
    title: z.string(),
    message: z.string(),
    timelineNodeId: z.string().optional(),
  }).optional().describe('Explicit failure payload to diagnose instead of reading timeline'),
});

export async function handleAgentDiagnose(
  params: z.infer<typeof AgentDiagnoseParamsSchema>,
  state: ServerState,
  aiConfig?: AiRuntimeConfig,
): Promise<{ diagnosis?: AgentDiagnosis; error?: string }> {
  const timelinePath = params.path ?? findTimelinePath(params.runId, state);
  const timeline = timelinePath ? await readTimeline(timelinePath) : undefined;
  const failure = params.failure
    ? normalizeFailure(params.failure)
    : timeline?.agentVisibleFailures?.[params.failureIndex ?? 0];
  if (!failure) {
    return { error: 'No agent-visible failure is available to diagnose.' };
  }

  const recorder = new TimelineRecorder({
    runId: timeline?.runId ?? 'mcp-diagnosis',
    testName: timeline?.testName ?? 'mcp diagnosis',
  });
  const aiRuntime = new AiRuntime(resolveAiConfig(aiConfig), {
    runId: recorder.runId,
    testName: recorder.testName,
  });
  const passiveAgent = new PassiveAgent({
    aiRuntime,
    recorder,
    passive: true,
  });
  const currentNode = timeline?.nodes.find((node) => node.id === failure.timelineNodeId);
  const diagnosis = await passiveAgent.diagnose(failure, {
    currentNode,
    recentNodes: timeline?.nodes.slice(-8),
    artifacts: currentNode?.artifacts,
    allowedTools: ['fliwright_timeline_get', 'fliwright_snap', 'fliwright_observe'],
  });
  return diagnosis ? { diagnosis } : { error: 'Passive diagnosis did not run.' };
}

export function registerAgentDiagnoseTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_agent_diagnose',
    'Ask configured AI to diagnose an agent-visible Fliwright timeline failure',
    AgentDiagnoseParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleAgentDiagnose(params, state), null, 2) }],
    }),
  );
}

async function readTimeline(path: string): Promise<TimelineData> {
  return JSON.parse(await readFile(path, 'utf8')) as TimelineData;
}

function findTimelinePath(runId: string | undefined, state: ServerState): string | undefined {
  const result = state.getLastRunResult();
  const timelines = result?.artifacts?.timelines ?? result?.timelines?.map((timeline) => timeline.path) ?? [];
  if (!runId) return timelines[0];
  return timelines.find((path) => path.includes(runId));
}

function normalizeFailure(input: z.infer<typeof AgentDiagnoseParamsSchema>['failure']): AgentVisibleFailure {
  return {
    code: input!.code as AgentVisibleFailure['code'],
    title: input!.title,
    message: input!.message,
    timelineNodeId: input!.timelineNodeId,
    recoveryHints: [],
  };
}
