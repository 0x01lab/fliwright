import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface InputOptions { cwd?: string; signal?: AbortSignal; stdin?: string; }

/** A single JSON input may be supplied without creating an intermediate file. */
export async function readJson(path: string, options: InputOptions): Promise<unknown> {
  options.signal?.throwIfAborted();
  if (path === '-') {
    if (options.stdin === undefined) throw new Error('JSON stdin was not supplied.');
    return JSON.parse(options.stdin);
  }
  return JSON.parse(await readFile(resolve(options.cwd ?? process.cwd(), path), { encoding: 'utf8', signal: options.signal }));
}

/** Publish a complete replacement; failed writes and cooperating concurrent edits preserve the original. */
export async function replaceFile(path: string, content: string, options: { expected?: string; signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  const lock = await open(`${path}.lock`, 'wx');
  let scratch: string | undefined;
  try {
    let mode = 0o600;
    try {
      const stat = await lstat(path);
      if (!stat.isFile()) throw new Error('Replacement requires a regular file.');
      mode = stat.mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || options.expected !== undefined) throw error;
    }
    if (options.expected !== undefined && await readFile(path, 'utf8') !== options.expected)
      throw new Error('Plan changed during update; read the current plan and retry.');
    scratch = await mkdtemp(join(dirname(path), '.test-plan-'));
    const temporary = join(scratch, 'replacement');
    await writeFile(temporary, content, { encoding: 'utf8', mode, signal: options.signal, flag: 'wx' });
    options.signal?.throwIfAborted();
    await rename(temporary, path);
  } finally {
    try { if (scratch) await rm(scratch, { recursive: true, force: true }); }
    finally { await lock.close(); await rm(`${path}.lock`); }
  }
}
