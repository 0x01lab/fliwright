import type { AiRuntime } from '../ai/AiRuntime.js';
import type { JsonSchema } from '../ai/types.js';
import { TimelineRecorder } from '../timeline/TimelineRecorder.js';
import type { AgentVisibleFailure, TimelineArtifactRef, TimelineNode } from '../timeline/types.js';
import { FliwrightAgentError } from './FliwrightAgentError.js';

export interface AgentDiagnosis {
  summary: string;
  rootCause: string;
  suggestedActions: string[];
  confidence: number;
}

export interface PassiveAgentContext {
  currentNode?: TimelineNode;
  recentNodes?: TimelineNode[];
  artifacts?: TimelineArtifactRef[];
  allowedTools?: string[];
  screenshotPath?: string;
  snapshotPath?: string;
  diagnosticsPath?: string;
}

export interface PassiveAgentOptions {
  aiRuntime: AiRuntime;
  recorder?: TimelineRecorder;
  passive?: boolean;
}

export class PassiveAgent {
  constructor(private readonly options: PassiveAgentOptions) {}

  async diagnose(
    failure: AgentVisibleFailure,
    context: PassiveAgentContext = {},
  ): Promise<AgentDiagnosis | null> {
    if (!this.options.passive) return null;
    const node = this.options.recorder?.startNode('ai-call', `Diagnose: ${failure.title}`, {
      metadata: {
        mode: 'passive-diagnosis',
        failureCode: failure.code,
        timelineNodeId: failure.timelineNodeId,
        allowedTools: context.allowedTools ?? [],
      },
    });

    try {
      const diagnosis = await this.options.aiRuntime.generate<AgentDiagnosis>({
        prompt: buildDiagnosisPrompt(failure, context),
        schema: diagnosisSchema,
      });
      if (node) {
        this.options.recorder?.passNode(node.id, {
          diagnosis,
        });
      }
      return diagnosis;
    } catch (error) {
      const agentFailure: AgentVisibleFailure = {
        code: 'ai_call_failed',
        title: `Diagnose: ${failure.title}`,
        message: error instanceof Error ? error.message : String(error),
        timelineNodeId: node?.id,
        recoveryHints: [
          { kind: 'manual', description: 'Inspect the original failure without passive AI diagnosis.' },
          { kind: 'retry', description: 'Retry diagnosis after checking provider configuration.' },
        ],
      };
      if (node) this.options.recorder?.failNode(node.id, agentFailure);
      throw new FliwrightAgentError(agentFailure, { cause: error });
    }
  }
}

const diagnosisSchema: JsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    rootCause: { type: 'string' },
    suggestedActions: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: { type: 'number' },
  },
  required: ['summary', 'rootCause', 'suggestedActions', 'confidence'],
};

function buildDiagnosisPrompt(
  failure: AgentVisibleFailure,
  context: PassiveAgentContext,
): string {
  return [
    'Diagnose this Fliwright timeline failure. Return JSON only.',
    '',
    `Failure code: ${failure.code}`,
    `Title: ${failure.title}`,
    `Message: ${failure.message}`,
    `Timeline node id: ${failure.timelineNodeId ?? 'unknown'}`,
    '',
    `Current node: ${JSON.stringify(compactNode(context.currentNode))}`,
    `Recent nodes: ${JSON.stringify((context.recentNodes ?? []).map(compactNode))}`,
    `Artifacts: ${JSON.stringify(context.artifacts ?? [])}`,
    `Screenshot path: ${context.screenshotPath ?? failure.appState?.screenshotPath ?? 'none'}`,
    `Snapshot path: ${context.snapshotPath ?? failure.appState?.snapshotPath ?? 'none'}`,
    `Diagnostics path: ${context.diagnosticsPath ?? failure.appState?.diagnosticsPath ?? 'none'}`,
    `Allowed tools: ${(context.allowedTools ?? []).join(', ') || 'none'}`,
  ].join('\n');
}

function compactNode(node: TimelineNode | undefined): unknown {
  if (!node) return null;
  return {
    id: node.id,
    parentId: node.parentId,
    kind: node.kind,
    title: node.title,
    status: node.status,
    metadata: node.metadata,
    error: node.error
      ? {
          code: node.error.code,
          title: node.error.title,
          message: node.error.message,
        }
      : undefined,
  };
}
