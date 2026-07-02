import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { compareFlowScreenshots } from '../../src/flow/FlowVisualDiff.js';

describe('compareFlowScreenshots', () => {
  it('compares two PNG screenshots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fliwright-visual-diff-'));
    const runtime = join(dir, 'runtime.png');
    const figma = join(dir, 'figma.png');
    await writeFile(runtime, pngRgba(2, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]));
    await writeFile(figma, pngRgba(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]));

    const comparison = await compareFlowScreenshots({
      flowNodeId: 'screen-1',
      runtimeScreenshotPath: runtime,
      figmaScreenshotPath: figma,
    });

    expect(comparison).toMatchObject({
      flowNodeId: 'screen-1',
      pixelDiff: 0.5,
      layoutPx: 0,
    });
  });

  it('reports layout delta when image sizes differ', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fliwright-visual-diff-size-'));
    const runtime = join(dir, 'runtime.png');
    const figma = join(dir, 'figma.png');
    await writeFile(runtime, pngRgba(1, 1, [[255, 0, 0, 255]]));
    await writeFile(figma, pngRgba(2, 1, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]));

    const comparison = await compareFlowScreenshots({
      flowNodeId: 'screen-1',
      runtimeScreenshotPath: runtime,
      figmaScreenshotPath: figma,
    });

    expect(comparison).toMatchObject({
      flowNodeId: 'screen-1',
      pixelDiff: 0.5,
      layoutPx: 1,
      notes: 'image size differs: runtime 1x1, figma 2x1',
    });
  });

  it('returns a comparison error for non-PNG inputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fliwright-visual-diff-invalid-'));
    const runtime = join(dir, 'runtime.txt');
    const figma = join(dir, 'figma.png');
    await writeFile(runtime, 'not an image', 'utf8');
    await writeFile(figma, pngRgba(1, 1, [[255, 0, 0, 255]]));

    const comparison = await compareFlowScreenshots({
      flowNodeId: 'screen-1',
      runtimeScreenshotPath: runtime,
      figmaScreenshotPath: figma,
    });

    expect(comparison).toMatchObject({
      flowNodeId: 'screen-1',
      error: 'Unsupported image format: expected PNG',
    });
  });

  it('returns a comparison error for truncated PNG pixel data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fliwright-visual-diff-truncated-'));
    const runtime = join(dir, 'runtime.png');
    const figma = join(dir, 'figma.png');
    await writeFile(runtime, pngRaw(1, 1, Buffer.from([0, 255, 0, 0])));
    await writeFile(figma, pngRgba(1, 1, [[255, 0, 0, 255]]));

    const comparison = await compareFlowScreenshots({
      flowNodeId: 'screen-1',
      runtimeScreenshotPath: runtime,
      figmaScreenshotPath: figma,
    });

    expect(comparison).toMatchObject({
      flowNodeId: 'screen-1',
      error: 'Invalid PNG pixel data: expected 5 decompressed bytes, got 4',
    });
  });
});

type Rgba = [number, number, number, number];

function pngRgba(width: number, height: number, pixels: Rgba[]): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = pixels[y * width + x];
      raw[offset++] = pixel[0];
      raw[offset++] = pixel[1];
      raw[offset++] = pixel[2];
      raw[offset++] = pixel[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngRaw(width: number, height: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const output = Buffer.alloc(8 + data.length + 4);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, 'ascii');
  data.copy(output, 8);
  return output;
}
