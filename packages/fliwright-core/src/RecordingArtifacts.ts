import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { RecordingResult } from './RecorderController.js';
import type { RecordingScreenshot } from './types.js';

export interface RecordingBinaryCacheStats {
  /** Screenshot payloads are released as soon as their file is published. */
  retainedBytes: number;
  peakScreenshotBytes: number;
  maxScreenshotBytes: number;
  writtenScreenshots: number;
}

/** One synchronous write at a time; no history of image payloads or pending disk writes. */
export class RecordingArtifactStore {
  private peakScreenshotBytes = 0;
  private writtenScreenshots = 0;

  constructor(readonly directory: string, readonly maxScreenshotBytes = 8 * 1024 * 1024) {}

  screenshot(base64: string, metadata: Omit<RecordingScreenshot, 'path' | 'byteLength'>): RecordingScreenshot {
    // Check the decoded budget before allocating a second copy of the payload.
    const bytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (bytes > this.maxScreenshotBytes) throw new Error(`Recording screenshot byte budget exhausted (${bytes} > ${this.maxScreenshotBytes}).`);
    const image = Buffer.from(base64, 'base64');
    this.peakScreenshotBytes = Math.max(this.peakScreenshotBytes, image.length);
    const path = `screenshots/${randomUUID()}.png`;
    const target = join(this.directory, path);
    const temporary = `${target}.tmp`;
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(temporary, image);
      renameSync(temporary, target);
    } catch (error) {
      try { rmSync(temporary, { force: true }); } catch { /* Keep the write error. */ }
      const message = (error instanceof Error ? error.message : String(error)).split(this.directory).join('<recording-artifacts>');
      throw new Error(`Recording screenshot write failed: ${message}`);
    }
    this.writtenScreenshots++;
    return { ...metadata, path, byteLength: image.length };
  }

  stats(): RecordingBinaryCacheStats {
    return { retainedBytes: 0, peakScreenshotBytes: this.peakScreenshotBytes,
      maxScreenshotBytes: this.maxScreenshotBytes, writtenScreenshots: this.writtenScreenshots };
  }
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

/** Resolve an existing file reference, including a realpath check against symlink escapes. */
export function resolveRecordingArtifact(directory: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\') || /^[A-Za-z]:/.test(path)
    || path.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw new Error(`Invalid recording artifact reference: ${path}`);
  }
  const target = resolve(directory, path);
  if (!contained(resolve(directory), target) || !contained(realpathSync(directory), realpathSync(target))) {
    throw new Error(`Recording artifact escapes its directory: ${path}`);
  }
  return target;
}

/** Copy only referenced evidence, one file at a time, without loading binary history. */
export async function copyRecordingArtifacts(
  recording: Pick<RecordingResult, 'frames' | 'rawEventsFile'>,
  sourceDirectory: string | undefined,
  destinationDirectory: string,
): Promise<void> {
  const files = new Map<string, number | undefined>();
  if (recording.rawEventsFile) files.set(recording.rawEventsFile, undefined);
  for (const frame of recording.frames) {
    if (frame.screenshot) files.set(frame.screenshot.path, frame.screenshot.byteLength);
  }
  if (!files.size) return;
  if (!sourceDirectory) throw new Error('Recording artifact directory is required to preserve evidence.');
  await mkdir(destinationDirectory, { recursive: true });
  for (const [path, byteLength] of files) {
    const source = resolveRecordingArtifact(sourceDirectory, path);
    const info = await stat(source);
    if (!info.isFile() || (byteLength !== undefined && info.size !== byteLength)) {
      throw new Error(`Recording artifact is incomplete: ${path}`);
    }
    if (resolve(sourceDirectory) === resolve(destinationDirectory)) continue;
    const destination = resolve(destinationDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    if (!contained(realpathSync(destinationDirectory), realpathSync(dirname(destination)))) {
      throw new Error(`Recording artifact destination escapes its directory: ${path}`);
    }
    // Rename replaces any destination symlink rather than following it.
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, temporary);
      renameSync(temporary, destination);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
