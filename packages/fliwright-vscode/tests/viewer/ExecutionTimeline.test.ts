// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionTimeline } from '../../src/webview/viewer/components/ExecutionTimeline.js';
import type { TimelineNode } from '@fliwright/core';

const stamp = (ms: number) => new Date(Date.UTC(2026, 10, 19) + ms).toISOString();
const nodes: TimelineNode[] = [
  { id: 'pass', kind: 'action', title: 'Tap submit', status: 'passed', startedAt: stamp(1000), endedAt: stamp(2000) },
  { id: 'fail', kind: 'assertion', title: 'Success visible', status: 'failed', startedAt: stamp(2000), endedAt: stamp(4000) },
];
let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('defaults to small failure frames at their recorded time and keeps every operation selectable', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); cleanup = () => { act(() => root.unmount()); container.remove(); };
  const onSelect = vi.fn();
  await act(async () => root.render(React.createElement(ExecutionTimeline, {
    nodes, bounds: { startedAt: stamp(0), endedAt: stamp(4000) }, selectedId: 'fail',
    screenshotMode: 'failed', zoom: 1, onZoomChange: vi.fn(), onScreenshotModeChange: vi.fn(),
    screenshots: (node: TimelineNode) => [`/${node.id}.png`, `/${node.id}-2.png`], onSelect,
  })));
  expect(container.querySelector('input[type=range]')).toBeNull();
  expect(container.querySelectorAll('[data-ui~=trace-action]')).toHaveLength(2);
  const frames = container.querySelectorAll<HTMLElement>('[data-ui~=trace-frame]');
  expect(frames).toHaveLength(2);
  expect(frames[0].style.width).toBe('76px');
  expect(frames[0].dataset.timeMs).toBe('4000');
  expect(container.querySelector<HTMLElement>('[data-ui~=trace-frame-marker]')!.style.left).toBe('100%');
  expect(frames[1].style.top).not.toBe(frames[0].style.top);
  await act(async () => frames[1].click());
  expect(onSelect).toHaveBeenLastCalledWith('fail', 1);
});

it('keeps a passing run compact in failure-only mode and supports keyboard time positioning', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); cleanup = () => { act(() => root.unmount()); container.remove(); };
  const onSelect = vi.fn();
  await act(async () => root.render(React.createElement(ExecutionTimeline, {
    nodes: [nodes[0]], bounds: { startedAt: stamp(0), endedAt: stamp(4000) }, selectedId: 'pass',
    screenshotMode: 'failed', zoom: 1, onZoomChange: vi.fn(), onScreenshotModeChange: vi.fn(),
    screenshots: () => ['/pass.png'], onSelect,
  })));
  expect(container.querySelectorAll('[data-ui~=trace-frame]')).toHaveLength(0);
  await act(async () => container.querySelector('[role=slider]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(onSelect).toHaveBeenLastCalledWith('pass');
  expect(container.querySelector('[role=slider]')!.getAttribute('aria-valuenow')).toBe('4000');
});

it('plays on the recorded clock at the chosen speed and pauses on manual positioning', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  const onStep = vi.fn(), onPause = vi.fn(), onEnd = vi.fn(), onSelect = vi.fn();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); cleanup = () => { act(() => root.unmount()); container.remove(); now.mockRestore(); };
  const draw = async (selectedId: string, playing: boolean) => act(async () => root.render(React.createElement(ExecutionTimeline, {
    nodes, bounds: { startedAt: stamp(0), endedAt: stamp(4000) }, selectedId,
    screenshotMode: 'failed', zoom: 1, onZoomChange: vi.fn(), onScreenshotModeChange: vi.fn(), onSelect,
    playback: { playing, speed: 2, onSelect: onStep, onPause, onEnd },
  })));
  await draw('pass', true);
  await act(async () => frame!(700));
  await draw('fail', true);
  expect(container.querySelector('[role=slider]')?.getAttribute('aria-valuenow')).toBe('2400');
  expect(onStep).toHaveBeenLastCalledWith('fail');
  expect(onPause).not.toHaveBeenCalled();
  await draw('fail', true);
  await act(async () => frame!(1500));
  expect(onEnd).toHaveBeenCalledOnce();
  expect(container.querySelector('[role=slider]')?.getAttribute('aria-valuenow')).toBe('4000');
  await act(async () => container.querySelector('[role=slider]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(onPause).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenLastCalledWith('pass');
  await draw('fail', false);
  await act(async () => container.querySelector('[role=slider]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(onPause).toHaveBeenCalled();
  expect(onSelect).toHaveBeenLastCalledWith('pass');
});

it('switches between failure/all/hidden thumbnails without filtering operation spans', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); cleanup = () => { act(() => root.unmount()); container.remove(); };
  const render = async (mode: 'failed' | 'all' | 'none') => act(async () => root.render(React.createElement(ExecutionTimeline, {
    nodes, bounds: {}, selectedId: 'fail', screenshotMode: mode, zoom: 1,
    onZoomChange: vi.fn(), onScreenshotModeChange: vi.fn(), onSelect: vi.fn(), screenshots: node => [`/${node.id}.png`],
  })));
  await render('failed'); expect(container.querySelectorAll('[data-ui~=trace-frame]')).toHaveLength(1);
  await render('all'); expect(container.querySelectorAll('[data-ui~=trace-frame]')).toHaveLength(2);
  await render('none'); expect(container.querySelectorAll('[data-ui~=trace-frame]')).toHaveLength(0);
  expect(container.querySelectorAll('[data-ui~=trace-action]')).toHaveLength(2);
});
