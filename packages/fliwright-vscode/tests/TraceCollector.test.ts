import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { TraceCollector, TraceStore, isActionMethod } from '@fliwright/core';

describe('TraceCollector', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fliwright-trace-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates trace directory and initial trace.json', async () => {
    const sendRequest = vi.fn().mockResolvedValue({});
    const collector = await TraceCollector.create(tmpDir, 'my-test', 'run-1', sendRequest, 'on-failure');

    const stat = await fs.stat(collector.traceDir);
    expect(stat.isDirectory()).toBe(true);

    const data = JSON.parse(await fs.readFile(path.join(collector.traceDir, 'trace.json'), 'utf8'));
    expect(data.meta.testName).toBe('my-test');
    expect(data.meta.runId).toBe('run-1');
    expect(data.meta.status).toBe('running');
    expect(data.steps).toEqual([]);
  });

  it('records action steps with metadata', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const collector = await TraceCollector.create(tmpDir, 'test', 'run-1', sendRequest, 'on-failure');

    await collector.onAction('ext.fliwright.action', {
      action: 'tap',
      text: 'Submit',
    }, 120, { success: true });

    const data = JSON.parse(await fs.readFile(path.join(collector.traceDir, 'trace.json'), 'utf8'));
    expect(data.steps).toHaveLength(1);
    expect(data.steps[0].action).toBe('tap');
    expect(data.steps[0].selector).toBe('text=Submit');
    expect(data.steps[0].status).toBe('pass');
    expect(data.steps[0].durationMs).toBe(120);
  });

  it('captures screenshot on failure when mode is on-failure', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.screenshot') {
        return { success: true, screenshot: Buffer.from('fake-png').toString('base64') };
      }
      if (method === 'ext.fliwright.snapshot') {
        return { type: 'RootWidget' };
      }
      return { success: true };
    });
    const collector = await TraceCollector.create(tmpDir, 'test', 'run-1', sendRequest, 'on-failure');

    await collector.onAction('ext.fliwright.action', {
      action: 'tap',
      text: 'Submit',
    }, 5000, undefined, new Error('element not found'));

    const data = JSON.parse(await fs.readFile(path.join(collector.traceDir, 'trace.json'), 'utf8'));
    expect(data.steps[0].status).toBe('fail');
    expect(data.steps[0].error).toBe('element not found');
    expect(data.steps[0].screenshotFile).toBe('step-0.png');
    expect(data.steps[0].widgetTree).toBeDefined();

    // Verify PNG was written
    const pngStat = await fs.stat(path.join(collector.traceDir, 'step-0.png'));
    expect(pngStat.size).toBeGreaterThan(0);
  });

  it('does not capture screenshot on pass when mode is on-failure', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const collector = await TraceCollector.create(tmpDir, 'test', 'run-1', sendRequest, 'on-failure');

    await collector.onAction('ext.fliwright.action', {
      action: 'tap',
      text: 'OK',
    }, 100, { success: true });

    const data = JSON.parse(await fs.readFile(path.join(collector.traceDir, 'trace.json'), 'utf8'));
    expect(data.steps[0].screenshotFile).toBeUndefined();
    expect(sendRequest).not.toHaveBeenCalledWith('ext.fliwright.screenshot', expect.anything());
  });

  it('captures screenshot on every action when mode is full', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.screenshot') {
        return { success: true, screenshot: Buffer.from('png').toString('base64') };
      }
      return { success: true };
    });
    const collector = await TraceCollector.create(tmpDir, 'test', 'run-1', sendRequest, 'full');

    await collector.onAction('ext.fliwright.action', { action: 'tap', text: 'A' }, 50, {});
    await collector.onAction('ext.fliwright.action', { action: 'fill', text: 'B' }, 80, {});

    const data = JSON.parse(await fs.readFile(path.join(collector.traceDir, 'trace.json'), 'utf8'));
    expect(data.steps).toHaveLength(2);
    expect(data.steps[0].screenshotFile).toBe('step-0.png');
    expect(data.steps[1].screenshotFile).toBe('step-1.png');
  });

  it('completes trace with final status', async () => {
    const sendRequest = vi.fn().mockResolvedValue({});
    const collector = await TraceCollector.create(tmpDir, 'test', 'run-1', sendRequest, 'on-failure');

    await collector.onAction('ext.fliwright.action', { action: 'tap', text: 'X' }, 100, {});
    await collector.complete('passed');

    const data = JSON.parse(await fs.readFile(path.join(collector.traceDir, 'trace.json'), 'utf8'));
    expect(data.meta.status).toBe('passed');
    expect(data.meta.completedAt).toBeDefined();
    expect(data.meta.totalSteps).toBe(1);
  });
});

describe('isActionMethod', () => {
  it('identifies action methods', () => {
    expect(isActionMethod('ext.fliwright.action')).toBe(true);
    expect(isActionMethod('ext.fliwright.navigate')).toBe(true);
    expect(isActionMethod('ext.fliwright.goBack')).toBe(true);
    expect(isActionMethod('ext.fliwright.click')).toBe(true);
    expect(isActionMethod('ext.fliwright.dragFrom')).toBe(true);
  });

  it('rejects non-action methods', () => {
    expect(isActionMethod('ext.fliwright.screenshot')).toBe(false);
    expect(isActionMethod('ext.fliwright.snapshot')).toBe(false);
    expect(isActionMethod('ext.fliwright.resolve')).toBe(false);
    expect(isActionMethod('ext.flutter.driver.screenshot')).toBe(false);
  });
});

describe('TraceStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fliwright-store-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('lists runs sorted newest first', async () => {
    await fs.mkdir(path.join(tmpDir, 'run-a'));
    await fs.mkdir(path.join(tmpDir, 'run-b'));
    await fs.mkdir(path.join(tmpDir, 'run-c'));

    const runs = await TraceStore.listRuns(tmpDir);
    expect(runs).toEqual(['run-c', 'run-b', 'run-a']);
  });

  it('generates valid run IDs', () => {
    const id = TraceStore.generateRunId();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it('cleans up old runs keeping N most recent', async () => {
    for (let i = 0; i < 5; i++) {
      await fs.mkdir(path.join(tmpDir, `run-${i}`));
    }

    const deleted = await TraceStore.cleanupOldRuns(tmpDir, 2);
    expect(deleted).toBe(3);

    const remaining = await TraceStore.listRuns(tmpDir);
    expect(remaining).toHaveLength(2);
    // Should keep the last 2 alphabetically (run-3, run-4)
    expect(remaining).toContain('run-3');
    expect(remaining).toContain('run-4');
  });
});
