// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/web/app.js';
import type { BoardRequest } from '../src/web/TestBoard.js';

let root: Root;
let container: HTMLDivElement;
const streams: Array<{ url: string; close: ReturnType<typeof vi.fn> }> = [];
let boardItems: BoardRequest[] = [];
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
      if (path === '/api/me') data = { name: 'Alice', role: 'member' };
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
      } else if (/^\/api\/(shared\/)?reports\/[^/]+$/.test(path)) {
        data = {
          id: path.split('/').pop(),
          requestId: 'original',
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
  const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>('nav button'))
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
  const link = container.querySelector<HTMLAnchorElement>(selector)!;
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
  const input = container.querySelector<HTMLInputElement>('#global-search')!;
  input.value = value;
  const event = new Event('submit', { bubbles: true, cancelable: true });
  await act(async () => {
    input.form!.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
}

it('handles top navigation in the current document and preserves the shell', async () => {
  await mount();
  const shell = container.querySelector('header.app-header');
  expect(shell).not.toBeNull();
  expect(shell?.querySelector('nav[aria-label="主导航"]')).not.toBeNull();
  expect(shell?.querySelector('#global-search')).not.toBeNull();
  expect(shell?.nextElementSibling).toBe(container.querySelector('main'));
  const initialMeCalls = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => url === '/api/me').length;
  expect(
    await click('nav a[href="/workers"]'),
    'internal links must prevent a full document navigation',
  ).toBe(true);
  expect(container.querySelector('h1')?.textContent).toBe('Worker 主机');
  expect(window.location.pathname).toBe('/workers');
  expect(container.querySelector('header.app-header')).toBe(shell);
  expect(container.querySelector('nav .configuration-active')?.textContent).toContain('配置');
  expect(container.querySelector('nav a[href="/workers"]')).toBeNull();
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/me'),
  ).toHaveLength(initialMeCalls);
  expect(await click('nav a[href="/queue"]')).toBe(true);
  expect(container.querySelector('main h1')?.textContent).toBe('测试任务');
  expect(container.querySelector('main h2')?.textContent).toBe('测试看板');
  expect(container.querySelector('main a[href="/new"]')).not.toBeNull();
});

it('keeps a single test tasks entry beside the logo and opens configuration with keyboard dismissal', async () => {
  await mount('/queue');
  const header = container.querySelector('header.app-header')!;
  const nav = header.querySelector('nav')!;
  expect(header.querySelector('.topbar')?.contains(nav)).toBe(true);
  expect(Array.from(nav.querySelectorAll('a')).map((link) => link.getAttribute('href')))
    .toEqual(['/queue']);
  expect(nav.querySelector('a[href="/queue"]')?.textContent).toBe('测试任务');
  expect(nav.querySelector('a[href="/queue"]')?.getAttribute('aria-current')).toBe('page');
  expect(nav.textContent).not.toMatch(/运行记录|测试队列/);
  expect(nav.textContent).not.toContain('概览');
  expect(header.querySelector('.brand')?.getAttribute('href')).toBe('/');
  const trigger = await openConfiguration();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  for (const url of ['/devices', '/workers', '/targets', '/reports']) {
    expect(nav.querySelector(`a[href="${url}"]`)).not.toBeNull();
  }
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(await click('header .brand')).toBe(true);
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
  const shell = container.querySelector('header.app-header');
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.value,
  ).toBe('first');
  await submitSearch('second search');
  expect(window.location.pathname).toBe('/queue');
  expect(new URLSearchParams(window.location.search).get('search')).toBe(
    'second search',
  );
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.value,
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
    container.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.value,
  ).toBe('first');
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.value,
  ).toBe('second search');
  expect(container.querySelector('header.app-header')).toBe(shell);
});

it.each([
  ['/queue', '测试任务', null],
  ['/reports', '测试报告', 'completed'],
  ['/runs', undefined, null],
])('opens %s directly with its own filters', async (path, title, state) => {
  await mount(path);
  expect(container.querySelector('h1')?.textContent).toBe(title);
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
    expect(Array.from(container.querySelectorAll('.test-column h3')).map((heading) => heading.textContent))
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

it('groups lifecycle cards, follows scheduling order and loads details only after opening a card', async () => {
  boardItems = [
    boardRequest('queued-new', 'queued'), boardRequest('queued-old', 'queued'),
    boardRequest('preparing', 'preparing'), boardRequest('finalizing', 'finalizing', 'passed'),
    boardRequest('passed', 'completed', 'passed'), boardRequest('failed', 'completed', 'failed'),
    boardRequest('broken', 'infrastructure_failed'), boardRequest('cancelled', 'cancelled'),
  ];
  await mount('/queue');
  const pending = container.querySelector('.test-column-pending')!;
  expect(Array.from(pending.querySelectorAll('a')).map((link) => link.getAttribute('href')))
    .toEqual(['/requests/queued-old', '/requests/queued-new']);
  expect(pending.textContent).toContain('排队第 1 位');
  expect(container.querySelectorAll('.test-column-running a')).toHaveLength(2);
  expect(container.querySelectorAll('.test-column-passed a')).toHaveLength(1);
  expect(container.querySelectorAll('.test-column-failed a')).toHaveLength(2);
  expect(container.querySelector('.test-column-other')?.textContent).toContain('已取消');
  expect(streams).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/requests/'))).toBe(false);
  expect(await click('.test-card[href="/requests/failed"]')).toBe(true);
  expect(window.location.pathname).toBe('/requests/failed');
  expect(streams[0].url).toBe('/api/requests/failed/events');
});

it('moves cards to their new column when the queue refreshes', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  boardItems = [boardRequest('moving', 'queued')];
  await mount('/queue');
  expect(container.querySelector('.test-column-pending a')).not.toBeNull();
  boardItems = [boardRequest('moving', 'preparing')];
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.querySelector('.test-column-pending a')).toBeNull();
  expect(container.querySelector('.test-column-running a')).not.toBeNull();
  boardItems = [boardRequest('moving', 'completed', 'passed')];
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.querySelector('.test-column-running a')).toBeNull();
  expect(container.querySelector('.test-column-passed a')).not.toBeNull();
});

