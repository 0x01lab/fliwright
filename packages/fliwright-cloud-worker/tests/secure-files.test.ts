import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionLease } from '@fliwright/cloud-protocol';
import { expect, it } from 'vitest';
import { stopOwnedProcesses } from '../src/processes.js';
import { prepareSecureFiles } from '../src/secure-files.js';

it('stages verified bytes privately for both Flutter flag forms and removes them on cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-secure-files-'));
  const path = '.env/sentry.dev.json';
  const bytes = Buffer.from('{"config":"fixture"}');
  const lease = { request: { secureFiles: [{ id: 'file', path }], target: {
    flutterArgs: ['--flavor', 'dev', `--dart-define-from-file=${path}`, '--dart-define-from-file', `./${path}`, '--dart-define-from-file=tracked.json'],
  } } } as ExecutionLease;
  const signal = new AbortController().signal;
  try {
    const content = bytes.toString('base64');
    await expect(prepareSecureFiles(lease, root, async () => ({ content, sha256: 'bad' }), signal)).rejects.toThrow('integrity');
    const staged = await prepareSecureFiles(lease, root, async () => ({ content, sha256: createHash('sha256').update(bytes).digest('hex') }), signal);
    const file = join(root, 'secure-files', '0', 'sentry.dev.json');
    expect(staged.request.target.flutterArgs).toEqual(['--flavor', 'dev', `--dart-define-from-file=${file}`, '--dart-define-from-file', file, '--dart-define-from-file=tracked.json']);
    expect(lease.request.target.flutterArgs[2]).toBe(`--dart-define-from-file=${path}`);
    expect(await readFile(file)).toEqual(bytes);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await stopOwnedProcesses(root);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
