// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/web/app.js';
import type { BoardRequest } from '../src/web/TestBoard.js';
import { projectSchema, type Project } from '@fliwright/cloud-protocol';

let root: Root;
let container: HTMLDivElement;
const streams: Array<{ url: string; close: ReturnType<typeof vi.fn> }> = [];
let boardItems: BoardRequest[] = [];
let role = 'member';
let projects: Project[] = [];
const requestOverrides: Record<string, Record<string, unknown>> = {};
const target = {
  id: 'app',
  name: 'App',
  suites: ['smoke'],
  scenarios: ['clean'],
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  streams.length = 0;
  boardItems = [];
  role = 'member';
  projects = [];
  for (const key of Object.keys(requestOverrides)) delete requestOverrides[key];
  vi.stubGlobal(
    'EventSource',
    class {
      close = vi.fn();
      constructor(public url: string) {
        streams.push(this);
      }
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      const url = new URL(input, window.location.origin);
      const path = url.pathname;
      let data: unknown;
      if (path === '/api/me') data = { name: 'Alice', role };
      else if (path === '/api/projects') data = projects;
      else if (/^\/api\/projects\/[^/]+\/status$/.test(path)) data = { ready: false, blockers: [], latestScan: null };
      else if (path === '/api/targets') data = [target];
      else if (path === '/api/operations')
        data = { storage: { freeBytes: 0, reservedBytes: 0 } };
      else if (path === '/api/share/exchange') {
        expect(window.location.hash).toBe('');
        data = { url: '/shared/reports/bundle' };
      } else if (path === '/api/requests' && options?.method === 'POST')
        data = { id: 'created' };
      else if (path.endsWith('/rerun') && options?.method === 'POST')
        data = { id: 'rerun' };
      else if (path === '/api/requests') {
        const matches = boardItems.filter((item) =>
          (!url.searchParams.get('state') || item.state === url.searchParams.get('state')) &&
          (!url.searchParams.get('targetId') || item.input.targetId === url.searchParams.get('targetId')) &&
          (!url.searchParams.get('search') || JSON.stringify(item).includes(url.searchParams.get('search')!)));
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 25);
        data = {
          items: matches.slice(offset, offset + limit), total: matches.length,
          queue: boardItems.filter((item) => item.state === 'queued').map((item) => item.id).reverse(),
        };
      }
      else if (path.startsWith('/api/requests/')) {
        if (path.endsWith('/worker-timeline')) {
          data = { schemaVersion: 1, requestId: 'original', executionAttemptId: path.split('/')[5], workerId: 'mac', slotId: 'ios', deviceId: 'device', executionStatus: 'finished', testVerdict: 'passed', quality: 'complete', revision: 1, cursor: 0, observedOffsetMs: 0, spans: [], milestones: [], issues: [] };
        } else {
        data = {
          id: path.split('/')[3],
          input: {
            targetId: 'app',
            commit: 'a'.repeat(40),
            suite: 'smoke',
            scenario: 'clean',
          },
          state: 'completed',
          verdict: 'passed',
          actor: 'alice',
          createdAt: 1,
          attempts: [],
          reports: [],
          queuePosition: 0,
          ...requestOverrides[path.split('/')[3]],
        };
        }
      } else if (/^\/api\/(shared\/)?reports\/[^/]+$/.test(path)) {
        data = {
          id: path.split('/').pop(),
          requestId: 'original',
          ...(!path.startsWith('/api/shared/') ? { executionAttemptId: `attempt-${path.split('/').pop()}` } : {}),
          expiresAt: 1,
          manifest: {
            runId: 'run',
            status: 'passed',
            evidenceStatus: 'complete',
            tests: [],
          },
          tests: [],
          report: {},
          issues: [],
          files: [],
        };
      } else data = [];
      return { ok: true, json: async () => data };
    }),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(path = '/') {
  window.history.replaceState(null, '', path);
  await act(async () => root.render(React.createElement(App)));
}

