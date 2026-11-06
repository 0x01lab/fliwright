import { afterEach, expect, it, vi } from 'vitest';
import { inspectNativeToolProcess } from '../src/NativeToolOwnership.js';
import { executeTool } from '../src/ToolExecutor.js';

const inventory = vi.hoisted(() => ({ prefix: '' }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile(file: string, args: string[], options: object,
      callback: (error: Error | null, stdout: string, stderr: string) => void) {
      return actual.execFile(file, args, options, (error, stdout, stderr) => {
        callback(error, file === '/bin/ps' ? inventory.prefix + stdout : stdout, stderr);
      });
    },
  };
});
afterEach(() => { inventory.prefix = ''; });

it('inspects a live tool when Linux kernel threads have process group zero', async () => {
  inventory.prefix = '    2     0 S    [kthreadd]\n';
  const { spawn } = await import('node:child_process');
  const resourceId = '11111111-1111-1111-1111-111111111111';
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `fliwright-tool:${resourceId}`],
    { detached: true, stdio: 'ignore' });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  try {
    expect(await inspectNativeToolProcess({ schemaVersion: 1, resourceId, operationToken: 'test',
      ownerPid: process.pid, createdAt: new Date().toISOString(), phase: 'running',
      wrapperPid: child.pid!, group: child.pid! })).toBe('live');
  } finally { child.kill('SIGKILL'); await closed; }
});

it('confirms real tool cleanup when unrelated kernel threads have process group zero', async () => {
  inventory.prefix = '    2     0 S\n';
  const output = await executeTool(process.execPath, ['-e', 'process.stdout.write("done")'], {
    requestId: 'kernel-threads', deadline: Date.now() + 3000, signal: new AbortController().signal,
  });
  expect(output.toString()).toBe('done');
});
