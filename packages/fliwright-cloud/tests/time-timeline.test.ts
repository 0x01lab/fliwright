// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TimeTimeline } from '../src/web/TimeTimeline.js';
import type { ReplayNode } from '../src/web/replay-model.js';

it('renders proportional intervals and seeks with the same scale through zoom', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const nodes: ReplayNode[] = [
    { id: 'short', title: 'short', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:01Z', endedAt: '2026-10-19T01:00:01.010Z' },
    { id: 'long', title: 'long', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:05Z', endedAt: '2026-10-19T01:00:09Z' },
    { id: 'point', title: 'point', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:10Z', endedAt: '2026-10-19T01:00:10Z' },
  ];
  try {
    await act(async () => root.render(React.createElement(TimeTimeline, {
      nodes,
      bounds: { startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:10Z' },
      selectedId: 'long',
      onSelect,
    })));
    const short = container.querySelector<HTMLElement>('[data-step-id="short"]')!;
    const long = container.querySelector<HTMLElement>('[data-step-id="long"]')!;
    expect(short.style.left).toBe('10%');
    expect(parseFloat(short.style.width)).toBeCloseTo(0.1);
    expect(long.style.left).toBe('50%');
    expect(long.style.width).toBe('40%');
    expect(container.querySelector<HTMLElement>("[data-ui~=trace-selection]")!.style.width).toBe('40%');
    expect(container.querySelector<HTMLElement>('[data-step-id="point"]')!.style.width).toBe('8px');

    const tracks = container.querySelector<HTMLElement>("[data-ui~=trace-tracks]")!;
    vi.spyOn(tracks, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 1000 } as DOMRect);
    await act(async () => tracks.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 800 })));
    expect(onSelect).toHaveBeenLastCalledWith('long');
    expect(container.querySelector<HTMLElement>("[data-ui~=trace-cursor]")!.style.left).toBe('70%');

    const zoom = container.querySelector<HTMLButtonElement>('[aria-label="放大时间轴"]')!;
    await act(async () => zoom.click());
    expect(container.querySelector<HTMLElement>("[data-ui~=trace-surface]")!.style.width).toBe('200%');
    expect(long.style.width).toBe('40%');
    // The scrolled, zoomed surface has a different origin and width.
    vi.mocked(tracks.getBoundingClientRect).mockReturnValue({ left: -400, width: 2000 } as DOMRect);
    await act(async () => tracks.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1000 })));
    expect(container.querySelector<HTMLElement>("[data-ui~=trace-cursor]")!.style.left).toBe('70%');
    await act(async () => tracks.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 3000 })));
    expect(onSelect).toHaveBeenLastCalledWith('point');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('keeps nearby screenshots in one row and selects the matching image at its recorded time', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const nodes: ReplayNode[] = [
    { id: 'first', title: 'First capture', kind: 'frame', status: 'passed',
      startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:01Z' },
    { id: 'last', title: 'Last capture', kind: 'frame', status: 'failed',
      startedAt: '2026-10-19T01:00:01Z', endedAt: '2026-10-19T01:00:01.010Z' },
    { id: 'unfinished', title: 'Unfinished', kind: 'step', status: 'running',
      startedAt: '2026-10-19T01:00:02Z' },
    { id: 'untimed', title: 'No timestamp', kind: 'frame', status: 'passed', startedAt: '' },
  ];
  try {
    await act(async () => root.render(React.createElement(TimeTimeline, {
      nodes,
      bounds: { startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:02Z' },
      screenshots: (node) => (node.id === 'last' ? ['/last.png', '/second.png'] : [`/${node.id}.png`]).map((url) => ({ url })),
      selectedId: 'last',
      selectedScreenshotIndex: 1,
      onSelect,
    })));
    const frames = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-ui~=trace-frame]"));
    expect(frames).toHaveLength(4);
    expect(frames.map((frame) => frame.dataset.timeMs)).toEqual(['1000', '1010', '1010', '2000']);
    // Nearby frames keep their recorded markers and remain individually clickable.
    const markers = container.querySelectorAll<HTMLElement>("[data-ui~=trace-frame-marker]");
    expect(markers[0].style.left).toBe('50%');
    expect(markers[1].style.left).toBe('50.5%');
    expect(new Set(frames.map((frame) => frame.style.top)).size).toBe(1);
    const lefts = frames.map((frame) => parseFloat(frame.style.left));
    expect(lefts.slice(1).every((left, index) => left >= lefts[index] + 80)).toBe(true);
    expect(lefts[3] + 80).toBe(600);
    expect(frames[0].querySelector('img')!.getAttribute('alt')).toContain('时间轴截图');
    expect(frames[0].querySelector('small')).toBeNull();
    expect(frames[1].getAttribute('aria-pressed')).toBe('false');
    expect(frames[2].getAttribute('aria-pressed')).toBe('true');
    await act(async () => frames[2].click());
    expect(onSelect).toHaveBeenLastCalledWith('last', 1);
    expect(container.querySelector<HTMLElement>("[data-ui~=trace-cursor]")!.style.left).toBe('50.5%');
    expect(frames[2].querySelector('img')!.getAttribute('src')).toBe('/second.png');
    await act(async () => frames[2].querySelector('img')!.dispatchEvent(new Event('error')));
    expect(frames[2].textContent).toContain('截图不可用');
    const zoom = container.querySelector<HTMLButtonElement>('[aria-label="放大时间轴"]')!;
    await act(async () => zoom.click());
    expect(container.querySelector<HTMLElement>("[data-ui~=trace-surface]")!.style.width).toBe('200%');
    expect(markers[1].style.left).toBe('50.5%');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('drags the ruler playhead on the zoomed scale, clamps endpoints and supports keyboard seeking', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const nodes: ReplayNode[] = [
    { id: 'first', title: 'First', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:05Z' },
    { id: 'last', title: 'Last', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:05Z', endedAt: '2026-10-19T01:00:10Z' },
  ];
  try {
    function Timeline() {
      const [selectedId, setSelectedId] = React.useState('first');
      return React.createElement(TimeTimeline, {
        nodes, selectedId,
        onSelect: (id) => { onSelect(id); setSelectedId(id); },
        bounds: { startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:10Z' },
      });
    }
    await act(async () => root.render(React.createElement(Timeline)));
    expect(container.querySelector('[data-slot="slider"]')).toBeNull();
    const handle = container.querySelector<HTMLButtonElement>("[data-ui~=trace-ruler] [role=\"slider\"]")!;
    const surface = container.querySelector<HTMLElement>("[data-ui~=trace-surface]")!;
    const capture = vi.fn();
    const release = vi.fn();
    handle.setPointerCapture = capture;
    handle.releasePointerCapture = release;
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="放大时间轴"]')!.click());
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: -400, width: 2000 } as DOMRect);
    const pointer = async (type: string, clientX: number, pointerId = 7) => {
      await act(async () => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerId, button: 0 })));
    };
    // Grab slightly off-center: the playhead must not jump on pointer down.
    await pointer('pointerdown', -397);
    expect(capture).toHaveBeenCalledWith(7);
    await pointer('pointermove', 803);
    expect(handle.getAttribute('aria-valuenow')).toBe('6000');
    expect(container.querySelector<HTMLElement>("[data-ui~=trace-cursor]")!.style.left).toBe(handle.style.left);
    expect(onSelect).toHaveBeenLastCalledWith('last');
    await pointer('pointermove', 1200, 8);
    expect(handle.getAttribute('aria-valuenow')).toBe('6000');
    await pointer('pointermove', 3000);
    expect(handle.getAttribute('aria-valuenow')).toBe('10000');
    await pointer('pointerup', -1000);
    expect(handle.getAttribute('aria-valuenow')).toBe('0');
    expect(release).toHaveBeenCalledWith(7);
    await pointer('pointermove', 803);
    expect(handle.getAttribute('aria-valuenow')).toBe('0');
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' })));
    expect(handle.getAttribute('aria-valuenow')).toBe('10000');
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })));
    expect(handle.getAttribute('aria-valuenow')).toBe('9900');
    await pointer('pointerdown', 1580);
    await pointer('pointercancel', 1580);
    await pointer('pointermove', 0);
    expect(handle.getAttribute('aria-valuenow')).toBe('9900');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('keeps playback controls in the timeline and updates the preview when stepping or seeking', async () => {
  const { Replay } = await import('../src/web/Replay.js');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const nodes: ReplayNode[] = [
    { id: 'first', title: 'First', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:05Z' },
    { id: 'last', title: 'Last', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:05Z', endedAt: '2026-10-19T01:00:10Z' },
  ];
  const report = {
    id: 'report', requestId: 'request', files: [], issues: [], expiresAt: 0, report: {},
    manifest: { schemaVersion: 1 as const, runId: 'run', status: 'passed' as const,
      evidenceStatus: 'complete' as const, tests: [] },
    tests: [{ testId: 'test', attemptId: 'one', result: {}, trace: {}, issues: [],
      timeline: { nodes, startedAt: nodes[0].startedAt, endedAt: nodes[1].endedAt } }],
  };
  try {
    await act(async () => root.render(React.createElement(Replay, { report, attempt: report.tests[0] })));
    const timeline = container.querySelector<HTMLElement>("[data-ui~=trace-timeline]")!;
    expect(timeline.querySelector('[aria-label="时间轴回放控制"]')).not.toBeNull();
    expect(container.querySelector("[data-ui~=rp-stage] [data-ui~=replay-toolbar]")).toBeNull();
    const next = timeline.querySelector<HTMLButtonElement>('[aria-label="下一步"]')!;
    await act(async () => next.click());
    expect(container.querySelector("[data-ui~=replay-current] b")!.textContent).toBe('2. Last');
    expect(timeline.querySelector('[role="slider"]')!.getAttribute('aria-valuenow')).toBe('5000');
    await act(async () => timeline.querySelector<HTMLButtonElement>('[role="slider"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }),
    ));
    expect(container.querySelector("[data-ui~=replay-current] b")!.textContent).toBe('1. First');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each([false, true])('shows lifecycle screenshots with the test attempt and counts only steps (shared: %s)', async (shared) => {
  const { Replay } = await import('../src/web/Replay.js');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const nodes: ReplayNode[] = [
    { id: 'start', title: 'Test start screenshot', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:01Z',
      metadata: { lifecycle: 'start' }, artifacts: [{ kind: 'screenshot', path: 'start.png' }] },
    { id: 'action', title: 'Tap home', kind: 'action', status: 'passed',
      startedAt: '2026-10-19T01:00:02Z', endedAt: '2026-10-19T01:00:04Z',
      artifacts: [{ kind: 'screenshot', path: 'action.png' }] },
    { id: 'assertion', title: 'Home is visible', kind: 'assertion', status: 'passed',
      startedAt: '2026-10-19T01:00:05Z', endedAt: '2026-10-19T01:00:07Z' },
    { id: 'finish', title: 'Test finish screenshot', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:09Z', endedAt: '2026-10-19T01:00:10Z',
      metadata: { lifecycle: 'finish' }, artifacts: [{ kind: 'screenshot', path: 'finish.png' }] },
  ];
  const base = 'tests/test/one';
  const report = {
    id: 'report', requestId: 'request', issues: [], expiresAt: 0, report: {},
    files: ['start.png', 'action.png', 'finish.png', 'assertion-failure.png'].map((path) => `${base}/${path}`),
    manifest: { schemaVersion: 1 as const, runId: 'run', status: 'passed' as const,
      evidenceStatus: 'complete' as const,
      tests: [{ testId: 'test', attempts: [{ attemptId: 'one', resultPath: `${base}/result.json` }] }] },
    tests: [{ testId: 'test', attemptId: 'one', result: {}, trace: {}, issues: [],
      timeline: { nodes, startedAt: nodes[0].startedAt, endedAt: nodes[3].endedAt } }],
  };
  const stepNames = () => Array.from(container.querySelectorAll('[data-ui="step-name"]'), (el) => el.textContent);
  const prefix = shared ? '/api/shared/reports' : '/api/reports';
  const filesIn = (selector: string) => Array.from(container.querySelectorAll(`${selector} img`), (el) => el.getAttribute('src'));
  const url = (path: string) => `${prefix}/report/file?path=${encodeURIComponent(`${base}/${path}`)}`;
  const openTab = async (label: string) => {
    const tab = Array.from(container.querySelectorAll('[role="tab"]')).find((el) => el.textContent === label)!;
    await act(async () => tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  };
  try {
    await act(async () => root.render(React.createElement(Replay, { report, attempt: report.tests[0], shared })));
    expect(stepNames()).toEqual(['Home is visible']);
    const stepRow = container.querySelector<HTMLButtonElement>('[data-ui="step-select"]')!;
    expect(stepRow.textContent).not.toContain('Tap home');
    expect(stepRow.title).toBe('Home is visible');
    expect(stepRow.querySelector('[aria-label="成功"]')).not.toBeNull();
    expect(container.querySelector('[data-ui="sub"]')!.textContent).toContain('1 步 · 1 步有截图');
    expect(Array.from(container.querySelectorAll('[data-ui~=trace-action]'), (el) => el.getAttribute('data-step-id')))
      .toEqual(['action', 'assertion']);
    expect(container.querySelector('[data-ui~=trace-playhead]')!.getAttribute('aria-valuemax')).toBe('10000');
    expect(container.querySelector('[data-ui~=trace-frame]')!.getAttribute('data-step-id')).toBe('action');
    const relatedEvent = () => container.querySelector<HTMLButtonElement>('[data-ui="related-step-event"]')!;
    await act(async () => stepRow.click());
    expect(container.querySelector('[data-ui="hd"]')!.textContent).toBe('Home is visible');
    expect(filesIn('[data-ui="replay-canvas"]')).toEqual([url('action.png')]);
    expect(container.querySelector('[data-ui~=trace-frame]')!.getAttribute('aria-pressed')).toBe('true');
    expect(stepRow.getAttribute('aria-current')).toBe('step');
    expect(relatedEvent().textContent).toContain('Tap home');
    await act(async () => relatedEvent().click());
    expect(container.querySelector('[data-ui="hd"]')!.textContent).toBe('Tap home');
    expect(stepRow.getAttribute('aria-current')).toBe('step');
    await act(async () => stepRow.click());

    const screenshotFilter = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-ui="chiprow"] button'))
      .find((el) => el.textContent?.startsWith('有截图'))!;
    expect(screenshotFilter.querySelector('[data-ui="n"]')!.textContent).toBe('1');
    await act(async () => screenshotFilter.click());
    expect(stepNames()).toEqual(['Home is visible']);
    await act(async () => stepRow.click());
    expect(container.querySelector('[data-ui="hd"]')!.textContent).toBe('Home is visible');

    await openTab('用例截图');
    expect(filesIn('[data-ui="case-screenshots"]')).toEqual([url('start.png'), url('finish.png')]);
    expect(filesIn('[data-ui="replay-canvas"]')).toEqual([url('action.png')]);

    const failedAttempt = {
      ...report.tests[0],
      timeline: { ...report.tests[0].timeline, nodes: nodes.map((entry) => entry.id === 'assertion'
        ? { ...entry, status: 'failed' as const, artifacts: [
          { kind: 'screenshot' as const, path: 'assertion-failure.png', metadata: { capturePhase: 'failure' } },
        ] }
        : entry) },
    };
    await act(async () => root.render(React.createElement(Replay, { report, attempt: failedAttempt, shared })));
    expect(stepRow.querySelector('[aria-label="失败"]')).not.toBeNull();
    await act(async () => stepRow.click());
    expect(container.querySelector('[data-ui="hd"]')!.textContent).toBe('Home is visible');
    expect(filesIn('[data-ui="replay-canvas"]')).toEqual([url('assertion-failure.png')]);
    const gallery = container.querySelectorAll<HTMLButtonElement>('[data-ui="image-selector"] button');
    expect(gallery).toHaveLength(2);
    await act(async () => gallery[0].click());
    expect(filesIn('[data-ui="replay-canvas"]')).toEqual([url('action.png')]);
    expect(container.querySelector('[data-ui="hd"]')!.textContent).toBe('Home is visible');
    const failureFrame = container.querySelector<HTMLButtonElement>('[data-ui~=trace-frame][data-step-id="assertion"]')!;
    await act(async () => failureFrame.click());
    expect(filesIn('[data-ui="replay-canvas"]')).toEqual([url('assertion-failure.png')]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('overlays a click point and input bounds only on the corresponding pre-action image', async () => {
  const { Replay } = await import('../src/web/Replay.js');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const base = 'tests/test/one';
  const nodes: ReplayNode[] = [
    { id: 'click', title: 'Tap Home', kind: 'action', status: 'passed',
      startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:01Z',
      metadata: { interaction: { kind: 'click', x: 100, y: 200 } },
      artifacts: [
        { kind: 'screenshot', path: 'click-before.png', metadata: { capturePhase: 'start', pixelRatio: 2 } },
        { kind: 'screenshot', path: 'click-after.png', metadata: { capturePhase: 'finish', pixelRatio: 2 } },
      ] },
    { id: 'input', title: 'Fill Search', kind: 'action', status: 'passed',
      startedAt: '2026-10-19T01:00:01Z', endedAt: '2026-10-19T01:00:02Z',
      metadata: { interaction: { kind: 'input', x: 40, y: 50, width: 260, height: 40 } },
      artifacts: [{ kind: 'screenshot', path: 'input-before.png', metadata: { capturePhase: 'start', pixelRatio: 2 } }] },
  ];
  const report = {
    id: 'report', requestId: 'request', issues: [], expiresAt: 0, report: {},
    files: ['click-before.png', 'click-after.png', 'input-before.png'].map((path) => `${base}/${path}`),
    manifest: { schemaVersion: 1 as const, runId: 'run', status: 'passed' as const,
      evidenceStatus: 'complete' as const,
      tests: [{ testId: 'test', attempts: [{ attemptId: 'one', resultPath: `${base}/result.json` }] }] },
    tests: [{ testId: 'test', attemptId: 'one', result: {}, trace: {}, issues: [], timeline: { nodes } }],
  };
  const image = () => container.querySelector<HTMLImageElement>('[data-ui="replay-canvas"] img')!;
  const loadImage = async (width: number, height: number) => {
    Object.defineProperties(image(), { naturalWidth: { value: 800 }, naturalHeight: { value: 1600 } });
    vi.spyOn(image(), 'getBoundingClientRect').mockReturnValue({ width, height } as DOMRect);
    await act(async () => image().dispatchEvent(new Event('load')));
  };
  const marker = () => container.querySelector<HTMLElement>('[data-ui="screenshot-overlay"] [role="img"]');
  try {
    await act(async () => root.render(React.createElement(Replay, { report, attempt: report.tests[0] })));
    await loadImage(240, 400);
    const original = `/api/reports/report/file?path=${encodeURIComponent(`${base}/click-before.png`)}`;
    expect(image().getAttribute('src')).toBe(original);
    expect(image().closest('a')!.getAttribute('href')).toBe(original);
    expect(marker()?.getAttribute('aria-label')).toBe('点击位置');
    expect(marker()?.style.left).toBe('50px');
    expect(marker()?.style.top).toBe('100px');
    expect(marker()?.parentElement?.style.left).toBe('20px');

    const frames = container.querySelectorAll<HTMLButtonElement>('[data-ui~=trace-frame]');
    expect(Array.from(frames, (frame) => frame.dataset.timeMs)).toEqual(['0', '1000', '1000']);
    await act(async () => frames[1].click());
    expect(image().getAttribute('src')).toContain('click-after.png');
    expect(marker()).toBeNull();

    await act(async () => frames[2].click());
    await loadImage(100, 200);
    expect(marker()?.getAttribute('aria-label')).toBe('输入框范围');
    expect(marker()?.style.left).toBe('10px');
    expect(marker()?.style.top).toBe('12.5px');
    expect(marker()?.style.width).toBe('65px');
    expect(marker()?.style.height).toBe('10px');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('plays recorded time linearly per frame, resumes and changes speed without jumping, and stops at the end', async () => {
  const { Replay } = await import('../src/web/Replay.js');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let now = 0, frameId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const advance = async (elapsed: number) => {
    now += elapsed;
    const pending = [...callbacks.values()];
    callbacks.clear();
    await act(async () => pending.forEach((callback) => callback(now)));
  };
  const nodes: ReplayNode[] = [
    { id: 'first', title: 'First', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T01:00:04Z' },
    { id: 'last', title: 'Last', kind: 'step', status: 'passed',
      startedAt: '2026-10-19T01:00:04Z', endedAt: '2026-10-19T01:00:10Z' },
  ];
  const report = {
    id: 'report', requestId: 'request', files: [], issues: [], expiresAt: 0, report: {},
    manifest: { schemaVersion: 1 as const, runId: 'run', status: 'passed' as const,
      evidenceStatus: 'complete' as const, tests: [] },
    tests: [{ testId: 'test', attemptId: 'one', result: {}, trace: {}, issues: [],
      timeline: { nodes, startedAt: nodes[0].startedAt, endedAt: nodes[1].endedAt } }],
  };
  try {
    await act(async () => root.render(React.createElement(Replay, { report, attempt: report.tests[0] })));
    const handle = container.querySelector<HTMLButtonElement>("[data-ui~=trace-playhead]")!;
    const time = () => Number(handle.getAttribute('aria-valuenow'));
    const play = () => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-ui~=replay-toolbar] button"))
      .find((button) => /播放|暂停/.test(button.textContent ?? ''))!;
    await act(async () => play().click());
    for (let i = 1; i <= 10; i++) {
      await advance(16.5);
      expect(time()).toBeCloseTo(16.5 * i);
      expect(parseFloat(container.querySelector<HTMLElement>("[data-ui~=trace-cursor]")!.style.left)).toBeCloseTo(time() / 100);
      expect(handle.style.left).toBe(container.querySelector<HTMLElement>("[data-ui~=trace-cursor]")!.style.left);
    }
    expect(container.querySelector("[data-ui~=replay-current] b")!.textContent).toBe('1. First');
    await act(async () => play().click());
    expect(callbacks.size).toBe(0);
    await advance(1000);
    expect(time()).toBe(165);
    await act(async () => play().click());
    await advance(100);
    expect(time()).toBe(265);
    const speed = container.querySelector<HTMLSelectElement>('[aria-label="回放速度"]')!;
    await act(async () => {
      speed.value = '2';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(time()).toBe(265);
    await advance(100);
    expect(time()).toBe(465);
    // A slow frame catches up using elapsed wall time, including across steps.
    await advance(2000);
    expect(time()).toBe(4465);
    expect(container.querySelector("[data-ui~=replay-current] b")!.textContent).toBe('2. Last');
    await advance(5000);
    expect(time()).toBe(10000);
    expect(play().textContent).toContain('播放');
    expect(callbacks.size).toBe(0);
    await act(async () => play().click());
    expect(time()).toBe(0);
    await advance(100);
    expect(time()).toBe(200);
    // Pointer down pauses immediately, before the first drag movement.
    handle.setPointerCapture = vi.fn();
    await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId: 1, button: 0, clientX: 10,
    })));
    expect(play().textContent).toContain('播放');
    expect(callbacks.size).toBe(0);
    await advance(100);
    expect(time()).toBe(200);
    await act(async () => handle.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await act(async () => play().click());
    expect(callbacks.size).toBe(1);
  } finally {
    await act(async () => root.unmount());
    expect(callbacks.size).toBe(0);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    container.remove();
  }
});