async function openConfiguration() {
  const trigger = Array.from(document.body.querySelectorAll<HTMLButtonElement>('nav button'))
    .find((button) => button.textContent?.trim() === '配置')!;
  expect(trigger).toBeDefined();
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    await act(async () => trigger.click());
  }
  return trigger;
}

async function click(selector: string, modifiers: MouseEventInit = {}) {
  if (/^nav a\[href="\/(workers|devices|targets|reports)"\]/.test(selector)) {
    await openConfiguration();
  }
  const link = document.body.querySelector<HTMLAnchorElement>(selector)!;
  expect(link).not.toBeNull();
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...modifiers,
  });
  // Observe React's interception before preventing native navigation in the test DOM.
  let handled = false;
  document.addEventListener(
    'click',
    (e) => {
      handled = e.defaultPrevented;
      e.preventDefault();
    },
    { once: true },
  );
  await act(async () => {
    link.dispatchEvent(event);
  });
  return handled;
}

async function submitSearch(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('#global-search')!;
  input.value = value;
  const event = new Event('submit', { bubbles: true, cancelable: true });
  await act(async () => {
    input.form!.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
}

it('handles top navigation in the current document and preserves the shell', async () => {
  await mount();
  const shell = document.body.querySelector("header[data-ui~=app-header]");
  expect(shell).not.toBeNull();
  expect(shell?.querySelector('nav[aria-label="主导航"]')).not.toBeNull();
  expect(shell?.querySelector('#global-search')).not.toBeNull();
  expect(shell?.nextElementSibling).toBe(document.body.querySelector('main'));
  const initialMeCalls = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => url === '/api/me').length;
  expect(
    await click('nav a[href="/workers"]'),
    'internal links must prevent a full document navigation',
  ).toBe(true);
  expect(document.body.querySelector('h1')?.textContent).toBe('Worker 主机');
  expect(window.location.pathname).toBe('/workers');
  expect(document.body.querySelector("header[data-ui~=app-header]")).toBe(shell);
  expect(document.body.querySelector("nav [data-ui~=configuration-active]")?.textContent).toContain('配置');
  expect(document.body.querySelector('nav a[href="/workers"]')).toBeNull();
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/me'),
  ).toHaveLength(initialMeCalls);
  expect(await click('nav a[href="/queue"]')).toBe(true);
  expect(document.body.querySelector('main h1')?.textContent).toBe('执行看板');
  expect(document.body.querySelector('main h2')?.textContent).toBe('测试看板');
  expect(document.body.querySelector('main a[href="/new"]')).not.toBeNull();
});

it('keeps board and cases in the single top navigation and opens configuration with keyboard dismissal', async () => {
  await mount('/queue');
  const header = document.body.querySelector("header[data-ui~=app-header]")!;
  const nav = header.querySelector('nav')!;
  expect(header.querySelector("[data-ui~=topbar]")?.contains(nav)).toBe(true);
  expect(Array.from(nav.querySelectorAll('a')).map((link) => link.getAttribute('href')))
    .toEqual(['/queue', '/projects']);
  expect(nav.querySelector('a[href="/queue"]')?.getAttribute('aria-label')).toBe('执行看板');
  expect(nav.querySelector('a[href="/projects"]')?.getAttribute('aria-label')).toBe('测试用例');
  expect(nav.querySelector('a[href="/queue"]')?.getAttribute('aria-current')).toBe('page');
  expect(nav.textContent).not.toMatch(/运行记录|测试队列/);
  expect(nav.textContent).not.toContain('概览');
  expect(header.querySelector("[data-ui~=brand]")?.getAttribute('href')).toBe('/');
  const trigger = await openConfiguration();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  for (const url of ['/overview', '/devices', '/workers', '/projects', '/reports']) {
    expect(nav.querySelector(`a[href="${url}"]`)).not.toBeNull();
  }
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(await click("header [data-ui~=brand]")).toBe(true);
  expect(window.location.pathname).toBe('/');
});

