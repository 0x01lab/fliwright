import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { flutterFileArguments, secureFileMaxBytes, type ExecutionLease } from '@fliwright/cloud-protocol';

export async function prepareSecureFiles(
  lease: ExecutionLease,
  directory: string,
  download: (id: string) => Promise<{ content: string; sha256: string }>,
  signal: AbortSignal,
): Promise<ExecutionLease> {
  if (!lease.request.secureFiles?.length) return lease;
  const flutterArgs = [...lease.request.target.flutterArgs];
  const paths = new Map<string, string>();
  for (const [index, file] of lease.request.secureFiles.entries()) {
    signal.throwIfAborted();
    const { content, sha256 } = await download(file.id);
    signal.throwIfAborted();
    if (typeof content !== 'string' || content.length > 4 * Math.ceil(secureFileMaxBytes / 3))
      throw new Error('Invalid secure file download');
    const bytes = Buffer.from(content, 'base64');
    if (!bytes.length || bytes.length > secureFileMaxBytes || createHash('sha256').update(bytes).digest('hex') !== sha256)
      throw new Error('Secure file integrity check failed');
    const folder = resolve(directory, 'secure-files', String(index));
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, basename(file.path));
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx', signal });
    paths.set(file.path, path);
  }
  for (const { path, prefix, valueIndex } of flutterFileArguments(flutterArgs)) {
    const staged = paths.get(path.replace(/^\.\//, ''));
    if (staged) flutterArgs[valueIndex] = `${prefix}${staged}`;
  }
  return { ...lease, request: { ...lease.request, target: { ...lease.request.target, flutterArgs } } };
}
