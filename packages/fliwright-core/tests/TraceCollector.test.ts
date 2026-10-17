import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TraceCollector } from '../src/TraceCollector.js';

describe('TraceCollector run layout', () => {
  it.each(['failed', 'skipped', 'interrupted'] as const)('persists the runner final %s status with no failed actions', async (status) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fliwright-trace-outcome-'));
    try {
      const collector = await TraceCollector.create(tmpDir, 'no actions', 'run', vi.fn(), 'off', { layout: 'run' });
      await collector.complete(status);
      const data = JSON.parse(await fs.readFile(path.join(tmpDir, 'trace/trace.json'), 'utf8'));
      expect(data.meta.status).toBe(status);
      expect(data.meta.completedAt).toEqual(expect.any(String));
      expect(data.steps).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps a caught action failure while using the runner passing test outcome', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fliwright-trace-caught-'));
    try {
      const collector = await TraceCollector.create(tmpDir, 'caught error', 'run', vi.fn(), 'off', { layout: 'run' });
      await collector.onAction('ext.fliwright.action', { action: 'tap', key: 'save' }, 10, {}, new Error('caught'));
      await collector.complete('passed');
      const data = JSON.parse(await fs.readFile(path.join(tmpDir, 'trace/trace.json'), 'utf8'));
      expect(data.meta.status).toBe('passed');
      expect(data.steps[0]).toMatchObject({ status: 'fail', error: 'caught' });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('marks a bridge success:false result as a failed action without requiring a transport exception', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fliwright-trace-bridge-'));
    try {
      const collector = await TraceCollector.create(tmpDir, 'bridge failure', 'run', vi.fn(), 'off', { layout: 'run' });
      await collector.onAction('ext.fliwright.action', { action: 'tap', key: 'save' }, 10,
        { success: false, error: 'Disabled target' });
      await collector.complete('failed');
      const data = JSON.parse(await fs.readFile(path.join(tmpDir, 'trace/trace.json'), 'utf8'));
      expect(data.steps[0]).toMatchObject({ status: 'fail', error: 'Disabled target' });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps sensitive replay text out of trace selectors, arguments and errors', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fliwright-sensitive-trace-'));
    try {
      const collector = await TraceCollector.create(tmpDir, 'sensitive', 'run-sensitive', vi.fn(), 'off', { layout: 'run' });
      const selector = JSON.stringify({ match: { key: 'password' } });
      await collector.onAction('ext.fliwright.action', {
        action: 'fill', selector, text: 'supplied-at-replay', sensitive: 'true',
      }, 10, {}, new Error('Unable to fill supplied-at-replay'), 'operation-1');
      await collector.complete('failed');
      const text = await fs.readFile(path.join(tmpDir, 'trace', 'trace.json'), 'utf8');
      expect(text).not.toContain('supplied-at-replay');
      expect(JSON.parse(text).steps[0]).toMatchObject({ selector, argument: '<masked>', error: 'Unable to fill <masked>' });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes trace data inside a run artifact directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fliwright-trace-run-'));
    try {
      const sendRequest = vi.fn().mockResolvedValue({});
      const collector = await TraceCollector.create(tmpDir, 'my-test', 'run-1', sendRequest, 'on-failure', {
        layout: 'run',
      });

      expect(collector.traceDir).toBe(path.join(tmpDir, 'trace'));

      await collector.onAction('ext.fliwright.action', { action: 'tap', text: 'Submit' }, 20, {});
      await collector.complete('passed');

      const data = JSON.parse(await fs.readFile(path.join(tmpDir, 'trace', 'trace.json'), 'utf8'));
      expect(data.meta.runId).toBe('run-1');
      expect(data.steps[0].selector).toBe('text=Submit');
      expect(collector.artifactRef(tmpDir)).toMatchObject({
        kind: 'trace',
        path: 'trace/trace.json',
        mimeType: 'application/json',
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