it('preserves native modified-click behavior', async () => {
  await mount();
  expect(await click('nav a[href="/workers"]', { ctrlKey: true })).toBe(false);
  expect(await click('nav a[href="/workers"]', { metaKey: true })).toBe(false);
  expect(window.location.pathname).toBe('/');
});

it('updates searches on the current route and restores them through browser history', async () => {
  await mount('/queue?search=first');
  const shell = document.body.querySelector("header[data-ui~=app-header]");
  expect(
    document.body.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.value,
  ).toBe('first');
  await submitSearch('second search');
  expect(window.location.pathname).toBe('/queue');
  expect(new URLSearchParams(window.location.search).get('search')).toBe(
    'second search',
  );
  expect(
    document.body.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.value,
  ).toBe('second search');
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes('search=second+search')),
  ).toBe(true);
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(
    document.body.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.value,
  ).toBe('first');
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(
    document.body.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.value,
  ).toBe('second search');
  expect(document.body.querySelector("header[data-ui~=app-header]")).toBe(shell);
});

it.each([
  ['/', '执行看板', null],
  ['/overview', '概览', null],
  ['/queue', '执行看板', null],
  ['/reports', '测试报告', 'completed'],
  ['/runs', undefined, null],
])('opens %s directly with its own filters', async (path, title, state) => {
  await mount(path);
  expect(document.body.querySelector('h1')?.textContent).toBe(title);
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).startsWith('/api/requests?'))!;
  expect(
    new URL(String(call[0]), window.location.origin).searchParams.get('state'),
  ).toBe(state);
});

it('keeps all lifecycle columns on tasks and only completed requests on reports', async () => {
  await mount('/queue');
  for (const path of ['/reports', '/queue']) {
    await click(`nav a[href="${path}"]`);
    expect(Array.from(document.body.querySelectorAll("[data-ui~=test-column] h3")).map((heading) => heading.textContent))
      .toEqual(['待测试', '测试中', '已成功', '已失败']);
    const call = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/requests?')).at(-1)!;
    expect(new URL(String(call[0]), window.location.origin).searchParams.get('state'))
      .toBe(path === '/reports' ? 'completed' : null);
  }
});

function boardRequest(id: string, state: BoardRequest['state'], verdict: BoardRequest['verdict'] = 'unknown'): BoardRequest {
  return {
    id, state, verdict, actor: 'alice', createdAt: 1, queuedAt: 1, attempts: 0,
    input: { targetId: 'app', commit: 'a'.repeat(40), suite: 'smoke', scenario: `scenario-${id}` },
  };
}

it.each([
  ['case with scenario', { mode: 'case', suite: 'smoke', titlePath: ['账户', '显示余额'] }, 'clean', '账户 › 显示余额'],
  ['case without scenario', { mode: 'case', suite: 'smoke', titlePath: ['账户', '显示余额'] }, undefined, '账户 › 显示余额'],
  ['suite', { mode: 'suite', suite: 'smoke' }, 'clean', 'smoke'],
  ['legacy request', undefined, undefined, 'smoke'],
] as const)('uses the test name for %s on task cards and details', async (_label, selection, scenario, title) => {
  const request: BoardRequest = {
    ...boardRequest('named-test', 'queued'),
    selection: selection ? { ...selection, ...('titlePath' in selection ? { titlePath: [...selection.titlePath] } : {}) } : undefined,
  };
  request.input.scenario = scenario;
  boardItems = [request];
  requestOverrides[request.id] = { input: request.input, selection: request.selection };

  await mount('/queue');
  const card = document.body.querySelector<HTMLAnchorElement>('[data-ui~=test-card]')!;
  expect(card.querySelector('h4')?.textContent).toBe(title);
  expect(card.getAttribute('aria-label')).toBe(`查看测试 ${title}，named-test，等待设备`);

  await click('[data-ui~=test-card]');
  const heading = document.body.querySelector('h1')!;
  expect(heading.firstChild?.textContent).toBe(title);
});

