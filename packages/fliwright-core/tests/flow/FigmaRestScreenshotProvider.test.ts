import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { captureFigmaReviewScreenshots, FigmaRestScreenshotProvider } from '../../src/flow/FigmaRestScreenshotProvider.js';
import type { FlowReviewFigmaCaptureTask } from '../../src/flow/FlowReviewBundle.js';

describe('FigmaRestScreenshotProvider', () => {
  it('resolves a Figma image URL and downloads the screenshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-figma-'));
    const screenshotPath = join(root, 'figma', 'node.png');
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === '/v1/images/FILE123') {
        expect(url.searchParams.get('ids')).toBe('10:20');
        expect(url.searchParams.get('format')).toBe('png');
        expect(url.searchParams.get('scale')).toBe('2');
        return new Response(JSON.stringify({
          images: { '10:20': 'https://figma-cdn.example/node.png' },
        }), { status: 200 });
      }
      if (url.href === 'https://figma-cdn.example/node.png') {
        return new Response(Buffer.from('png-bytes'), { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });
    const provider = new FigmaRestScreenshotProvider({
      accessToken: 'figma-token',
      baseUrl: 'https://api.figma.test/',
      fetch: fetch as unknown as typeof globalThis.fetch,
      scale: 2,
    });

    const result = await provider.capture(task({ screenshotPath }));

    expect(result).toEqual({
      flowNodeId: 'screen-1',
      screenshotPath,
    });
    expect(await readFile(screenshotPath, 'utf8')).toBe('png-bytes');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).toEqual({
      headers: {
        'X-Figma-Token': 'figma-token',
      },
    });
  });

  it('returns an artifact error when the token is missing', async () => {
    const provider = new FigmaRestScreenshotProvider({
      accessToken: '',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

    const result = await provider.capture(task({ screenshotPath: '/tmp/node.png' }));

    expect(result).toEqual({
      flowNodeId: 'screen-1',
      error: 'Missing Figma access token. Set FIGMA_ACCESS_TOKEN or pass accessToken.',
    });
  });

  it('captures tasks sequentially through the provider interface', async () => {
    const provider = {
      capture: vi.fn(async (input: FlowReviewFigmaCaptureTask) => ({
        flowNodeId: input.flowNodeId,
        screenshotPath: input.screenshotPath,
      })),
    };

    const captures = await captureFigmaReviewScreenshots([
      task({ flowNodeId: 'first', screenshotPath: '/tmp/first.png' }),
      task({ flowNodeId: 'second', screenshotPath: '/tmp/second.png' }),
    ], provider);

    expect(captures).toEqual([
      { flowNodeId: 'first', screenshotPath: '/tmp/first.png' },
      { flowNodeId: 'second', screenshotPath: '/tmp/second.png' },
    ]);
    expect(provider.capture).toHaveBeenCalledTimes(2);
  });
});

function task(overrides: Partial<FlowReviewFigmaCaptureTask>): FlowReviewFigmaCaptureTask {
  return {
    flowNodeId: 'screen-1',
    title: 'Screen',
    fileKey: 'FILE123',
    nodeId: '10:20',
    screenshotPath: '/tmp/screen-1.png',
    metadataPath: '/tmp/screen-1.metadata.json',
    mcpTool: 'figma.get_screenshot',
    ...overrides,
  };
}
