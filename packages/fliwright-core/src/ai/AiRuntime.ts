import { AiArtifactStore } from './AiArtifactStore.js';
import { validateJsonSchema } from './AiSchemaValidator.js';
import { AiAssertionError, AiDisabledError, AiInvocationError, AiParseError, AiTimeoutError } from './errors.js';
import type {
  AiAdapter,
  AiArtifactMeta,
  AiCallContext,
  AiClassifyRequest,
  AiGenerateRequest,
  AiInspectRequest,
  AiRequest,
  AiResponse,
  AiRuntimeConfig,
  AiRuntimeContext,
  AiVisibleOptions,
  JsonSchema,
} from './types.js';

export class AiRuntime {
  private callCounter = 0;

  constructor(
    private readonly config: AiRuntimeConfig = {},
    private readonly context: AiRuntimeContext = {},
  ) {}

  async ask(input: AiRequest, call?: AiCallContext): Promise<AiResponse> {
    const adapter = this.resolveAdapter();
    const callId = `ai-${++this.callCounter}`;
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const store = this.config.artifactsDir ? new AiArtifactStore(this.config.artifactsDir) : undefined;
    const artifactsDir = store
      ? await store.createInvocationDir({
          runId: call?.runId ?? this.context.runId,
          testName: call?.testName ?? this.context.testName,
          callId,
        })
      : undefined;
    const startedAt = Date.now();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await store?.writeRequest(artifactsDir!, input);
      await store?.writePrompt(artifactsDir!, input.prompt);
      const invocation = adapter.invoke(input, {
        callId,
        timeoutMs,
        signal: controller.signal,
        runtime: {
          ...this.context,
          page: call?.page ?? this.context.page,
          driver: call?.driver ?? this.context.driver,
        },
        artifactsDir,
      });
      const response = await withTimeout(invocation, timeoutMs, controller, artifactsDir, (handle) => {
        timeout = handle;
      });
      const json = response.json ?? parseJsonIfNeeded(response.text, input.responseFormat, artifactsDir);
      await store?.writeResponseText(artifactsDir!, response.text);
      if (json !== undefined) await store?.writeResponseJson(artifactsDir!, json);
      await store?.writeMeta(artifactsDir!, buildMeta(adapter.name, 'passed', startedAt, response.raw));
      return { text: response.text, json, metadata: response.metadata, artifactsDir };
    } catch (error) {
      const normalized = normalizeError(error, artifactsDir);
      await store?.writeMeta(artifactsDir!, {
        provider: adapter.name,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        errorType: normalized.name,
      });
      throw normalized;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async generate<T = unknown>(input: AiGenerateRequest<T>, call?: AiCallContext): Promise<T> {
    try {
      const response = await this.ask({ ...input, responseFormat: 'json' }, call);
      const json = response.json ?? parseJsonIfNeeded(response.text, 'json', response.artifactsDir);
      return input.schema ? validateJsonSchema<T>(json, input.schema) : json as T;
    } catch (error) {
      if ('fallback' in input) return input.fallback as T;
      throw error;
    }
  }

  async visible(prompt: string, options: AiVisibleOptions = {}, call?: AiCallContext): Promise<void> {
    const result = await this.inspect<{ pass: boolean; reason: string }>({
      prompt,
      responseFormat: 'json',
      schema: visibleSchema,
      includeScreenshot: options.includeScreenshot ?? true,
      includeSnapshot: options.includeSnapshot ?? false,
      screenshot: options.screenshot,
      timeoutMs: options.timeoutMs,
    }, call);
    if (!result.pass) throw new AiAssertionError(result.reason || 'provider returned pass=false');
  }

  async inspect<T = unknown>(input: AiInspectRequest, call?: AiCallContext): Promise<T> {
    const request = await this.withVisionContext(input, call);
    const response = await this.ask({ ...request, responseFormat: 'json' }, call);
    const json = response.json ?? parseJsonIfNeeded(response.text, 'json', response.artifactsDir);
    return input.schema ? validateJsonSchema<T>(json, input.schema) : json as T;
  }

  async classify(input: AiClassifyRequest, call?: AiCallContext): Promise<string> {
    const response = await this.generate<{ label: string }>({
      ...input,
      responseFormat: 'json',
      schema: {
        type: 'object',
        properties: { label: { type: 'string', enum: input.choices } },
        required: ['label'],
      },
    }, call);
    return response.label;
  }

  private async withVisionContext(input: AiInspectRequest, call?: AiCallContext): Promise<AiRequest> {
    const includeScreenshot = input.includeScreenshot ?? this.config.defaultVisionContext?.includeScreenshot ?? true;
    const includeSnapshot = input.includeSnapshot ?? this.config.defaultVisionContext?.includeSnapshot ?? false;
    const page = call?.page ?? this.context.page;
    const images = [...(input.images ?? [])];
    const metadata = { ...(input.metadata ?? {}) };

    if (includeScreenshot) {
      if (!page) throw new AiInvocationError('AI vision request requires a Page in runtime context');
      const screenshot = await page.screenshot(input.screenshot ?? { pixelRatio: 1 });
      images.push({ name: 'screenshot.png', mimeType: 'image/png', data: screenshot });
    }

    if (includeSnapshot) {
      if (!page) throw new AiInvocationError('AI snapshot request requires a Page in runtime context');
      metadata.snapshot = await page.snapshot();
    }

    return { ...input, images, metadata };
  }

  private resolveAdapter(): AiAdapter {
    if (this.config.enabled === false || this.config.provider === 'none') {
      throw new AiDisabledError('AI runtime is disabled. Configure FLIWRIGHT_AI_PROVIDER or createFliwrightTest({ ai }).');
    }
    const adapter = this.config.adapter;
    if (!adapter || !('invoke' in adapter)) {
      throw new AiDisabledError('AI runtime has no adapter. Configure provider mock, claude, codex, or custom-cli.');
    }
    return adapter;
  }
}

const visibleSchema: JsonSchema = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['pass', 'reason'],
};

function parseJsonIfNeeded(text: string, responseFormat: AiRequest['responseFormat'], artifactsDir?: string): unknown {
  if (responseFormat !== 'json') return undefined;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new AiParseError('AI response was not valid JSON', { cause, artifactsDir });
  }
}

function normalizeError(error: unknown, artifactsDir?: string): AiInvocationError {
  if (error instanceof AiInvocationError) return error;
  if (error instanceof Error) return new AiInvocationError(error.message, { cause: error, artifactsDir });
  return new AiInvocationError(String(error), { artifactsDir });
}

function buildMeta(provider: string, status: AiArtifactMeta['status'], startedAt: number, raw: unknown): AiArtifactMeta {
  const rawMeta = isRecord(raw) ? raw : {};
  return {
    provider,
    status,
    durationMs: Date.now() - startedAt,
    exitCode: typeof rawMeta.exitCode === 'number' || rawMeta.exitCode === null ? rawMeta.exitCode : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
  artifactsDir: string | undefined,
  setHandle: (handle: ReturnType<typeof setTimeout>) => void,
): Promise<T> {
  const timeout = new Promise<T>((_, reject) => {
    const handle = setTimeout(() => {
      controller.abort();
      reject(new AiTimeoutError(`AI invocation timed out after ${timeoutMs}ms`, { artifactsDir }));
    }, timeoutMs);
    setHandle(handle);
  });

  return Promise.race([promise, timeout]);
}