it('groups lifecycle cards, follows scheduling order and loads details only after opening a card', async () => {
  boardItems = [
    boardRequest('queued-new', 'queued'), boardRequest('queued-old', 'queued'),
    boardRequest('preparing', 'preparing'), boardRequest('finalizing', 'finalizing', 'passed'),
    boardRequest('passed', 'completed', 'passed'), boardRequest('failed', 'completed', 'failed'),
    boardRequest('broken', 'infrastructure_failed'), boardRequest('cancelled', 'cancelled'),
  ];
  await mount('/queue');
  const pending = document.body.querySelector("[data-ui~=test-column-pending]")!;
  expect(Array.from(pending.querySelectorAll('a')).map((link) => link.getAttribute('href')))
    .toEqual(['/requests/queued-old', '/requests/queued-new']);
  expect(pending.textContent).toContain('排队第 1 位');
  expect(document.body.querySelectorAll("[data-ui~=test-column-running] a")).toHaveLength(2);
  expect(document.body.querySelectorAll("[data-ui~=test-column-passed] a")).toHaveLength(1);
  expect(document.body.querySelectorAll("[data-ui~=test-column-failed] a")).toHaveLength(2);
  expect(document.body.querySelector("[data-ui~=test-column-other]")?.textContent).toContain('已取消');
  expect(streams).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/requests/'))).toBe(false);
  expect(await click("[data-ui~=test-card][href=\"/requests/failed\"]")).toBe(true);
  expect(window.location.pathname).toBe('/requests/failed');
  expect(streams[0].url).toBe('/api/requests/failed/events');
});

it('moves cards to their new column when the queue refreshes', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  boardItems = [boardRequest('moving', 'queued')];
  await mount('/queue');
  expect(document.body.querySelector("[data-ui~=test-column-pending] a")).not.toBeNull();
  boardItems = [boardRequest('moving', 'preparing')];
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.body.querySelector("[data-ui~=test-column-pending] a")).toBeNull();
  expect(document.body.querySelector("[data-ui~=test-column-running] a")).not.toBeNull();
  boardItems = [boardRequest('moving', 'completed', 'passed')];
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.body.querySelector("[data-ui~=test-column-running] a")).toBeNull();
  expect(document.body.querySelector("[data-ui~=test-column-passed] a")).not.toBeNull();
});

it('paginates the board and returns to the first page when searching', async () => {
  boardItems = Array.from({ length: 26 }, (_, index) => boardRequest(`run-${index}`, 'completed', index % 2 ? 'failed' : 'passed'));
  await mount('/queue');
  expect(document.body.querySelectorAll("[data-ui~=test-card]")).toHaveLength(25);
  expect(document.body.querySelector("[data-ui~=board-caption]")?.textContent).toContain('本页 25 条 · 共 26 条');
  const next = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === '下一页')!;
  await act(async () => next.click());
  expect(document.body.querySelectorAll("[data-ui~=test-card]")).toHaveLength(1);
  expect(document.body.querySelector("[data-ui~=test-card]")?.getAttribute('href')).toBe('/requests/run-25');
  const search = document.body.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'scenario-run-0');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.body.querySelectorAll("[data-ui~=test-card]")).toHaveLength(1);
  expect(document.body.querySelector("[data-ui~=test-card]")?.getAttribute('href')).toBe('/requests/run-0');
  expect(document.body.querySelector("[data-ui~=pagination]")?.textContent).toContain('第 1 / 1 页');
});

