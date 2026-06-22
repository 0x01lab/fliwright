import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const size = 256;
const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'media', 'fliwright-marketplace.png');

const data = Buffer.alloc(size * size * 4);

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function setPixel(x, y, rgba) {
  const i = (y * size + x) * 4;
  data[i] = rgba[0];
  data[i + 1] = rgba[1];
  data[i + 2] = rgba[2];
  data[i + 3] = rgba[3];
}

function roundedRect(x, y, w, h, r) {
  return (px, py) => {
    const dx = Math.max(x - px, 0, px - (x + w));
    const dy = Math.max(y - py, 0, py - (y + h));
    if (dx || dy) return dx * dx + dy * dy <= r * r;
    const nearLeft = px < x + r;
    const nearRight = px > x + w - r;
    const nearTop = py < y + r;
    const nearBottom = py > y + h - r;
    if (!(nearLeft || nearRight) || !(nearTop || nearBottom)) return true;
    const cx = nearLeft ? x + r : x + w - r;
    const cy = nearTop ? y + r : y + h - r;
    return (px - cx) ** 2 + (py - cy) ** 2 <= r ** 2;
  };
}

const appShape = roundedRect(16, 16, 224, 224, 42);
const fStem = roundedRect(70, 58, 44, 140, 10);
const fTop = roundedRect(70, 58, 124, 38, 10);
const fMid = roundedRect(70, 112, 104, 36, 10);
const checkA = (x, y) => y > 163 + (x - 145) * 0.72 && y < 179 + (x - 145) * 0.72 && x >= 130 && x <= 162;
const checkB = (x, y) => y > 204 - (x - 162) * 0.9 && y < 220 - (x - 162) * 0.9 && x >= 158 && x <= 206;

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    if (!appShape(x, y)) {
      setPixel(x, y, [0, 0, 0, 0]);
      continue;
    }

    const t = (x + y) / (size * 2);
    const bg = [
      mix(12, 11, t),
      mix(32, 72, t),
      mix(49, 70, t),
      255,
    ];
    setPixel(x, y, bg);

    const isF = fStem(x, y) || fTop(x, y) || fMid(x, y);
    if (isF) {
      setPixel(x, y, [248, 252, 255, 255]);
    }

    if (checkA(x, y) || checkB(x, y)) {
      setPixel(x, y, [44, 221, 172, 255]);
    }

    const glow = Math.hypot(x - 188, y - 188);
    if (glow < 28) {
      const i = (y * size + x) * 4;
      data[i] = Math.max(data[i], 44);
      data[i + 1] = Math.max(data[i + 1], 221);
      data[i + 2] = Math.max(data[i + 2], 172);
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
ihdr[9] = 6;

const scanlines = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  const row = y * (size * 4 + 1);
  scanlines[row] = 0;
  data.copy(scanlines, row + 1, y * size * 4, (y + 1) * size * 4);
}

writeFileSync(out, Buffer.concat([
  header,
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(scanlines)),
  chunk('IEND', Buffer.alloc(0)),
]));
