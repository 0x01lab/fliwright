import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveFliwrightRuntimeRoot, type FliwrightDriver } from '@fliwright/core';
import { flowReviewRunCommand } from '../src/commands/flow-runtime.js';
import { executeCli } from '../src/index.js';

vi.mock('@fliwright/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@fliwright/core')>(),
  resolveFliwrightRuntimeRoot: vi.fn(),
}));

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-flow-runtime-'));
  roots.push(root);
  await mkdir(join(root, '.fliwright', 'flows'), { recursive: true });
  await writeFile(join(root, '.fliwright', 'flows', 'screen.flow.json'), JSON.stringify({
    version: 1, id: 'screen', createdAt: '2026-11-06', updatedAt: '2026-11-06', edges: [],
    nodes: [{ id: 'screen', title: 'Screen', type: 'screen', route: '/screen', figma: { fileKey: 'FILE', nodeId: '1:2' } }],
  }));
  vi.mocked(resolveFliwrightRuntimeRoot).mockReturnValue(join(root, 'runtime'));
  return root;
}

describe('flow review runtime', () => {
  it('preserves successive review evidence even in the same millisecond', async () => {
    const root = await workspace();
    const image = Buffer.from('runtime capture');
    vi.spyOn(Date, 'now').mockReturnValue(1793962800000);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => input instanceof URL
      ? new Response(JSON.stringify({ images: { '1:2': 'https://figma.test/screen.png' } }))
      : new Response(image)));
    const driver = { page: { goto: vi.fn(), screenshot: vi.fn(async () => image) } } as unknown as FliwrightDriver;
    const deps = { sessionProvider: async () => ({ driver, vmServiceUrl: 'ws://127.0.0.1:9876/test' }) };
    const options = { cwd: root, id: 'screen', accessToken: 'test', autoCompare: false };
    const first = await flowReviewRunCommand(options, deps);
    const firstReport = await readFile(first.reportPath, 'utf8');
    const second = await flowReviewRunCommand(options, deps);
    expect(second.reportPath).not.toBe(first.reportPath);
    expect(second.bundlePath).not.toBe(first.bundlePath);
    expect(second.runtimeCapturesFile).not.toBe(first.runtimeCapturesFile);
    expect(await readFile(first.reportPath, 'utf8')).toBe(firstReport);
    expect(dirname(first.reportPath)).toBe(dirname(first.bundlePath));

    const outputDir = join(root, 'explicit-review');
    const explicit = await flowReviewRunCommand({ ...options, outputDir }, deps);
    expect(dirname(explicit.reportPath)).toBe(outputDir);
  });

  it('propagates CLI deadlines into Figma capture requests', async () => {
    const root = await workspace();
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const execution = executeCli(['flow', 'review-capture-figma', 'screen', '--cwd', root, '--access-token', 'test', '--deadline', '30', '--json']);
    const result = await Promise.race([
      execution,
      new Promise<undefined>((resolve) => { setTimeout(resolve, 500); }),
    ]);
    expect(result?.exitCode).toBe(5);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
