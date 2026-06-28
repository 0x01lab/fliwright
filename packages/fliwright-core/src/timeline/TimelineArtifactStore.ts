import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveFliwrightRunsRoot } from '../runArtifacts.js';
import type { TimelineArtifactRef, TimelineData } from './types.js';

export interface TimelineArtifactStoreOptions {
  cwd?: string;
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
    this.runDir = join(root, options.runId);
  }

  get timelinePath(): string {
    return join(this.runDir, 'timeline.json');
  }

  async writeTimeline(data: TimelineData): Promise<string> {
    await mkdir(this.runDir, { recursive: true });
    await writeFile(this.timelinePath, JSON.stringify(data, null, 2), 'utf8');
    return this.timelinePath;
  }

  async writeScreenshot(nodeId: string, buffer: Buffer | Uint8Array): Promise<TimelineArtifactRef> {
    const path = join('artifacts', 'screenshots', `${safeName(nodeId)}.png`);
    await this.writeBinary(path, buffer);
    return { kind: 'screenshot', path, mimeType: 'image/png' };
  }

  async writeSnapshot(nodeId: string, snapshot: unknown): Promise<TimelineArtifactRef> {
    const path = join('artifacts', 'snapshots', `${safeName(nodeId)}.json`);
    await this.writeJson(path, snapshot);
    return { kind: 'snapshot', path, mimeType: 'application/json' };
  }

  async writeDiagnostics(nodeId: string, diagnostics: unknown): Promise<TimelineArtifactRef> {
    const path = join('artifacts', 'diagnostics', `${safeName(nodeId)}.json`);
    await this.writeJson(path, diagnostics);
    return { kind: 'diagnostics', path, mimeType: 'application/json' };
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