it('navigates to the new task after submission without replacing the shell', async () => {
  await mount('/new');
  const shell = document.body.querySelector("header[data-ui~=app-header]");
  const input = document.body.querySelector<HTMLInputElement>('input[pattern]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'a'.repeat(40));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.form!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  expect(window.location.pathname).toBe('/requests/created');
  expect(document.body.querySelector('h1')?.textContent).toContain('#created');
  expect(document.body.querySelector("header[data-ui~=app-header]")).toBe(shell);
  const submission = vi
    .mocked(fetch)
    .mock.calls.find(
      ([url, options]) => url === '/api/requests' && options?.method === 'POST',
    )!;
  expect(JSON.parse(String(submission[1]?.body))).toEqual({
    targetId: 'app',
    suite: 'smoke',
    commit: 'a'.repeat(40),
  });
});

it('opens dynamic details, reruns in place, and closes the previous event stream', async () => {
  await mount('/requests/original');
  const shell = document.body.querySelector("header[data-ui~=app-header]");
  const stream = streams[0];
  expect(document.body.querySelector("[data-ui~=crumb] a")?.textContent).toBe('执行看板');
  expect(document.body.querySelector('nav a[href="/queue"]')?.getAttribute('aria-current')).toBe('page');
  const button = Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('重新运行'),
  )!;
  await act(async () => button.click());
  expect(window.location.pathname).toBe('/requests/rerun');
  expect(document.body.querySelector('h1')?.textContent).toContain('#rerun');
  expect(stream.close).toHaveBeenCalledOnce();
  expect(streams[1].url).toBe('/api/requests/rerun/events');
  expect(document.body.querySelector("header[data-ui~=app-header]")).toBe(shell);
  await click('a[href="/queue"]');
  expect(streams[1].close).toHaveBeenCalledOnce();
});

it('opens report links in the same document', async () => {
  await mount('/reports/bundle');
  const shell = document.body.querySelector("header[data-ui~=app-header]");
  expect(document.body.querySelector('h1')?.textContent).toBe('run');
  expect(document.body.querySelector('a[href="/requests/original"]')).toBeNull();
  expect(await click('a[href="/queue"]')).toBe(true);
  expect(window.location.pathname).toBe('/queue');
  expect(document.body.querySelector("header[data-ui~=app-header]")).toBe(shell);
});

const publishedReport = (id: string, state = 'published') => ({
  id,
  attemptId: `attempt-${id}`,
  state,
  expiresAt: 1,
});

it.each(['passed', 'failed'])(
  'opens the report directly for a completed %s run and keeps rerun on the report page',
  async (verdict) => {
    requestOverrides.original = {
      verdict,
      reports: [publishedReport('older'), publishedReport('bundle')],
    };
    await mount('/requests/original');
    expect(window.location.pathname).toBe('/reports/bundle');
    expect(document.body.querySelector('h1')?.textContent).toBe('run');
    expect(document.body.querySelectorAll('h1')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('独立打开报告');
    expect(document.body.textContent).not.toContain('运行详情');
    expect(document.body.querySelector('a[href="/reports/older"]')).not.toBeNull();
    const shell = document.body.querySelector("header[data-ui~=app-header]");
    const stream = streams.at(-1)!;
    const rerun = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('重新运行'),
    )!;
    await act(async () => rerun.click());
    expect(window.location.pathname).toBe('/requests/rerun');
    expect(document.body.querySelector("header[data-ui~=app-header]")).toBe(shell);
    expect(stream.close).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      '/api/requests/original/rerun',
      expect.objectContaining({ method: 'POST' }),
    );
  },
);

it('opens the report automatically when a running task publishes it', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  requestOverrides.original = { state: 'running' };
  await mount('/requests/original');
  expect(window.location.pathname).toBe('/requests/original');
  const stream = streams[0];
  requestOverrides.original = {
    state: 'completed',
    reports: [publishedReport('bundle')],
  };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(window.location.pathname).toBe('/reports/bundle');
  expect(stream.close).toHaveBeenCalledOnce();
});

