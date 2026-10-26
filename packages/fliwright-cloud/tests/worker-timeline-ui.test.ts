// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkerExecutionTimeline } from '../src/web/WorkerExecutionTimeline.js';
import type { ExecutionAttempt, WorkerTimelineView } from '@fliwright/cloud-protocol';

let root: Root, container: HTMLDivElement;
const streams: Array<{ onmessage?: (event: { data: string }) => void; onopen?: () => void; close: ReturnType<typeof vi.fn> }> = [];
const attempts = [1, 2].map(number => ({ attemptId: `attempt-${number}`, number })) as ExecutionAttempt[];
let view: WorkerTimelineView;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  view = { schemaVersion: 1, requestId: 'request', executionAttemptId: 'attempt-2', workerId: 'mac', slotId: 'ios', deviceId: 'phone',
    executionStatus: 'running', testVerdict: 'failed', quality: 'recording', issues: [], revision: 1, cursor: 2,
    originAt: '2026-10-21T00:00:00.000Z', observedOffsetMs: 500,
    spans: [{ id: 'run', phase: 'tests.run', status: 'succeeded', testVerdict: 'failed', runId: 'run', startMs: 0, endMs: 100, durationMs: 100, startSeq: 1, endSeq: 2, startedAt: '2026-10-21T00:00:00.000Z' }], milestones: [] };
  streams.length = 0;
  vi.stubGlobal('EventSource', class { close = vi.fn(); constructor() { streams.push(this); } });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path.endsWith('/logs') ? { logs: [] } : { ...view, executionAttemptId: path.split('/')[5] } })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(props: Partial<React.ComponentProps<typeof WorkerExecutionTimeline>> = {}) {
  await act(async () => { root.render(React.createElement(WorkerExecutionTimeline, { requestId: 'request', attempts, ...props })); });
}
it('separates execution, verdict and recording status and preserves a manually chosen attempt', async () => {
  await render();
  expect(container.textContent).toContain('测试失败');
  expect(container.textContent).toContain('Worker 执行中');
  expect(container.textContent).toContain('记录中');
  const select = container.querySelector('select')!;
  await act(async () => { select.value = 'attempt-1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await render({ attempts: [...attempts, { attemptId: 'attempt-3', number: 3 } as ExecutionAttempt] });
  expect(container.querySelector('select')!.value).toBe('attempt-1');
  expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toContain('attempt-1');
});
it('binds reports to their original execution and shows unknown ends without invented durations', async () => {
  view = { ...view, executionStatus: 'lost', quality: 'partial', issues: ['open_spans'],
    spans: [{ id: 'launch', phase: 'app.launch', status: 'unknown', startMs: 20, startSeq: 1, startedAt: view.originAt! }] };
  await render({ executionAttemptId: 'attempt-1' });
  expect(container.querySelector('select')).toBeNull();
  expect(container.textContent).toContain('结束时间未知');
  expect(container.textContent).toContain('记录不完整');
  expect(container.textContent).not.toContain('100 ms');
  expect(vi.mocked(fetch).mock.calls[0][0]).toContain('attempt-1');
  expect(streams[0].close).toHaveBeenCalled();
});
it('refreshes published execution cleanup through SSE and stops polling on completion', async () => {
  vi.useFakeTimers();
  await render();
  view = { ...view, executionStatus: 'finished', quality: 'complete', spans: [...view.spans,
    { id: 'reset', phase: 'device.reset.after', status: 'succeeded', startMs: 100, endMs: 500, durationMs: 400, startSeq: 3, endSeq: 4, startedAt: view.originAt! }] };
  await act(async () => { streams[0].onmessage?.({ data: JSON.stringify({ kind: 'worker-timeline-updated', data: { executionAttemptId: 'attempt-2' } }) }); });
  expect(container.textContent).toContain('清理测试设备');
  const count = vi.mocked(fetch).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(vi.mocked(fetch).mock.calls).toHaveLength(count);
  expect(streams[0].close).toHaveBeenCalled();
});
it('explains expired and unrecorded histories without reconstructing test events', async () => {
  view = { ...view, expiredAt: 42, executionStatus: 'finished', spans: [] };
  await render();
  expect(container.textContent).toContain('明细已过期');
  view = { ...view, expiredAt: undefined, quality: 'not_recorded' };
  await render({ executionAttemptId: 'attempt-1' });
  expect(container.textContent).toContain('此执行没有 Worker 时间轴记录');
});
