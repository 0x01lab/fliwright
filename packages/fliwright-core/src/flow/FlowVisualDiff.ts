import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import type { FlowReviewArtifactInput, FlowReviewComparisonInput } from './FlowReviewReport.js';

export interface FlowVisualDiffOptions {
  pixelThreshold?: number;
}

export interface FlowVisualDiffInput extends FlowVisualDiffOptions {
  flowNodeId: string;
  runtimeScreenshotPath: string;
  figmaScreenshotPath: string;
}

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function compareFlowScreenshots(input: FlowVisualDiffInput): Promise<FlowReviewComparisonInput> {
  try {
    const [runtime, figma] = await Promise.all([
      decodePng(await readFile(input.runtimeScreenshotPath)),
      decodePng(await readFile(input.figmaScreenshotPath)),
    ]);
    const diff = compareDecodedPngs(runtime, figma, {
      pixelThreshold: input.pixelThreshold,
    });
    return {
      flowNodeId: input.flowNodeId,
      pixelDiff: diff.pixelDiff,
      layoutPx: diff.layoutPx,
      ...(diff.notes ? { notes: diff.notes } : {}),
    };
  } catch (error) {
    return {
      flowNodeId: input.flowNodeId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildFlowVisualComparisons(input: {
  runtimeCaptures?: FlowReviewArtifactInput[];
  figmaCaptures?: FlowReviewArtifactInput[];
  pixelThreshold?: number;
}): Promise<FlowReviewComparisonInput[]> {
  const figmaByNode = new Map((input.figmaCaptures ?? []).map((capture) => [capture.flowNodeId, capture]));
  const comparisons: FlowReviewComparisonInput[] = [];

  for (const runtime of input.runtimeCaptures ?? []) {
    const figma = figmaByNode.get(runtime.flowNodeId);
    if (!runtime.screenshotPath || !figma?.screenshotPath) continue;
    comparisons.push(await compareFlowScreenshots({
      flowNodeId: runtime.flowNodeId,
      runtimeScreenshotPath: runtime.screenshotPath,
      figmaScreenshotPath: figma.screenshotPath,
      pixelThreshold: input.pixelThreshold,
    }));
  }

  return comparisons;
}

export function compareDecodedPngs(
  actual: DecodedPng,
  expected: DecodedPng,
  options: FlowVisualDiffOptions = {},
): { pixelDiff: number; layoutPx: number; diffPixels: number; totalPixels: number; notes?: string } {
  const width = Math.max(actual.width, expected.width);
  const height = Math.max(actual.height, expected.height);
  const totalPixels = width * height;
  const threshold = options.pixelThreshold ?? 0;
  let diffPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const actualPixel = pixelAt(actual, x, y);
      const expectedPixel = pixelAt(expected, x, y);
      if (!actualPixel || !expectedPixel) {
        diffPixels++;
        continue;
      }
      const delta =
        Math.abs(actualPixel[0] - expectedPixel[0]) +
        Math.abs(actualPixel[1] - expectedPixel[1]) +
        Math.abs(actualPixel[2] - expectedPixel[2]) +
        Math.abs(actualPixel[3] - expectedPixel[3]);
      if (delta > threshold) diffPixels++;
    }
  }

  const layoutPx = Math.max(
    Math.abs(actual.width - expected.width),
    Math.abs(actual.height - expected.height),
  );
  return {
    pixelDiff: totalPixels === 0 ? 0 : roundRatio(diffPixels / totalPixels),
    layoutPx,
    diffPixels,
    totalPixels,
    ...(layoutPx > 0 ? { notes: `image size differs: runtime ${actual.width}x${actual.height}, figma ${expected.width}x${expected.height}` } : {}),
  };
}

function decodePng(buffer: Buffer): DecodedPng {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Unsupported image format: expected PNG');
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.toString('ascii', offset, offset + 4);
    offset += 4;
    const data = buffer.subarray(offset, offset + length);
    offset += length + 4; // skip data and CRC

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      continue;
    }
    if (type === 'IDAT') idatChunks.push(Buffer.from(data));
    if (type === 'IEND') break;
  }

  if (width <= 0 || height <= 0) throw new Error('Invalid PNG: missing IHDR');
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);

  const channels = channelsForColorType(colorType);
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const expectedInflatedBytes = height * (1 + rowBytes);
  if (inflated.length !== expectedInflatedBytes) {
    throw new Error(`Invalid PNG pixel data: expected ${expectedInflatedBytes} decompressed bytes, got ${inflated.length}`);
  }
  const unfiltered = unfilterPngRows(inflated, width, height, channels, rowBytes);
  return {
    width,
    height,
    rgba: toRgba(unfiltered, width, height, colorType, channels),
  };
}

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG color type: ${colorType}`);
  }
}

function unfilterPngRows(
  inflated: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
  rowBytes: number,
): Uint8Array {
  const output = new Uint8Array(width * height * bytesPerPixel);
  let inputOffset = 0;
  let outputOffset = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    for (let x = 0; x < rowBytes; x++) {
      const raw = inflated[inputOffset++];
      const left = x >= bytesPerPixel ? output[outputOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? output[outputOffset + x - rowBytes] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? output[outputOffset + x - rowBytes - bytesPerPixel] : 0;
      output[outputOffset + x] = applyPngFilter(filter, raw, left, up, upLeft);
    }
    outputOffset += rowBytes;
  }

  return output;
}

function applyPngFilter(filter: number, raw: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return (raw + left) & 0xff;
    case 2:
      return (raw + up) & 0xff;
    case 3:
      return (raw + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (raw + paeth(left, up, upLeft)) & 0xff;
    default:
      throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function toRgba(raw: Uint8Array, width: number, height: number, colorType: number, channels: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const source = index * channels;
    const target = index * 4;
    switch (colorType) {
      case 0:
        rgba[target] = raw[source];
        rgba[target + 1] = raw[source];
        rgba[target + 2] = raw[source];
        rgba[target + 3] = 255;
        break;
      case 2:
        rgba[target] = raw[source];
        rgba[target + 1] = raw[source + 1];
        rgba[target + 2] = raw[source + 2];
        rgba[target + 3] = 255;
        break;
      case 4:
        rgba[target] = raw[source];
        rgba[target + 1] = raw[source];
        rgba[target + 2] = raw[source];
        rgba[target + 3] = raw[source + 1];
        break;
      case 6:
        rgba[target] = raw[source];
        rgba[target + 1] = raw[source + 1];
        rgba[target + 2] = raw[source + 2];
        rgba[target + 3] = raw[source + 3];
        break;
    }
  }
  return rgba;
}

function pixelAt(image: DecodedPng, x: number, y: number): [number, number, number, number] | undefined {
  if (x >= image.width || y >= image.height) return undefined;
  const offset = (y * image.width + x) * 4;
  return [
    image.rgba[offset],
    image.rgba[offset + 1],
    image.rgba[offset + 2],
    image.rgba[offset + 3],
  ];
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
