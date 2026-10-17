import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, posix } from 'node:path';
import { resolveFliwrightRunsRoot } from '../runArtifacts.js';
import type { TimelineArtifactRef, TimelineData } from './types.js';
import {
  TIMELINE_ARTIFACT_KIND_DIAGNOSTICS,
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_ARTIFACT_KIND_SNAPSHOT,
  TIMELINE_ARTIFACTS_DIR,
  TIMELINE_DIAGNOSTICS_DIR,
  TIMELINE_FILE_NAME,
  TIMELINE_SCREENSHOTS_DIR,
  TIMELINE_SNAPSHOTS_DIR,
} from './constants.js';

export interface TimelineArtifactStoreOptions {
  cwd?: string;
  /** Canonical attempt directory assigned by the run store. */
  attemptDir?: string;
  /** Absolute root for run artifacts. Overrides env + legacy default. */
  runsRoot?: string;
  runId: string;
}

export class TimelineArtifactStore {
  readonly runDir: string;

  constructor(options: TimelineArtifactStoreOptions) {
    const root = resolveFliwrightRunsRoot({
      runsRoot: options.runsRoot,
      projectRoot: options.cwd,
    });
    this.runDir = options.attemptDir ?? join(root, options.runId);
  }

  get timelinePath(): string {
    return join(this.runDir, TIMELINE_FILE_NAME);
  }

  async writeTimeline(data: TimelineData, options: { signal?: AbortSignal } = {}): Promise<string> {
    options.signal?.throwIfAborted();
    await mkdir(this.runDir, { recursive: true });
    const temporaryPath = `${this.timelinePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      options.signal?.throwIfAborted();
      await writeFile(temporaryPath, JSON.stringify(data, null, 2), { encoding: 'utf8', signal: options.signal });
      options.signal?.throwIfAborted();
      await rename(temporaryPath, this.timelinePath);
    } finally { await rm(temporaryPath, { force: true }).catch(() => {}); }
    return this.timelinePath;
  }

  async writeScreenshot(nodeId: string, buffer: Buffer | Uint8Array): Promise<TimelineArtifactRef> {
    const path = posix.join(TIMELINE_ARTIFACTS_DIR, TIMELINE_SCREENSHOTS_DIR, `${safeName(nodeId)}.png`);
    await this.writeBinary(path, buffer);
    return { kind: TIMELINE_ARTIFACT_KIND_SCREENSHOT, path, mimeType: 'image/png' };
  }

  async writeSnapshot(nodeId: string, snapshot: unknown): Promise<TimelineArtifactRef> {
    const path = posix.join(TIMELINE_ARTIFACTS_DIR, TIMELINE_SNAPSHOTS_DIR, `${safeName(nodeId)}.json`);
    await this.writeJson(path, snapshot);
    return { kind: TIMELINE_ARTIFACT_KIND_SNAPSHOT, path, mimeType: 'application/json' };
  }

  async writeDiagnostics(nodeId: string, diagnostics: unknown): Promise<TimelineArtifactRef> {
    const path = posix.join(TIMELINE_ARTIFACTS_DIR, TIMELINE_DIAGNOSTICS_DIR, `${safeName(nodeId)}.json`);
    await this.writeJson(path, diagnostics);
    return { kind: TIMELINE_ARTIFACT_KIND_DIAGNOSTICS, path, mimeType: 'application/json' };
  }

  private async writeJson(relativePath: string, value: unknown): Promise<void> {
    const absolutePath = join(this.runDir, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, JSON.stringify(value, null, 2), 'utf8');
  }

  private async writeBinary(relativePath: string, value: Buffer | Uint8Array): Promise<void> {
    const absolutePath = join(this.runDir, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, value);
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}
