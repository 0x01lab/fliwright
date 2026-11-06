// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerDiagnosticsPanel } from '../src/web/WorkerDiagnostics.js';
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllGlobals(); });
it('exposes service health and searchable errors independently of test reports', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    calls.push(path);
    return { ok: true, json: async () => ({ sessions: [{ sessionId: 'session', status: 'degraded', pid: 123, nodeVersion: 'v26', startedAt: new Date().toISOString(), receivedAt: Date.now(), uptimeMs: 1000, rssBytes: 1048576, eventLoopLagMs: 20, components: { catalog: 'failed' } }], logs: [{ id: 1, at: new Date().toISOString(), sessionId: 'session', level: 'error', event: 'executor.failed', message: 'Bridge protocol incompatible', stack: 'safe stack', slotId: 'ios' }], nextCursor: 1 }) };
  }));
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  cleanup.push(() => node.remove()); cleanup.push(() => act(async () => root.unmount()));
  await act(async () => root.render(React.createElement(WorkerDiagnosticsPanel, { workerId: "mac" })));
  const button = [...node.querySelectorAll('button')].find(button => button.textContent?.includes('服务诊断'))!;
  await act(async () => button.click());
  expect(node.textContent).toContain('部分组件异常');
  expect(node.textContent).toContain('executor.failed'); expect(node.textContent).toContain('Bridge protocol incompatible');
  expect(node.textContent).toContain('catalog'); expect(node.textContent).toContain('safe stack');
  expect(calls).toContain('/api/workers/mac/diagnostics');
  const search = node.querySelector<HTMLInputElement>('input[aria-label="搜索服务日志"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Bridge');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(calls).toContain('/api/workers/mac/diagnostics?search=Bridge');
});
