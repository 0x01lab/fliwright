import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TraceCollector } from '../src/TraceCollector.js';

describe('TraceCollector run layout', () => {
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
