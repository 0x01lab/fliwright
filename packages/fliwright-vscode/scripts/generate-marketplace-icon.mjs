import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const size = 256;
const supersample = 4;
const root = fileURLToPath(new URL('..', import.meta.url));
const palettes = [
  { file: 'fliwright-marketplace.png', background: [20, 31, 59], glyph: [126, 155, 238] },
  { file: 'fliwright-marketplace-forest.png', background: [13, 48, 43], glyph: [89, 219, 185] },
  { file: 'fliwright-marketplace-sunset.png', background: [65, 29, 43], glyph: [247, 147, 168] },
  { file: 'fliwright-marketplace-gold.png', background: [57, 43, 18], glyph: [248, 202, 108] },
];

let data;

function setPixel(x, y, rgba) {
  const i = (y * size + x) * 3;
  data[i] = rgba[0];
  data[i + 1] = rgba[1];
  data[i + 2] = rgba[2];
}

// This is the activity-bar F, scaled into a Marketplace-sized canvas.
const isGlyph = (x, y) => (
  (x >= 58 && x <= 102 && y >= 46 && y <= 210)
  || (x >= 58 && x <= 196 && y >= 46 && y <= 88)
  || (x >= 58 && x <= 174 && y >= 110 && y <= 152)
);
// The square is part of the mark, not a separate status indicator: it extends
// the activity-bar glyph into a connected, pixel-like monogram.
const isGlyphBlock = (x, y) => x >= 142 && x <= 194 && y >= 152 && y <= 204;

function sample(x, y, palette) {
  if (isGlyph(x, y) || isGlyphBlock(x, y)) return palette.glyph;
  return palette.background;
}

function render(palette) {
  data = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0];
      for (let subY = 0; subY < supersample; subY += 1) {
        for (let subX = 0; subX < supersample; subX += 1) {
          const rgba = sample(x + (subX + 0.5) / supersample, y + (subY + 0.5) / supersample, palette);
          for (let channel = 0; channel < 3; channel += 1) sum[channel] += rgba[channel];
        }
      }
      const divisor = supersample * supersample;
      setPixel(x, y, sum.map((channel) => Math.round(channel / divisor)));
    }
  }
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, payload])));
  return Buffer.concat([len, typeBuf, payload, crc]);
}

const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 2;

for (const palette of palettes) {
  render(palette);
  const scanlines = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    scanlines[row] = 0;
    data.copy(scanlines, row + 1, y * size * 3, (y + 1) * size * 3);
  }
  writeFileSync(join(root, 'media', palette.file), Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