it('keeps historical reports open instead of redirecting them to the latest report', async () => {
  requestOverrides.original = {
    reports: [publishedReport('older'), publishedReport('newer')],
  };
  await mount('/reports/older');
  expect(window.location.pathname).toBe('/reports/older');
  expect(
    document.body.querySelector('a[href="/reports/older"]')?.getAttribute('aria-current'),
  ).toBe('page');
  expect(await click('a[href="/reports/newer"]')).toBe(true);
  expect(window.location.pathname).toBe('/reports/newer');
});

it('keeps Replay mounted across Worker view switches and binds a historical report to its own execution', async () => {
  requestOverrides.original = { attempts: [{ attemptId: 'latest', number: 2 }], reports: [publishedReport('older'), publishedReport('newer')] };
  await mount('/reports/older');
  const replay = document.body.querySelector("[data-ui~=replay-panel]");
  const tabs = document.body.querySelector('[aria-label="报告视图"]')!;
  const workerTab = Array.from(tabs.querySelectorAll('button')).find(button => button.textContent?.includes('Worker'))!;
  await act(async () => workerTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  expect(document.body.querySelector("[data-ui~=report-view-pane]")?.hasAttribute('hidden')).toBe(true);
  expect(document.body.querySelector("[data-ui~=report-worker-pane]")?.hasAttribute('hidden')).toBe(false);
  expect(document.body.querySelector("[data-ui~=replay-panel]")).toBe(replay);
  const testTab = Array.from(tabs.querySelectorAll('button')).find(button => button.textContent?.includes('测试回放'))!;
  await act(async () => testTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  expect(document.body.querySelector("[data-ui~=report-view-pane]")?.hasAttribute('hidden')).toBe(false);
  expect(document.body.querySelector("[data-ui~=replay-panel]")).toBe(replay);
  const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter(url => url.endsWith('/worker-timeline'));
  expect(calls).toContain('/api/requests/original/attempts/attempt-older/worker-timeline');
  expect(calls.some(url => url.includes('/latest/'))).toBe(false);
});

it('keeps diagnostics available when a run has no published report', async () => {
  requestOverrides.original = {
    state: 'infrastructure_failed',
    reports: [publishedReport('expired', 'expired')],
  };
  await mount('/requests/original');
  expect(window.location.pathname).toBe('/requests/original');
  expect(document.body.textContent).toContain('此运行没有已发布的报告');
  expect(
    document.body.querySelector("details[data-ui~=execution-attempts]")?.hasAttribute('open'),
  ).toBe(true);
});

it('exchanges share fragments in place and only requests shared report APIs', async () => {
  await mount('/share#one-time-token');
  expect(window.location.pathname).toBe('/shared/reports/bundle');
  expect(window.location.hash).toBe('');
  expect(document.body.textContent).toContain('只读报告分享');
  expect(document.body.querySelector('nav a')).toBeNull();
  const calls = vi.mocked(fetch).mock.calls;
  expect(
    calls.some(
      ([url, options]) =>
        url === '/api/share/exchange' &&
        options?.body === JSON.stringify({ token: 'one-time-token' }),
    ),
  ).toBe(true);
  expect(calls.some(([url]) => url === '/api/shared/reports/bundle')).toBe(
    true,
  );
  expect(
    calls.some(
      ([url]) =>
        url === '/api/me' ||
        url === '/api/workers' ||
        String(url).startsWith('/api/requests/') ||
        String(url).startsWith('/api/reports/'),
    ),
  ).toBe(false);
});

it('shows missing share credentials without a document reload', async () => {
  await mount('/share');
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
    '缺少授权信息',
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('returns from a not-found page through the router', async () => {
  await mount('/not-a-page');
  expect(document.body.textContent).toContain('页面不存在');
  expect(await click('main a[href="/"]')).toBe(true);
  expect(document.body.querySelector('h1')?.textContent).toBe('执行看板');
});


async function openSubmissionMenu() {
  const trigger = document.body.querySelector<HTMLButtonElement>('nav[aria-label="创建与提交"] button')!;
  await act(async () => trigger.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  return trigger;
}

it('opens project creation from the submission menu and project header', async () => {
  role = 'admin';
  await mount('/queue');
  const shell = document.body.querySelector("header[data-ui~=app-header]");
  await openSubmissionMenu();
  expect(document.body.querySelector('nav[aria-label="创建与提交"] a[href="/new"]')).not.toBeNull();
  const create = document.body.querySelector<HTMLAnchorElement>('nav[aria-label="创建与提交"] a[href^="/projects"]')!;
  expect(create.textContent).toContain('创建项目');
  await act(async () => create.click());
  expect(window.location.pathname).toBe('/projects');
  expect(window.location.search).not.toContain('createProject');
  expect(document.body.querySelector("header[data-ui~=app-header]")).toBe(shell);
  expect(document.body.querySelector('[data-ui~=project-page-heading]')).not.toBeNull();
  expect(document.body.querySelector('[data-ui~=project-sidebar]')).toBeNull();
  expect(shell?.querySelector('[data-ui~=project-switcher]')).not.toBeNull();
  expect(document.body.querySelector('[data-ui~=project-page-heading] [data-ui~=project-switcher]')).toBeNull();
  expect(document.body.querySelector('[role=dialog][data-state=open] h2')?.textContent).toBe('创建项目');
  const form = document.body.querySelector('[role=dialog] form')!;
  expect(form.querySelector('[aria-label="GitLab 仓库 URL"]')).not.toBeNull();
  await act(async () => document.body.querySelector<HTMLButtonElement>('[role=dialog] [aria-label="关闭对话框"]')!.click());
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
  const plus = document.body.querySelector<HTMLButtonElement>('[data-ui~=project-page-heading] [aria-label="创建项目"]')!;
  expect(plus.querySelector('svg')).not.toBeNull();
  expect(plus.textContent).toBe('创建项目');
  await act(async () => plus.click());
  expect(document.body.querySelector('[role=dialog][data-state=open] h2')?.textContent).toBe('创建项目');
});

it('keeps submit-test navigation available in the dropdown and hides creation for members', async () => {
  await mount('/projects');
  expect(document.body.querySelector('[data-ui~=project-page-heading] [aria-label="创建项目"]')).toBeNull();
  const trigger = await openSubmissionMenu();
  expect(document.body.querySelector('nav[aria-label="创建与提交"] a[href^="/projects"]')).toBeNull();
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await openSubmissionMenu();
  expect(await click('nav[aria-label="创建与提交"] a[href="/new"]')).toBe(true);
  expect(window.location.pathname).toBe('/new');
  expect(document.body.querySelector('nav[aria-label="创建与提交"] button')?.getAttribute('aria-expanded')).toBe('false');
});

it('reopens creation from the dropdown while already browsing projects', async () => {
  role = 'admin';
  await mount('/projects');
  for (let index = 0; index < 2; index++) {
    await openSubmissionMenu();
    await act(async () => document.body.querySelector<HTMLAnchorElement>('nav[aria-label="创建与提交"] a[href^="/projects"]')!.click());
    expect(document.body.querySelector('[role=dialog][data-state=open] h2')?.textContent).toBe('创建项目');
    expect(window.location.search).not.toContain('createProject');
    await act(async () => document.body.querySelector<HTMLButtonElement>('[role=dialog] [aria-label="关闭对话框"]')!.click());
  }
});

function seedProjects() {
  projects = ['first', 'second'].map(id => projectSchema.parse({ id, name: `${id} app`, repository: `https://git.example.com/${id}.git`, suites: { smoke: '*.test.ts' }, scenarios: ['clean'] }));
}

it('filters the header project switcher and closes it with Escape', async () => {
  seedProjects();
  await mount('/projects/first');
  const trigger = document.body.querySelector<HTMLButtonElement>('[data-ui~=project-switcher] button')!;
  await act(async () => trigger.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const search = document.body.querySelector<HTMLInputElement>('[aria-label="搜索项目"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'second');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.body.querySelectorAll('[data-ui~=project-list-item]')).toHaveLength(1);
  expect(document.body.querySelector('[data-ui~=project-list-item]')?.textContent).toContain('second app');
  await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.body.querySelector('[data-ui~=project-switcher-menu]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await act(async () => trigger.click());
  expect(document.body.querySelectorAll('[data-ui~=project-list-item]')).toHaveLength(2);
});

it('opens the project specified in a direct URL and keeps project navigation active', async () => {
  seedProjects();
  await mount('/projects/second');
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('second app');
  expect(document.body.querySelector('[data-ui~=project-sidebar]')).toBeNull();
  expect(document.body.querySelector('header[data-ui~=app-header] [data-ui~=project-switcher]')).not.toBeNull();
  await act(async () => document.body.querySelector<HTMLButtonElement>('[data-ui~=project-switcher] button')!.click());
  expect(document.body.querySelector('[data-ui~=project-list-item][aria-current="page"]')?.getAttribute('href')).toBe('/projects/second');
  expect(document.body.querySelector('nav[aria-label="主导航"] a[href="/projects"]')?.getAttribute('aria-current')).toBe('page');
  expect(document.body.querySelector('[data-ui~=project-page-heading] h1')?.textContent).toBe('测试用例');
  expect(document.body.querySelector('[role=tablist]')).toBeNull();
  expect(fetch).toHaveBeenCalledWith('/api/projects/second/status', expect.anything());
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/projects/first/'))).toBe(false);
  expect(await click('[data-ui~=project-list] a[href="/projects/first"]', { ctrlKey: true })).toBe(false);
  expect(window.location.pathname).toBe('/projects/second');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(React.createElement(App)));
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('second app');
});

it('selects the first project with a replace and restores selections through browser history', async () => {
  seedProjects();
  await mount('/queue');
  await openConfiguration();
  await click('nav a[href="/projects"]');
  expect(window.location.pathname).toBe('/projects/first');
  await act(async () => document.body.querySelector<HTMLButtonElement>('[data-ui~=project-switcher] button')!.click());
  await click('[data-ui~=project-list] a[href="/projects/second"]');
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('second app');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('second app');
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(window.location.pathname).toBe('/projects/first');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('first app');
  await act(async () => { window.history.forward(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('second app');
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(window.location.pathname).toBe('/queue');
});

it('shows a missing project without silently selecting another and allows recovery', async () => {
  seedProjects();
  await mount('/projects/missing');
  expect(window.location.pathname).toBe('/projects/missing');
  expect(document.body.textContent).toContain('项目不存在');
  expect(document.body.querySelector('[data-ui~=project-detail]')).toBeNull();
  await act(async () => document.body.querySelector<HTMLButtonElement>('[data-ui~=project-switcher] button')!.click());
  expect(document.body.querySelector('[data-ui~=project-list-item][aria-current]')).toBeNull();
  await click('[data-ui~=project-list] a[href="/projects/second"]');
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('second app');
});

it('consumes the creation flag on a selected project without losing its URL or draft', async () => {
  seedProjects();
  role = 'admin';
  await mount('/projects/second?createProject=true');
  expect(window.location.pathname).toBe('/projects/second');
  expect(window.location.search).toBe('');
  expect(document.body.querySelector('[role=dialog][data-state=open] h2')?.textContent).toBe('创建项目');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('second app');
});

it('keeps the creation dialog open when the project index resolves to a project URL', async () => {
  seedProjects();
  role = 'admin';
  await mount('/projects?createProject=true');
  expect(window.location.pathname).toBe('/projects/first');
  expect(window.location.search).toBe('');
  expect(document.body.querySelector('[role=dialog][data-state=open] h2')?.textContent).toBe('创建项目');
  expect(document.body.querySelector('[data-ui~=project-switcher] button')?.textContent).toBe('first app');
});
