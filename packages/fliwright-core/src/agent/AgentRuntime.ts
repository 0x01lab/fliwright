import type { AiGenerateRequest, AiInspectRequest, AiRequest, AiVisibleOptions } from '../ai/types.js';
import type { AiRuntime } from '../ai/AiRuntime.js';
import { FliwrightAgentError } from './FliwrightAgentError.js';
import { TimelineRecorder } from '../timeline/TimelineRecorder.js';
import type { AgentVisibleFailure } from '../timeline/types.js';

export interface AgentRuntimeOptions {
  aiRuntime: AiRuntime;
  recorder?: TimelineRecorder;
}

export class AgentRuntime {
  constructor(private readonly options: AgentRuntimeOptions) {}

  ask(titleOrPrompt: string, request: Partial<AiRequest> = {}) {
    const prompt = request.prompt ?? titleOrPrompt;
    return this.runAiCall(titleOrPrompt, { prompt, ...request }, () => this.options.aiRuntime.ask({ prompt, ...request }));
  }

  generate<T = unknown>(titleOrPrompt: string, request: Omit<AiGenerateRequest<T>, 'prompt'> & { prompt?: string }): Promise<T> {
    const prompt = request.prompt ?? titleOrPrompt;
    return this.runAiCall(titleOrPrompt, {
      prompt,
      responseFormat: 'json',
      hasSchema: Boolean(request.schema),
      hasFallback: 'fallback' in request,
    }, () => this.options.aiRuntime.generate<T>({ ...request, prompt }));
  }

  verify(prompt: string, options?: AiVisibleOptions): Promise<void> {
    return this.runAiCall(prompt, { prompt, mode: 'verify', includeScreenshot: options?.includeScreenshot }, () => (
      this.options.aiRuntime.visible(prompt, options)
    ));
  }

  inspect<T = unknown>(titleOrPrompt: string, request: Omit<AiInspectRequest, 'prompt'> & { prompt?: string }): Promise<T> {
    const prompt = request.prompt ?? titleOrPrompt;
    return this.runAiCall(titleOrPrompt, {
      prompt,
      responseFormat: 'json',
      hasSchema: Boolean(request.schema),
      includeScreenshot: request.includeScreenshot,
      includeSnapshot: request.includeSnapshot,
    }, () => this.options.aiRuntime.inspect<T>({ ...request, prompt }));
  }

  private async runAiCall<T>(title: string, metadata: Record<string, unknown>, body: () => Promise<T>): Promise<T> {
    const node = this.options.recorder?.startNode('ai-call', title, {
      metadata: maskSecrets({ mode: 'active', ...metadata }),
    });
    try {
      const value = await body();
      if (node) this.options.recorder?.passNode(node.id);
      return value;
    } catch (error) {
      const failure = createAiFailure(error, title, node?.id);
      if (node) this.options.recorder?.failNode(node.id, failure);
      throw new FliwrightAgentError(failure, { cause: error });
    }
  }
}

function createAiFailure(error: unknown, title: string, timelineNodeId?: string): AgentVisibleFailure {
  return {
    code: 'ai_call_failed',
    title,
    message: error instanceof Error ? error.message : String(error),
    timelineNodeId,
    recoveryHints: [
      { kind: 'manual', description: 'Check AI provider configuration and request schema.' },
      { kind: 'retry', description: 'Retry the AI call if the provider failed transiently.' },
    ],
  };
}

function maskSecrets(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/password|secret|token|credential/i.test(key)) {
      output[key] = '<masked>';
    } else if (typeof entry === 'string' && /password|token|secret/i.test(entry)) {
      output[key] = '<masked>';
    } else {
      output[key] = entry;
    }
  }
  return output;
}
