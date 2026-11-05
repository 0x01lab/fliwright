import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { NativeError } from '@fliwright/core';
import { readPrivateRecord } from './RecoveryTransaction.js';

export interface RecoveryOriginal {
  lockPath: string; dirtyPath: string; digest: string; lockArchived: boolean; dirtyArchived: boolean; dirtyPresent: boolean;
}

/** Resolve one physical location per resource and hash identities plus exact private bytes.
 * ctime is checked by readPrivateRecord while reading; it is excluded from the portable digest
 * because rename can update it. Inode, mode, size, mtime and bytes must survive archival unchanged.
 */
export async function readRecoveryOriginal(root: string, key: string, recovery: string): Promise<RecoveryOriginal> {
  const sourceLock = join(root, `${key}.lock`), archivedLock = join(recovery, 'original.lock');
  const sourceDirty = join(root, `${key}.dirty`), archivedDirty = join(recovery, 'original.dirty');
  const [lockPresent, lockArchived, dirtyPresent, dirtyArchived] = await Promise.all([recoveryPathExists(sourceLock), recoveryPathExists(archivedLock), recoveryPathExists(sourceDirty), recoveryPathExists(archivedDirty)]);
  if (lockPresent === lockArchived || dirtyPresent && dirtyArchived) throw failure();
  const lockPath = lockArchived ? archivedLock : sourceLock, dirtyPath = dirtyArchived ? archivedDirty : sourceDirty;
  const entries: unknown[] = [['root', await directory(root)]];
  const scan = async (path: string, name: string, depth = 0): Promise<void> => {
    if (depth > 3 || entries.length > 64) throw failure();
    const before = await lstat(path);
    if (before.isDirectory() && !before.isSymbolicLink()) {
      const names = (await readdir(path)).sort();
      entries.push([name, await directory(path), names]);
      for (const child of names) await scan(join(path, child), `${name}/${child}`, depth + 1);
      if (JSON.stringify((await readdir(path)).sort()) !== JSON.stringify(names)) throw failure();
    } else {
      const saved = await readPrivateRecord(path), after = await lstat(path);
      const identity = (info: typeof before) => JSON.stringify([info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs]);
      if (identity(before) !== identity(after)) throw failure();
      entries.push([name, identity(after), saved.bytes]);
    }
  };
  await scan(lockPath, 'lock');
  if (dirtyPresent || dirtyArchived) await scan(dirtyPath, 'dirty'); else entries.push(['dirty', 'absent']);
  return { lockPath, dirtyPath, lockArchived, dirtyArchived, dirtyPresent: dirtyPresent || dirtyArchived,
    digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
async function directory(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw failure();
  return JSON.stringify([info.dev, info.ino, info.mode]);
}
export async function recoveryPathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function failure(): NativeError { return new NativeError('cleanup_failed', 'Original recovery evidence changed; preserve its records.'); }
