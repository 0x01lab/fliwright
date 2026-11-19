// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { SerializableRun } from '../../src/webview/viewer/types.js';
vi.mock('../../src/webview/viewer/host.js', () => ({ vscode: { getState: () => null, setState: vi.fn(), postMessage: vi.fn() } }));
vi.mock('../../src/webview/components/ui/resizable.js', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  ResizableHandle: () => null,
}));
import { ViewerApp } from '../../src/webview/viewer/app.js';

const stamp = (ms: number) => new Date(Date.UTC(2026, 10, 19) + ms).toISOString();
const run: SerializableRun = {
  runId: 'one', screenshotBaseUrl: 'https://evidence.local', traceBaseUrl: 'https://evidence.local/trace', logs: [],
  timeline: { version: 2, runId: 'one', testName: 'Checkout', mode: 'test', status: 'failed', startedAt: stamp(0), endedAt: stamp(4000), nodes: [
    { id: 'group', kind: 'step', title: 'Checkout group', status: 'passed', startedAt: stamp(0), endedAt: stamp(4000) },
    { id: 'tap', parentId: 'group', kind: 'action', title: 'Tap submit', status: 'passed', startedAt: stamp(0), endedAt: stamp(1000),
      metadata: { operationId: 'op-tap' }, artifacts: [{ kind: 'screenshot', path: 'tap.png' }] },
    { id: 'fail', parentId: 'group', kind: 'assertion', title: 'Success visible', status: 'failed', startedAt: stamp(1000), endedAt: stamp(4000),
      artifacts: [{ kind: 'screenshot', path: 'fail.png' }, { kind: 'screenshot', path: 'fail-2.png' }] },
  ] },
  trace: { meta: { runId: 'one', testName: 'Checkout', startedAt: stamp(0), status: 'failed', totalSteps: 2, traceVersion: 1 }, steps: [
    { index: 0, action: 'tap', selector: 'submit', operationId: 'op-tap', timestamp: stamp(3999), durationMs: 999, status: 'pass' },
    { index: 1, action: 'legacy', selector: '', timestamp: stamp(2000), durationMs: 200, status: 'pass' },
  ] },
};
let dispose = () => {};
afterEach(() => { dispose(); vi.restoreAllMocks(); });
async function mount() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  dispose = () => { act(() => root.unmount()); container.remove(); };
  await act(async () => root.render(React.createElement(ViewerApp)));
  await act(async () => window.dispatchEvent(new MessageEvent('message', { data: { type: 'run', run } })));
  return container;
}

it('links exact screenshots, reveals filtered children and isolates a replacement run', async () => {
  const container = await mount();
  expect(container.querySelectorAll('[data-ui~=trace-frame]')).toHaveLength(2);
  await act(async () => (container.querySelectorAll('[data-ui~=trace-frame]')[1] as HTMLElement).click());
  expect(container.querySelector('img[alt="screenshot"]')?.getAttribute('src')).toBe('https://evidence.local/fail-2.png');
  const filter = container.querySelector('input[type=search]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(filter, 'no match'); filter.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => (container.querySelector('[data-ui~=trace-action][data-step-id=tap]') as HTMLElement).click());
  expect(filter.value).toBe('');
  expect(container.querySelector('img[alt="screenshot"]')?.getAttribute('src')).toBe('https://evidence.local/tap.png');
  const replacement = { ...run, runId: 'two', timeline: { ...run.timeline, runId: 'two' } };
  await act(async () => window.dispatchEvent(new MessageEvent('message', { data: { type: 'run', run: replacement } })));
  expect(container.querySelector('img[alt="screenshot"]')?.getAttribute('src')).toBe('https://evidence.local/fail.png');
});

it('maps Actions by operation identity and leaves unmapped legacy timestamps unpositioned', async () => {
  const container = await mount();
  const actions = [...container.querySelectorAll('button')].find(el => el.textContent === 'Actions')!;
  await act(async () => actions.click());
  const row = [...container.querySelectorAll('[data-action-key]')].find(el => el.getAttribute('data-action-key') === 'trace:0') as HTMLElement;
  await act(async () => row.click());
  expect(container.querySelector('[data-ui~=trace-action][data-step-id=tap]')?.getAttribute('aria-pressed')).toBe('true');
  await act(async () => (container.querySelector('[data-action-key="trace:1"]') as HTMLElement).click());
  expect(container.textContent).toContain('此动作缺少可关联的时间记录');
  expect(container.querySelectorAll('[data-ui~=trace-action][aria-pressed=true]')).toHaveLength(0);
  await act(async () => (container.querySelector('[data-ui~=trace-action][data-step-id=tap]') as HTMLElement).click());
  expect(container.querySelector('[data-action-key="trace:0"]')).not.toBeNull();
  expect(container.querySelector('[data-ui~=trace-action][data-step-id=tap]')?.getAttribute('aria-pressed')).toBe('true');
  await act(async () => (container.querySelector('[data-ui~=trace-action][data-step-id=fail]') as HTMLElement).click());
  expect(container.querySelector('img[alt="screenshot"]')?.getAttribute('src')).toBe('https://evidence.local/fail.png');
  expect(container.textContent).not.toContain('此动作缺少可关联的时间记录');
});
