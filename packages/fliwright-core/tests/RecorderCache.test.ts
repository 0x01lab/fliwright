import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecorderController } from '../src/RecorderController.js';
import { createRecordingProtocolFixture, frozenTarget } from './helpers/recordingProtocol.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'recording-cache-test-'));
  directories.push(directory);
  const protocol = createRecordingProtocolFixture();
  let sink: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void;
  const controller = new RecorderController(async (method, params) => protocol.response(method, params) ?? {},
    (callback) => { sink = callback; return () => {}; });
  return { controller, protocol, directory, emit: (data: Record<string, unknown>) => sink({ kind: 'FliwrightRecording', timestamp: 0, data }) };
}

describe('recorder event cache budget', () => {
  it('keeps raw aggregation bounded through 1000 actions and retains the full archive and generated code', async () => {
    const h = harness();
    await h.controller.start({ artifactDirectory: h.directory, eventCache: { maxBufferedEvents: 8, maxBufferedBytes: 4096 } });
    for (let index = 0; index < 1000; index++) {
      h.emit(h.protocol.pointer('down', 10, 20, index * 1000000, 0, { target: frozenTarget({ match: { key: 'increment' } }) }));
      h.emit(h.protocol.pointer('up', 10, 20, index * 1000000 + 1000));
    }
    const result = await h.controller.stop({ mode: 'script' });
    expect(result.status).toBe('captured');
    expect(result.operations).toHaveLength(1000);
    expect(result.code.match(/\.click\(\{ waitForAnimations: true \}\)/g)).toHaveLength(1000);
    expect(result.eventCache).toMatchObject({ eventCount: 2000, archivedEvents: 2000 });
    expect(result.eventCache?.peakBufferedEvents).toBeLessThanOrEqual(8);
    expect(result.eventCache?.peakBufferedBytes).toBeLessThanOrEqual(4096);
    expect(h.controller.getRawEventCount()).toBe(2000);
    expect(readFileSync(h.controller.getRawEventsPath()!, 'utf8').trim().split('\n')).toHaveLength(2000);
    expect(h.controller.getRawEvents()).toHaveLength(2000);
  });

  it('bounds out-of-order payloads, keeps their raw archive and reports partial on exhaustion', async () => {
    const h = harness();
    await h.controller.start({ artifactDirectory: h.directory, stopFlushTimeoutMs: 0,
      eventCache: { maxPendingEvents: 4, maxPendingBytes: 4096 } });
    const delayed = h.protocol.pointer('down', 10, 20, 0, 0);
    for (let index = 0; index < 12; index++) h.emit(h.protocol.pointer('up', 10, 20, index + 1));
    h.emit(delayed);
    const result = await h.controller.stop();
    expect(result.status).toBe('partial');
    expect(result.issues.join(' ')).toMatch(/out-of-order.*budget/i);
    expect(result.eventCache?.peakPendingEvents).toBeLessThanOrEqual(4);
    expect(result.eventCache?.peakPendingBytes).toBeLessThanOrEqual(4096);
    expect(h.controller.getRawEvents()).toHaveLength(13);
  });

  it('starts the next session with an independent archive and resets cache measurements', async () => {
    const h = harness();
    await h.controller.start();
    h.emit(h.protocol.text('first session', 1));
    await h.controller.stop();
    const firstPath = h.controller.getRawEventsPath();
    if (firstPath) directories.push(join(firstPath, '..'));
    await h.controller.start({ artifactDirectory: h.directory });
    h.emit(h.protocol.text('', 1));
    const result = await h.controller.stop();
    expect(h.controller.getRawEventsPath()).not.toBe(firstPath);
    expect(result.eventCache?.eventCount).toBe(1);
    expect(h.controller.getRawEvents()).toEqual([expect.objectContaining({ text: '' })]);
  });

  it('rejects invalid budgets before starting a session', async () => {
    const h = harness();
    await expect(h.controller.start({ eventCache: { maxBufferedEvents: 0 } })).rejects.toThrow(/positive safe integer/i);
    await expect(h.controller.start({ eventCache: { maxPendingBytes: Infinity } })).rejects.toThrow(/positive safe integer/i);
    await expect(h.controller.start({ maxPendingScreenshots: 0 })).rejects.toThrow(/positive safe integer/i);
    await expect(h.controller.start({ maxScreenshotBytes: 0 })).rejects.toThrow(/positive safe integer/i);
  });

  it('keeps recorded operations while marking the capture partial after archive writes fail', async () => {
    const h = harness();
    await h.controller.start({ artifactDirectory: h.directory });
    h.emit(h.protocol.pointer('down', 10, 20, 1));
    h.emit(h.protocol.pointer('up', 10, 20, 2));
    const path = h.controller.getRawEventsPath()!;
    rmSync(path); mkdirSync(path);
    h.emit(h.protocol.pointer('down', 10, 20, 1000000));
    h.emit(h.protocol.pointer('up', 10, 20, 1000001));
    const result = await h.controller.stop();
    expect(result.status).toBe('partial');
    expect(result.operations).toHaveLength(2);
    expect(result.eventCache).toMatchObject({ eventCount: 4, archivedEvents: 2 });
    expect(result.issues.join(' ')).toMatch(/event archive write failed/i);
    expect(JSON.stringify(result)).not.toContain(h.directory);
  });

  it('archives valid masks and rejects unmasked sensitive envelopes before disk writes', async () => {
    const h = harness();
    await h.controller.start({ artifactDirectory: h.directory, stopFlushTimeoutMs: 0 });
    h.emit(h.protocol.envelope({ kind: 'text', value: '<masked>',
      focusSessionId: 'password', sensitive: true }, 1));
    h.emit(h.protocol.envelope({ kind: 'text', value: 'secret-should-not-be-persisted',
      focusSessionId: 'password', sensitive: true }, 2));
    const result = await h.controller.stop();
    expect(result.operations[0]).toMatchObject({ text: '<masked>', sensitive: true });
    expect(result.status).toBe('partial');
    expect(result.operations).toHaveLength(1);
    const archived = readFileSync(h.controller.getRawEventsPath()!, 'utf8');
    expect(archived).not.toContain('secret-should-not-be-persisted');
    expect(JSON.parse(archived).text).toBe('<masked>');
  });

  it('bounds queued screenshot RPCs during a capture outage and reports affected frames as partial', async () => {
    const protocol = createRecordingProtocolFixture();
    let sink: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void;
    let requests = 0;
    const controller = new RecorderController(async (method, params) => {
      if (method === 'ext.fliwright.screenshot') { requests++; throw new Error('capture unavailable'); }
      return protocol.response(method, params) ?? {};
    }, (callback) => { sink = callback; return () => {}; });
    const directory = mkdtempSync(join(tmpdir(), 'recording-cache-test-'));
    directories.push(directory);
    await controller.start({ captureScreenshots: true, maxPendingScreenshots: 4, artifactDirectory: directory });
    for (let index = 0; index < 1000; index++) {
      for (const phase of ['down', 'up'] as const) {
        sink!({ kind: 'FliwrightRecording', timestamp: 0,
          data: protocol.pointer(phase, 10, 20, index * 1000000 + (phase === 'up' ? 1000 : 0)) });
      }
    }
    const result = await controller.stop();
    expect(result.operations).toHaveLength(1000);
    expect(result.frames).toHaveLength(1000);
    expect(result.status).toBe('partial');
    expect(result.issues.join(' ')).toMatch(/screenshot.*queue.*budget/i);
    expect(result.screenshotQueue).toMatchObject({ pendingTasks: 0, maxPendingTasks: 4 });
    expect(result.screenshotQueue?.peakPendingTasks).toBeLessThanOrEqual(4);
    expect(requests).toBeLessThanOrEqual(5); // initial sample plus admitted frame requests
    expect(result.frames.every((frame) => frame.status === 'error')).toBe(true);
  });
});
