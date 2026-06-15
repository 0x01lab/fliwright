import type { FliwrightDriver } from '../Driver.js';
import type { Page } from '../Page.js';

export type AiResponseFormat = 'text' | 'json';
export type AiProviderName = 'mock' | 'claude' | 'codex' | 'custom-cli' | 'none';
export type AiCacheMode = 'off' | 'read' | 'write' | 'read-write';
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
}

export interface AiImageInput {
  name?: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Buffer | string;
}

export interface AiFileInput {
  name: string;
  mimeType?: string;
  content: Buffer | string;
}

export interface AiRequest {
  prompt: string;
  system?: string;
  responseFormat?: AiResponseFormat;
  schema?: JsonSchema;
  images?: AiImageInput[];
  files?: AiFileInput[];
  temperature?: number;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AiGenerateRequest<TFallback = unknown> extends AiRequest {
  responseFormat?: 'json';
  fallback?: TFallback;
}

export interface AiVisionOptions {
  includeScreenshot?: boolean;
  includeSnapshot?: boolean;
  screenshot?: {
    pixelRatio?: number;
    mode?: 'auto' | 'boundary' | 'canvas';
  };
}

export interface AiVisibleOptions extends AiVisionOptions {
  timeoutMs?: number;
}

export interface AiInspectRequest extends AiRequest, AiVisionOptions {}

export interface AiClassifyRequest extends AiRequest {
  choices: string[];
}

export interface AiResponse {
  text: string;
  json?: unknown;
  metadata?: AiAdapterResponse['metadata'];
  artifactsDir?: string;
}

export interface AiAdapterResponse {
  text: string;
  json?: unknown;
  raw?: unknown;
  metadata?: {
    model?: string;
    usage?: unknown;
    providerRequestId?: string;
  };
}

export interface AiInvocationContext {
  callId: string;
  timeoutMs: number;
  signal: AbortSignal;
  runtime: AiRuntimeContext;
  artifactsDir?: string;
}

export interface AiAdapter {
  readonly name: string;
  invoke(request: AiRequest, context: AiInvocationContext): Promise<AiAdapterResponse>;
}

export interface AiRuntimeContext {
  page?: Page;
  driver?: FliwrightDriver;
  testName?: string;
  runId?: string;
  cwd?: string;
}

export interface AiRuntimeConfig {
  provider?: AiProviderName;
  cache?: AiCacheMode;
  timeoutMs?: number;
  artifactsDir?: string;
  adapter?: AiAdapter | AiCliAdapterOptions;
  maxConcurrency?: number;
  enabled?: boolean;
  defaultVisionContext?: AiVisionOptions;
}

export interface AiCliAdapterOptions {
  provider?: 'claude' | 'codex' | 'custom-cli';
  command: string;
  args?: string[];
  cwd?: string;
  inputMode?: 'stdin-json' | 'request-file';
}

export interface AiArtifactMeta {
  provider: string;
  status: 'passed' | 'failed';
  durationMs: number;
  command?: string;
  args?: string[];
  exitCode?: number | null;
  errorType?: string;
}