it('paginates the board and returns to the first page when searching', async () => {
  boardItems = Array.from({ length: 26 }, (_, index) => boardRequest(`run-${index}`, 'completed', index % 2 ? 'failed' : 'passed'));
  await mount('/queue');
  expect(container.querySelectorAll('.test-card')).toHaveLength(25);
  expect(container.querySelector('.board-caption')?.textContent).toContain('本页 25 条 · 共 26 条');
  const next = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '下一页')!;
  await act(async () => next.click());
  expect(container.querySelectorAll('.test-card')).toHaveLength(1);
  expect(container.querySelector('.test-card')?.getAttribute('href')).toBe('/requests/run-25');
  const search = container.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'scenario-run-0');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelectorAll('.test-card')).toHaveLength(1);
  expect(container.querySelector('.test-card')?.getAttribute('href')).toBe('/requests/run-0');
  expect(container.querySelector('.pagination')?.textContent).toContain('第 1 / 1 页');
});

it('navigates to the new task after submission without replacing the shell', async () => {
  await mount('/new');
  const shell = container.querySelector('header.app-header');
  const input = container.querySelector<HTMLInputElement>('input[pattern]')!;
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
  expect(container.querySelector('h1')?.textContent).toContain('#created');
  expect(container.querySelector('header.app-header')).toBe(shell);
  const submission = vi
    .mocked(fetch)
    .mock.calls.find(
      ([url, options]) => url === '/api/requests' && options?.method === 'POST',
    )!;
  expect(JSON.parse(String(submission[1]?.body))).toEqual({
    targetId: 'app',
    suite: 'smoke',
    scenario: 'clean',
    commit: 'a'.repeat(40),
  });
});

it('opens dynamic details, reruns in place, and closes the previous event stream', async () => {
  await mount('/requests/original');
  const shell = container.querySelector('header.app-header');
  const stream = streams[0];
  expect(container.querySelector('.crumb a')?.textContent).toBe('测试任务');
  expect(container.querySelector('nav a[href="/queue"]')?.getAttribute('aria-current')).toBe('page');
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('重新运行'),
  )!;
  await act(async () => button.click());
  expect(window.location.pathname).toBe('/requests/rerun');
  expect(container.querySelector('h1')?.textContent).toContain('#rerun');
  expect(stream.close).toHaveBeenCalledOnce();
  expect(streams[1].url).toBe('/api/requests/rerun/events');
  expect(container.querySelector('header.app-header')).toBe(shell);
  await click('a[href="/queue"]');
  expect(streams[1].close).toHaveBeenCalledOnce();
});

it('opens report links in the same document', async () => {
  await mount('/reports/bundle');
  const shell = container.querySelector('header.app-header');
  expect(container.querySelector('h1')?.textContent).toBe('run');
  expect(container.querySelector('a[href="/requests/original"]')).toBeNull();
  expect(await click('a[href="/queue"]')).toBe(true);
  expect(window.location.pathname).toBe('/queue');
  expect(container.querySelector('header.app-header')).toBe(shell);
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
    expect(container.querySelector('h1')?.textContent).toBe('run');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.textContent).not.toContain('独立打开报告');
    expect(container.textContent).not.toContain('运行详情');
    expect(container.querySelector('a[href="/reports/older"]')).not.toBeNull();
    const shell = container.querySelector('header.app-header');
    const stream = streams.at(-1)!;
    const rerun = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('重新运行'),
    )!;
    await act(async () => rerun.click());
    expect(window.location.pathname).toBe('/requests/rerun');
    expect(container.querySelector('header.app-header')).toBe(shell);
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
    container.querySelector('a[href="/reports/older"]')?.getAttribute('aria-current'),
  ).toBe('page');
  expect(await click('a[href="/reports/newer"]')).toBe(true);
  expect(window.location.pathname).toBe('/reports/newer');
});

it('keeps diagnostics available when a run has no published report', async () => {
  requestOverrides.original = {
    state: 'infrastructure_failed',
    reports: [publishedReport('expired', 'expired')],
  };
  await mount('/requests/original');
  expect(window.location.pathname).toBe('/requests/original');
  expect(container.textContent).toContain('此运行没有已发布的报告');
  expect(
    container.querySelector('details.execution-attempts')?.hasAttribute('open'),
  ).toBe(true);
});

it('exchanges share fragments in place and only requests shared report APIs', async () => {
  await mount('/share#one-time-token');
  expect(window.location.pathname).toBe('/shared/reports/bundle');
  expect(window.location.hash).toBe('');
  expect(container.textContent).toContain('只读报告分享');
  expect(container.querySelector('nav a')).toBeNull();
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
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '缺少授权信息',
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('returns from a not-found page through the router', async () => {
  await mount('/not-a-page');
  expect(container.textContent).toContain('页面不存在');
  expect(await click('main a[href="/"]')).toBe(true);
  expect(container.querySelector('h1')?.textContent).toBe('概览');
});
