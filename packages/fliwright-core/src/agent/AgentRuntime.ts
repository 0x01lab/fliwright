import type { AiGenerateRequest, AiInspectRequest, AiRequest, AiVisibleOptions } from '../ai/types.js';
import type { AiRuntime } from '../ai/AiRuntime.js';
import { FliwrightAgentError } from './FliwrightAgentError.js';
import { TimelineNodeLifecycle } from '../timeline/TimelineNodeLifecycle.js';
import { TimelineRecorder } from '../timeline/TimelineRecorder.js';
import type { AgentVisibleFailure } from '../timeline/types.js';

export interface AgentRuntimeOptions {
  aiRuntime: AiRuntime;
  recorder?: TimelineRecorder;
}

export class AgentRuntime {
  private readonly lifecycle: TimelineNodeLifecycle;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.lifecycle = new TimelineNodeLifecycle(options.recorder);
  }

  ask(titleOrPrompt: string, request: Partial<AiRequest> = {}) {
    const prompt = request.prompt ?? titleOrPrompt;
    let artifactsDir: string | undefined;
    return this.runAiCall(titleOrPrompt, { prompt, ...request }, async () => {
      const response = await this.options.aiRuntime.ask({ prompt, ...request });
      artifactsDir = response.artifactsDir;
      return response;
    }, () => ({ ...(artifactsDir ? { artifactsDir } : {}) }));
  }

  generate<T = unknown>(titleOrPrompt: string, request: Omit<AiGenerateRequest<T>, 'prompt'> & { prompt?: string }): Promise<T> {
    const prompt = request.prompt ?? titleOrPrompt;
    let fallbackUsed = false;
    let artifactsDir: string | undefined;
    return this.runAiCall(titleOrPrompt, {
      prompt,
      responseFormat: 'json',
      hasSchema: Boolean(request.schema),
      hasFallback: 'fallback' in request,
    }, async () => {
      const result = await this.options.aiRuntime.generateWithStatus<T>({ ...request, prompt });
      fallbackUsed = result.fallbackUsed;
      artifactsDir = result.artifactsDir;
      return result.value;
    }, () => ({ fallbackUsed, ...(artifactsDir ? { artifactsDir } : {}) }));
  }

  verify(prompt: string, options?: AiVisibleOptions): Promise<void> {
    let artifactsDir: string | undefined;
    return this.runAiCall(prompt, { prompt, mode: 'verify', includeScreenshot: options?.includeScreenshot }, async () => {
      const result = await this.options.aiRuntime.visibleWithMetadata(prompt, options);
      artifactsDir = result.artifactsDir;
    }, () => ({ ...(artifactsDir ? { artifactsDir } : {}) }));
  }

  inspect<T = unknown>(titleOrPrompt: string, request: Omit<AiInspectRequest, 'prompt'> & { prompt?: string }): Promise<T> {
    const prompt = request.prompt ?? titleOrPrompt;
    let artifactsDir: string | undefined;
    return this.runAiCall(titleOrPrompt, {
      prompt,
      responseFormat: 'json',
      hasSchema: Boolean(request.schema),
      includeScreenshot: request.includeScreenshot,
      includeSnapshot: request.includeSnapshot,
    }, async () => {
      const result = await this.options.aiRuntime.inspectWithMetadata<T>({ ...request, prompt });
      artifactsDir = result.artifactsDir;
      return result.value;
    }, () => ({ ...(artifactsDir ? { artifactsDir } : {}) }));
  }

  private async runAiCall<T>(
    title: string,
    metadata: Record<string, unknown>,
    body: () => Promise<T>,
    successMetadata?: () => Record<string, unknown>,
  ): Promise<T> {
    return this.lifecycle.run({
      kind: 'ai-call',
      title,
      start: {
        metadata: maskSecrets({ mode: 'active', ...this.options.aiRuntime.timelineMetadata, ...metadata }),
      },
      body,
      successMetadata,
      onFailure: (error, timelineNodeId) => ({
        failure: createAiFailure(error, title, timelineNodeId),
      }),
      // AI failures intentionally replace an existing error with the AI-specific failure context.
      wrapError: (error, failure) => new FliwrightAgentError(failure, { cause: error }),
    });
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
  return maskSecretValue(value) as Record<string, unknown>;
}

function maskSecretValue(value: unknown, key?: string): unknown {
  if (key && /password|secret|token|credential|api[-_]?key|authorization/i.test(key)) {
    return '<masked>';
  }
  if (typeof value === 'string' && /password|token|secret/i.test(value)) {
    return '<masked>';
  }
  if (Array.isArray(value)) return value.map((entry) => maskSecretValue(entry));
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = maskSecretValue(entry, key);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
