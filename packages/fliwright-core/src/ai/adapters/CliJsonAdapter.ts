import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { AiInvocationError, AiParseError, AiTimeoutError } from '../errors.js';
import type { AiAdapter, AiAdapterResponse, AiCliAdapterOptions, AiInvocationContext, AiRequest } from '../types.js';

export class CliJsonAdapter implements AiAdapter {
  readonly name: string;
  private readonly args: string[];
  private readonly inputMode: 'stdin-json' | 'request-file';

  constructor(private readonly options: AiCliAdapterOptions) {
    this.name = options.provider ?? 'custom-cli';
    this.args = options.args ?? [];
    this.inputMode = options.inputMode ?? 'stdin-json';
  }

  async invoke(request: AiRequest, context: AiInvocationContext): Promise<AiAdapterResponse> {
    const normalized = normalizeRequest(request);
    const { args, stdin } = await this.buildInput(normalized);

    return new Promise<AiAdapterResponse>((resolve, reject) => {
      const child = spawn(this.options.command, [...this.args, ...args], {
        cwd: this.options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timeout);
        context.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        cleanup();
        reject(new AiInvocationError('AI CLI invocation aborted', { artifactsDir: context.artifactsDir }));
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        context.signal.removeEventListener('abort', onAbort);
        reject(new AiTimeoutError(`AI CLI timed out after ${context.timeoutMs}ms`, { artifactsDir: context.artifactsDir }));
      }, context.timeoutMs);

      context.signal.addEventListener('abort', onAbort, { once: true });
      if (context.signal.aborted) {
        onAbort();
        return;
      }
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        stdout += chunk;
      });
      child.stderr.on('data', chunk => {
        stderr += chunk;
      });
      child.on('error', error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new AiInvocationError(error.message, { cause: error, artifactsDir: context.artifactsDir }));
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        cleanup();
        if (code !== 0) {
          reject(new AiInvocationError(stderr.trim() || `AI CLI exited with code ${code}`, { artifactsDir: context.artifactsDir }));
          return;
        }
        try {
          resolve(parseCliOutput(stdout, request.responseFormat, {
            exitCode: code,
            stderr,
            command: basename(this.options.command),
            args: this.args,
          }));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(stdin || undefined);
    });
  }

  private async buildInput(request: unknown): Promise<{ args: string[]; stdin: string }> {
    const json = `${JSON.stringify(request, null, 2)}\n`;
    if (this.inputMode === 'request-file') {
      const dir = await mkdtemp(join(tmpdir(), 'fliwright-ai-request-'));
      const path = join(dir, 'request.json');
      await writeFile(path, json);
      return { args: [path], stdin: '' };
    }
    return { args: [], stdin: json };
  }
}

function normalizeRequest(request: AiRequest): Record<string, unknown> {
  return {
    ...request,
    images: request.images?.map(image => ({
      name: image.name,
      mimeType: image.mimeType,
      data: Buffer.isBuffer(image.data) ? image.data.toString('base64') : image.data,
    })),
    files: request.files?.map(file => ({
      name: file.name,
      mimeType: file.mimeType,
      content: Buffer.isBuffer(file.content) ? file.content.toString('base64') : file.content,
    })),
  };
}

function parseCliOutput(stdout: string, responseFormat: AiRequest['responseFormat'], raw: unknown): AiAdapterResponse {
  const jsonText = extractJson(stdout);
  if (!jsonText) {
    const jsonl = parseJsonlOutput(stdout, responseFormat, raw);
    if (jsonl) return jsonl;
    if (responseFormat === 'json') throw new AiParseError('AI CLI did not return JSON');
    return { text: stdout, raw };
  }
  try {
    const parsed = JSON.parse(jsonText) as Partial<AiAdapterResponse>;
    return normalizeAdapterResponse(parsed, jsonText, responseFormat, raw);
  } catch (cause) {
    const jsonl = parseJsonlOutput(stdout, responseFormat, raw);
    if (jsonl) return jsonl;
    throw new AiParseError('AI CLI returned invalid JSON', { cause });
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  return fenced?.[1]?.trim() ?? null;
}

function parseJsonlOutput(stdout: string, responseFormat: AiRequest['responseFormat'], raw: unknown): AiAdapterResponse | null {
  const events: unknown[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (!events.length) return null;

  for (const event of [...events].reverse()) {
    if (!isRecord(event)) continue;
    if (typeof event.text === 'string' || 'json' in event) {
      const fallbackText = typeof event.text === 'string' ? event.text : JSON.stringify(event);
      return normalizeAdapterResponse(event as Partial<AiAdapterResponse>, fallbackText, responseFormat, raw);
    }
  }

  const finalText = [...events].reverse()
    .map(extractAssistantText)
    .find((text): text is string => typeof text === 'string' && text.trim().length > 0);
  if (!finalText) return null;
  return responseFromText(finalText.trim(), responseFormat, raw);
}

function normalizeAdapterResponse(
  parsed: Partial<AiAdapterResponse>,
  fallbackText: string,
  responseFormat: AiRequest['responseFormat'],
  raw: unknown,
): AiAdapterResponse {
  const text = typeof parsed.text === 'string' ? parsed.text : fallbackText;
  return {
    text,
    json: parsed.json ?? parseJsonResponseText(text, responseFormat),
    metadata: parsed.metadata,
    raw,
  };
}

function responseFromText(text: string, responseFormat: AiRequest['responseFormat'], raw: unknown): AiAdapterResponse {
  return {
    text,
    json: parseJsonResponseText(text, responseFormat),
    raw,
  };
}

function parseJsonResponseText(text: string, responseFormat: AiRequest['responseFormat']): unknown {
  if (responseFormat !== 'json') return undefined;
  const jsonText = extractJson(text);
  if (!jsonText) return undefined;
  try {
    return JSON.parse(jsonText);
  } catch {
    return undefined;
  }
}

function extractAssistantText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (isAssistantLike(value)) {
    return textFromContent(value.content)
      ?? textFromContent(value.message)
      ?? textFromContent(value.item)
      ?? stringField(value, 'text')
      ?? stringField(value, 'last_agent_message')
      ?? stringField(value, 'lastAgentMessage')
      ?? stringField(value, 'delta');
  }
  return textFromContent(value.item)
    ?? textFromContent(value.message)
    ?? textFromContent(value.response)
    ?? textFromContent(value.output)
    ?? textFromContent(value.data)
    ?? stringField(value, 'final')
    ?? stringField(value, 'result')
    ?? stringField(value, 'last_agent_message')
    ?? stringField(value, 'lastAgentMessage');
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value) && !Array.isArray(value)) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map(textFromContent).filter((part): part is string => typeof part === 'string' && part.length > 0);
    return parts.length ? parts.join('') : undefined;
  }
  return stringField(value, 'text')
    ?? stringField(value, 'output_text')
    ?? stringField(value, 'delta')
    ?? textFromContent(value.content)
    ?? textFromContent(value.message)
    ?? textFromContent(value.output);
}

function isAssistantLike(value: Record<string, unknown>): boolean {
  return value.role === 'assistant'
    || value.type === 'assistant'
    || value.type === 'assistant_message'
    || value.type === 'agent_message'
    || value.type === 'final_answer'
    || value.type === 'message';
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
