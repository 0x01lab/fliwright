import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { RunManifest } from './RunContracts.js';

export interface RunArtifactStoreOptions {
  runsRoot: string;
  runId: string;
}

export interface ReadEventsResult {
  events: unknown[];
  incompleteTrailingLine: boolean;
  /** One-based positions of complete lines that were not valid JSON. */
  corruptLines: number[];
}

export class RunArtifactStore {
  readonly runDir: string;

  constructor(options: RunArtifactStoreOptions) {
    this.runDir = join(options.runsRoot, options.runId);
  }

  async writeManifest(manifest: RunManifest): Promise<string> {
    await mkdir(this.runDir, { recursive: true });
    const path = join(this.runDir, 'run.json');
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
    return path;
  }

  attemptDir(testId: string, attemptId: string): string {
    return join(this.runDir, 'tests', safeSegment(testId), 'attempts', safeSegment(attemptId));
  }

  eventsPath(testId: string, attemptId: string): string {
    return join(this.attemptDir(testId, attemptId), 'events.jsonl');
  }

  async writeAttemptResult(testId: string, attemptId: string, result: unknown, options: { signal?: AbortSignal } = {}): Promise<string> {
    options.signal?.throwIfAborted();
    const directory = this.attemptDir(testId, attemptId);
    await mkdir(directory, { recursive: true });
    const path = join(directory, 'result.json');
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      options.signal?.throwIfAborted();
      await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', signal: options.signal });
      options.signal?.throwIfAborted();
      await rename(temporaryPath, path);
    } finally { await rm(temporaryPath, { force: true }).catch(() => {}); }
    return directory;
  }

  async appendEvent(testId: string, attemptId: string, event: unknown, options: { signal?: AbortSignal } = {}): Promise<string> {
    options.signal?.throwIfAborted();
    const path = this.eventsPath(testId, attemptId);
    await mkdir(this.attemptDir(testId, attemptId), { recursive: true });
    options.signal?.throwIfAborted();
    await writeFile(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a', signal: options.signal });
    return path;
  }

  async readEvents(path: string): Promise<ReadEventsResult> {
    const content = await readFile(path, 'utf8');
    const lines = content.split('\n');
    const incompleteTrailingLine = lines.at(-1) !== '';
    if (incompleteTrailingLine) lines.pop();
    const events: unknown[] = [];
    const corruptLines: number[] = [];
    lines.forEach((line, index) => {
      if (!line) return;
      try { events.push(JSON.parse(line)); } catch { corruptLines.push(index + 1); }
    });
    return {
      events,
      incompleteTrailingLine,
      corruptLines,
    };
  }
}

function safeSegment(value: string): string {
  if (!value) throw new Error('Artifact identity must not be empty.');
  return value === '.' || value === '..'
    ? value.replaceAll('.', '%2E') : encodeURIComponent(value);
}
