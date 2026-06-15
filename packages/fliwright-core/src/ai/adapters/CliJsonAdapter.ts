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
    if (responseFormat === 'json') throw new AiParseError('AI CLI did not return JSON');
    return { text: stdout, raw };
  }
  try {
    const parsed = JSON.parse(jsonText) as Partial<AiAdapterResponse>;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : jsonText,
      json: parsed.json,
      metadata: parsed.metadata,
      raw,
    };
  } catch (cause) {
    throw new AiParseError('AI CLI returned invalid JSON', { cause });
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  return fenced?.[1]?.trim() ?? null;
}
