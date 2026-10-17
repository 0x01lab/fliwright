import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { RecorderController } from '../src/RecorderController.js';
import { createRecordingProtocolFixture, frozenTarget } from './helpers/recordingProtocol.js';

const directories: string[] = [];
function directory() { const dir = mkdtempSync(join(tmpdir(), 'recording-artifacts-')); directories.push(dir); return dir; }
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
/** Deterministic, distinct, decodable PNGs; level zero avoids a tiny repeated-image fixture. */
function png(index: number): Buffer {
  const pixels = Buffer.alloc(1025 * 128, index);
  for (let row = 0; row < 128; row++) pixels[row * 1025] = 0;
  pixels.writeUInt32LE(index, 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
afterEach(() => { vi.useRealTimers(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('recording binary artifacts', () => {
  it('samples a rendered screenshot while the app continues animating', async () => {
    const protocol = createRecordingProtocolFixture();
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'ext.fliwright.settle') return new Promise(() => {});
      if (method === 'ext.fliwright.screenshot') return { screenshot: png(1).toString('base64') };
      return protocol.response(method, params) ?? {};
    });
    const controller = new RecorderController(send, () => () => {});
    await controller.start({ artifactDirectory: directory(), captureScreenshots: true, requestTimeoutMs: 20 });
    const result = await controller.stop();
    expect(result.status).toBe('captured');
    expect(result.binaryCache?.writtenScreenshots).toBe(1);
    expect(send).not.toHaveBeenCalledWith('ext.fliwright.settle', expect.anything());
  });
  it('archives unique screenshots without retaining their payloads and can relocate all evidence', async () => {
    const root = directory();
    const protocol = createRecordingProtocolFixture();
    let receive!: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void;
    let images = 0;
    const controller = new RecorderController(async (method, params) => {
      if (method === 'ext.fliwright.screenshot') {
        const data = png(++images);
        return { screenshot: data.toString('base64'), width: 320, height: 640 };
      }
      return protocol.response(method, params) ?? {};
    }, (callback) => { receive = callback; return () => {}; });
    vi.useFakeTimers();
    try {
      await controller.start({ captureScreenshots: true, artifactDirectory: root, screenshotSampleIntervalMs: 100 });
      for (let index = 0; index < 1000; index++) {
        await vi.advanceTimersByTimeAsync(100);
        for (const phase of ['down', 'up'] as const) receive({ kind: 'FliwrightRecording', timestamp: 0,
          data: protocol.pointer(phase, 10, 20, index * 1000000 + (phase === 'up' ? 1000 : 0), 0,
            phase === 'down' ? { target: frozenTarget({ match: { key: 'increment' } }) } : {}) });
      }
      const result = await controller.stop({ mode: 'script' });
      expect(result.status).toBe('captured');
      expect(result.operations).toHaveLength(1000);
      expect(result.code.match(/\.click\(\{ waitForAnimations: true \}\)/g)).toHaveLength(1000);
      expect(new Set(result.frames.map((frame) => frame.screenshot?.path)).size).toBe(1000);
      expect(JSON.stringify(result)).not.toContain('base64');
      expect(result.binaryCache).toMatchObject({ retainedBytes: 0, maxScreenshotBytes: 8 * 1024 * 1024 });
      expect(result.binaryCache!.peakScreenshotBytes).toBe(png(1).length);
      const { copyRecordingArtifacts, resolveRecordingArtifact } = await import('../src/RecordingArtifacts.js');
      const source = controller.getArtifactDirectory()!;
      const destination = directory();
      await copyRecordingArtifacts(result, source, destination);
      rmSync(source, { recursive: true });
      expect(readFileSync(join(destination, result.rawEventsFile!), 'utf8').trim().split('\n')).toHaveLength(2000);
      const values = new Set<number>();
      for (const frame of result.frames) {
        const data = readFileSync(resolveRecordingArtifact(destination, frame.screenshot!.path));
        expect(data).toHaveLength(png(1).length);
        expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        const pixels = inflateSync(data.subarray(41, 41 + data.readUInt32BE(33)));
        expect(pixels).toHaveLength(1025 * 128);
        values.add(pixels.readUInt32LE(1));
      }
      expect(values.size).toBe(1000);
    } finally { vi.useRealTimers(); }
  }, 30000);

  it.each(['budget', 'disk'] as const)('reports %s failure without losing operations or claiming complete evidence', async (failure) => {
    const root = directory();
    const protocol = createRecordingProtocolFixture();
    let receive!: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void;
    const controller = new RecorderController(async (method, params) => {
      if (method === 'ext.fliwright.screenshot') return { screenshot: Buffer.alloc(100).toString('base64') };
      if (method === 'ext.fliwright.startRecording' && failure === 'disk') {
        mkdirSync(join(root, String(params?.sessionId)), { recursive: true });
        writeFileSync(join(root, String(params?.sessionId), 'screenshots'), 'blocked');
      }
      return protocol.response(method, params) ?? {};
    }, (callback) => { receive = callback; return () => {}; });
    await controller.start({ captureScreenshots: true, artifactDirectory: root, maxScreenshotBytes: failure === 'budget' ? 64 : 1024 });
    for (const phase of ['down', 'up'] as const) receive({ kind: 'FliwrightRecording', timestamp: 0,
      data: protocol.pointer(phase, 10, 20, phase === 'up' ? 1000 : 0) });
    const result = await controller.stop();
    expect(result.operations).toHaveLength(1);
    expect(result.status).toBe('partial');
    expect(result.frames[0]).toMatchObject({ status: 'error' });
    expect(result.frames[0].screenshot).toBeUndefined();
    expect(result.issues.join(' ')).toMatch(failure === 'budget' ? /screenshot.*budget/i : /screenshot.*write/i);
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('never writes a timed-out response into a restarted recording', async () => {
    vi.useFakeTimers();
    const root = directory();
    const protocol = createRecordingProtocolFixture();
    let resolveLate!: (value: unknown) => void;
    let requests = 0;
    const controller = new RecorderController(async (method, params) => {
      if (method === 'ext.fliwright.screenshot') {
        if (++requests === 1) return new Promise((resolve) => { resolveLate = resolve; });
        return { screenshot: Buffer.from('current').toString('base64') };
      }
      return protocol.response(method, params) ?? {};
    }, () => () => {});
    const starting = controller.start({ artifactDirectory: root, captureScreenshots: true, requestTimeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(21);
    await starting;
    expect((await controller.stop()).status).toBe('partial');
    await controller.start({ artifactDirectory: root, captureScreenshots: true });
    resolveLate({ screenshot: Buffer.from('obsolete').toString('base64') });
    await vi.advanceTimersByTimeAsync(0);
    const result = await controller.stop();
    expect(result.status).toBe('captured');
    expect(result.binaryCache?.writtenScreenshots).toBe(1);
  });

  it('keeps a timed-out capture partial after later samples succeed and discards its late binary', async () => {
    vi.useFakeTimers();
    const protocol = createRecordingProtocolFixture();
    let resolveLate!: (value: unknown) => void;
    let requests = 0;
    const controller = new RecorderController(async (method, params) => {
      if (method === 'ext.fliwright.screenshot') {
        if (++requests === 1) return new Promise((resolve) => { resolveLate = resolve; });
        return { screenshot: Buffer.from('current').toString('base64') };
      }
      return protocol.response(method, params) ?? {};
    }, () => () => {});
    const starting = controller.start({ artifactDirectory: directory(), captureScreenshots: true,
      requestTimeoutMs: 20, screenshotSampleIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(21);
    await starting;
    resolveLate({ screenshot: Buffer.from('obsolete').toString('base64') });
    await vi.advanceTimersByTimeAsync(101);
    const result = await controller.stop();
    expect(result.status).toBe('partial');
    expect(result.issues.join(' ')).toMatch(/screenshot.*timed out/i);
    expect(result.binaryCache?.writtenScreenshots).toBe(1);
  });

  it('rejects traversal, absolute and symlink artifact references', async () => {
    const { resolveRecordingArtifact } = await import('../src/RecordingArtifacts.js');
    const root = directory();
    const outside = directory();
    writeFileSync(join(outside, 'image.png'), 'outside');
    symlinkSync(outside, join(root, 'escape'));
    for (const path of ['../image.png', '/tmp/image.png', 'C:\\image.png', 'escape/image.png']) {
      expect(() => resolveRecordingArtifact(root, path)).toThrow(/artifact/i);
    }
  });

  it('rejects missing evidence and destination symlink escapes without overwriting outside files', async () => {
    const { copyRecordingArtifacts } = await import('../src/RecordingArtifacts.js');
    const source = directory();
    const destination = directory();
    const outside = directory();
    mkdirSync(join(source, 'screenshots'));
    writeFileSync(join(source, 'screenshots/frame.png'), 'png');
    writeFileSync(join(outside, 'frame.png'), 'untouched');
    symlinkSync(outside, join(destination, 'screenshots'));
    const frame = { id: 'frame', index: 0, kind: 'tap' as const, status: 'ready' as const,
      timestamp: 1, position: { x: 1, y: 2 },
      screenshot: { path: 'screenshots/frame.png', byteLength: 3, format: 'png' as const } };
    await expect(copyRecordingArtifacts({ frames: [frame] }, source, destination)).rejects.toThrow(/artifact.*escapes/i);
    expect(readFileSync(join(outside, 'frame.png'), 'utf8')).toBe('untouched');
    await expect(copyRecordingArtifacts({ frames: [frame], rawEventsFile: 'missing.jsonl' }, source, directory())).rejects.toThrow();
  });
});
