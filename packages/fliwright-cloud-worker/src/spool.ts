import { chmod, lstat, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Limits apply per slot to inactive evidence, including failed upload bundles. */
export interface SpoolRetention {
  maxAttempts: number;
  maxAgeHours: number;
  maxBytes: number;
  /** Files, directories and symlinks all count toward the inode budget. */
  maxFiles: number;
}
export const defaultSpoolRetention: Readonly<SpoolRetention> = Object.freeze({
  maxAttempts: 20,
  maxAgeHours: 7 * 24,
  maxBytes: 1024 * 1024 * 1024,
  maxFiles: 10000,
});

async function info(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
}

/** Remove only owned directories; frozen checkouts and symlinks need special care. */
export async function removeSpoolPath(path: string): Promise<void> {
  const stat = await info(path);
  if (!stat) return;
  if (stat.isDirectory()) {
    await chmod(path, stat.mode | 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await removeSpoolPath(join(path, entry.name));
    }
  }
  await rm(path, { recursive: true, force: true });
}

/** Called under the slot lock, after process termination and acknowledged completion. */
export async function compactSpoolAttempt(directory: string, published: boolean, bundleReady = false): Promise<void> {
  await removeSpoolPath(join(directory, 'checkout'));
  const bundle = await info(join(directory, 'bundle'));
  // Keep raw evidence when export failed; otherwise the bundle is the retry source.
  if ((bundleReady && bundle?.isDirectory()) || published) await removeSpoolPath(join(directory, 'runs'));
  if (published) {
    await removeSpoolPath(join(directory, 'bundle'));
    await removeSpoolPath(join(directory, 'publication.json'));
  }
}

/** The caller holds slot.lock; never run this against an active/unrecovered slot. */
export async function pruneSpool(
  root: string,
  retention: Partial<SpoolRetention> | undefined,
  stopOwned: (directory: string) => Promise<void>,
): Promise<void> {
  const limits = { ...defaultSpoolRetention, ...retention };
  const spool = join(root, 'spool');
  const spoolInfo = await info(spool);
  if (!spoolInfo) return;
  if (!spoolInfo.isDirectory()) throw new Error('Worker spool must be an owned directory');
  const attempts: Array<{ directory: string; completedAt: number; published: boolean; bundleReady: boolean; acknowledged: boolean }> = [];
  for (const entry of await readdir(spool, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(spool, entry.name);
    const marker = join(directory, 'retention.json');
    const markerInfo = await info(marker);
    let completedAt: number;
    let published = false;
    let bundleReady = false;
    if (markerInfo?.isFile()) {
      const saved = JSON.parse(await readFile(marker, 'utf8')) as { completedAt: number; published: boolean; bundleReady?: boolean };
      if (!Number.isFinite(saved.completedAt) || typeof saved.published !== 'boolean')
        throw new Error('Invalid Worker spool retention journal');
      completedAt = saved.completedAt;
      published = saved.published;
      bundleReady = saved.bundleReady === true;
    } else {
      // Legacy attempts have no terminal marker. Confirm termination before touching them.
      completedAt = (await info(join(directory, 'result.json')) ?? await info(join(directory, 'job.json')) ?? await lstat(directory)).mtimeMs;
      published = Boolean((await info(join(directory, 'upload-recovered.json')))?.isFile());
      const resultPath = join(directory, 'result.json');
      if ((await info(resultPath))?.isFile()) {
        const result = JSON.parse(await readFile(resultPath, 'utf8')) as { bundleDir?: string };
        bundleReady = typeof result.bundleDir === 'string';
      }
    }
    attempts.push({ directory, completedAt, published, bundleReady, acknowledged: Boolean(markerInfo?.isFile()) });
  }
  attempts.sort((a, b) => b.completedAt - a.completedAt || a.directory.localeCompare(b.directory));
  let kept = 0, bytes = 0, files = 0;
  for (const attempt of attempts) {
    if (!attempt.acknowledged) await stopOwned(attempt.directory);
    if (Date.now() - attempt.completedAt > limits.maxAgeHours * 3600000 || kept >= limits.maxAttempts) {
      await removeSpoolPath(attempt.directory);
      continue;
    }
    await compactSpoolAttempt(attempt.directory, attempt.published, attempt.bundleReady);
    const usage = { bytes: 0, files: 0 };
    const measure = async (path: string): Promise<void> => {
      const stat = await lstat(path);
      usage.files++;
      usage.bytes += stat.size;
      if (stat.isDirectory()) {
        for (const entry of await readdir(path)) {
          if (bytes + usage.bytes > limits.maxBytes || files + usage.files > limits.maxFiles) return;
          await measure(join(path, entry));
        }
      }
    };
    await measure(attempt.directory);
    if (bytes + usage.bytes > limits.maxBytes || files + usage.files > limits.maxFiles) {
      await removeSpoolPath(attempt.directory);
      continue;
    }
    bytes += usage.bytes;
    files += usage.files;
    kept++;
  }
}
