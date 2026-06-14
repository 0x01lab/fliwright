import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AiArtifactMeta, AiRequest } from './types.js';

export interface AiArtifactPathInput {
  runId?: string;
  testName?: string;
  callId: string;
}

export class AiArtifactStore {
  constructor(private readonly rootDir: string) {}

  async createInvocationDir(input: AiArtifactPathInput): Promise<string> {
    const run = sanitizeSegment(input.runId ?? 'run');
    const test = sanitizeSegment(input.testName ?? 'unknown-test');
    const call = sanitizeSegment(input.callId);
    const dir = resolve(this.rootDir, run, test, call);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async writeRequest(dir: string, request: AiRequest): Promise<void> {
    await writeJson(dir, 'request.json', request);
  }

  async writePrompt(dir: string, prompt: string): Promise<void> {
    await writeFile(resolve(dir, 'prompt.md'), prompt);
  }

  async writeResponseText(dir: string, text: string): Promise<void> {
    await writeFile(resolve(dir, 'response.txt'), text);
  }

  async writeResponseJson(dir: string, json: unknown): Promise<void> {
    await writeJson(dir, 'response.json', json);
  }

  async writeScreenshot(dir: string, screenshot: Buffer): Promise<void> {
    await writeFile(resolve(dir, 'screenshot.png'), screenshot);
  }

  async writeSnapshot(dir: string, snapshot: unknown): Promise<void> {
    await writeJson(dir, 'snapshot.json', snapshot);
  }

  async writeStderr(dir: string, stderr: string): Promise<void> {
    await writeFile(resolve(dir, 'stderr.txt'), stderr);
  }

  async writeMeta(dir: string, meta: AiArtifactMeta): Promise<void> {
    await writeJson(dir, 'meta.json', meta);
  }
}

async function writeJson(dir: string, filename: string, value: unknown): Promise<void> {
  await writeFile(resolve(dir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return sanitized.length > 0 ? sanitized : 'unknown';
}
