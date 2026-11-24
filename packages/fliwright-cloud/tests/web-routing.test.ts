// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/web/app.js';
import { testColumn, type BoardRequest } from '../src/web/TestBoard.js';
import { boardColumns, boardBatch } from '../src/request-board.js';
import { projectSchema, type ExecutionWorker, type Project } from '@fliwright/cloud-protocol';
import type { WorkerStatusResponse } from '../src/catalog-scan-status.js';

let root: Root;
let container: HTMLDivElement;
const streams: Array<{ url: string; close: ReturnType<typeof vi.fn> }> = [];
let boardItems: BoardRequest[] = [];
let role = 'member';
let projects: Project[] = [];
let workers: WorkerStatusResponse[] = [];
let workerStatusError = false;
let submissionError = '';
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
  workers = [];
  workerStatusError = false;
  submissionError = '';
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
      else if (path === '/api/workers') {
        if (workerStatusError) return { ok: false, json: async () => ({ error: 'Worker 状态加载失败' }) };
        data = workers;
      }
      else if (/^\/api\/projects\/[^/]+\/status$/.test(path)) data = { ready: false, blockers: [], latestScan: null };
      else if (path === '/api/targets') data = projects.length ? projects.map(p => ({ ...p, suites: Object.keys(p.suites) })) : [target];
      else if (path === '/api/reports') data = { items:[],hasMore:false };
      else if (path === '/api/board') {
        const matching = boardItems.filter(r => (!url.searchParams.get('targetId') || r.input.targetId===url.searchParams.get('targetId')) && (!url.searchParams.get('search') || r.id.includes(url.searchParams.get('search')!)));
        const lanes = boardColumns.map(lane => matching.filter(r => testColumn(r)===lane));
        data = {items: lanes.flatMap((items,i) => items.slice(0,Number(url.searchParams.get(boardColumns[i]) ?? boardBatch))),totals:Object.fromEntries(boardColumns.map((id,i) => [id,lanes[i].length])),queue:boardItems.filter(r=>r.state==='queued').map(r=>r.id).reverse()};
      }
      else if (path === '/api/operations')
        data = { storage: { freeBytes: 0, reservedBytes: 0 } };
      else if (path === '/api/share/exchange') {
        expect(window.location.hash).toBe('');
        data = { url: '/shared/reports/bundle' };
      } else if (path === '/api/requests' && options?.method === 'POST') {
        if (submissionError) return { ok: false, json: async () => ({ error: submissionError }) };
        data = { id: 'created' };
      } else if (path.endsWith('/rerun') && options?.method === 'POST')
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

async function openSubmission() {
  const trigger = document.querySelector<HTMLButtonElement>('header button[aria-label="提交测试"]')!;
  await act(async () => trigger.click());
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('新建测试任务');
  return trigger;
}

async function enterSubmissionCommit(commit: string) {
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[pattern]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, commit);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

async function openConfiguration() {
  const trigger = document.body.querySelector<HTMLButtonElement>('nav button[aria-label="更多"]')!;
  expect(trigger).toBeDefined();
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    await act(async () => trigger.click());
  }
  return trigger;
}

async function click(selector: string, modifiers: MouseEventInit = {}) {
  if (/^nav a\[href="\/(workers|devices|overview)"\]/.test(selector)) {
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

function boardHeaderFacts() {
  const labels = document.querySelectorAll('header dl[aria-label="看板概况"] dt');
  return Object.fromEntries(Array.from(labels, label => [label.textContent, label.nextElementSibling?.textContent]));
}

it('shows the startup alert and opens Worker pairing for administrators', async () => {
  role = 'admin';
  await mount();

  const alert = '[data-ui="worker-connection-alert"][role="alert"]';
  expect(document.querySelector(alert)?.textContent).toContain('暂无正常连接的 Worker');
  expect(document.querySelector(`${alert} a`)?.textContent).toBe('设置 Worker');
  expect(await click(`${alert} a`)).toBe(true);
  expect(window.location.pathname).toBe('/workers');
  expect(document.querySelector('main')?.textContent).toContain('添加 Worker 主机');
  expect(document.querySelector(`${alert} a`)).toBeNull();
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workers')).toHaveLength(1);
});

it.each(['member', 'operator'])('keeps host actions and diagnostics scoped to the %s role', async currentRole => {
  role = currentRole;
  workers = [{ id: 'mac', health: 'unseen', seenAt: 0, paused: false, slots: [] }];
  await mount('/workers');
  const list = document.querySelector('[aria-label="主机列表"]')!;
  expect(list.querySelector('a')?.getAttribute('href')).toBe('/devices?worker=mac');
  expect(list.textContent).toContain('尚未连接');
  expect(list.textContent?.includes('暂停调度')).toBe(currentRole === 'operator');
  expect(list.textContent).not.toContain('服务诊断与日志');
  const details = list.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  await act(async () => details.click());
  expect(list.textContent).toContain('设备与槽位');
  expect(list.textContent?.includes('服务诊断与日志')).toBe(currentRole === 'operator');
  expect(document.querySelector('main')?.textContent).not.toContain('配对记录');
});

it('distinguishes a missing diagnostics heartbeat from an online host and omits server storage', async () => {
  role = 'operator';
  const receivedAt = Date.UTC(2026, 10, 23, 6, 57, 46);
  workers = [{ id: 'leo-macbook', health: 'healthy', seenAt: receivedAt + 36000, paused: false, slots: [],
    service: { status: 'unreachable', receivedAt, sessionId: 'session', activeSessions: 0,
      process: { pid: 123, nodeVersion: 'v26.3.0', startedAt: new Date(receivedAt).toISOString(), uptimeMs: 5000, rssBytes: 128 * 1024 ** 2, eventLoopLagMs: 7, components: { catalog: 'running' } } } }];
  await mount('/workers');
  const list = document.querySelector('[aria-label="主机列表"]')!;
  expect(list.textContent).toContain('在线');
  expect(list.textContent).toContain('服务诊断心跳超时');
  await act(async () => list.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(list.textContent).toContain('超过 35 秒未收到服务诊断心跳');
  expect(list.textContent).toContain('PID 123 · v26.3.0');
  expect(list.textContent).toContain('128.0 MiB · 7 ms');
  expect(list.textContent).toContain('测试用例扫描 · 运行中');
  expect(document.querySelector('main')?.textContent).not.toContain('报告存储');
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/operations')).toBe(false);
});

it('shows scan assignments, the current scan and occupied slots in expanded host details', async () => {
  seedProjects();
  workers = [{ id: 'mac', health: 'healthy', seenAt: 1000, paused: false, catalogScannerConnected: true,
    projectIds: ['first'], slots: [{ id: 'ios', deviceId: 'phone', targets: ['first'], state: 'busy', generation: 2, attemptId: 'attempt-1' }],
    activeCatalogScan: { scanId: 'scan-1', projectId: 'first', status: 'running', commit: 'a'.repeat(40), configRevision: 1, createdAt: 100, updatedAt: 1000 } }];
  await mount('/workers');
  const list = document.querySelector('[aria-label="主机列表"]')!;
  await act(async () => list.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  const scanner = list.querySelector('[aria-label="扫描服务"]')!;
  expect(scanner.textContent).toContain('绑定项目first app');
  expect(scanner.querySelector('a')?.getAttribute('href')).toBe('/projects/first?view=scans');
  expect(scanner.textContent).toContain('最近扫描心跳');
  expect(list.querySelector('[aria-label="设备与槽位"]')?.textContent).toContain('当前执行 attempt-1');
});

it('keeps host details usable when the API omits scanner and process status', async () => {
  workers = [{ id: 'mac', health: 'healthy', seenAt: 1000, paused: false, slots: [],
    service: { status: 'healthy', receivedAt: 1000, sessionId: 'session', activeSessions: 1 } }];
  await mount('/workers');
  const list = document.querySelector('[aria-label="主机列表"]')!;
  await act(async () => list.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(list.querySelector('[aria-label="扫描服务"]')?.textContent).toContain('绑定项目暂无数据');
  expect(list.querySelector('[aria-label="扫描服务"]')?.textContent).toContain('连接状态暂无数据');
  expect(list.querySelector('[aria-label="扫描服务"]')?.textContent).toContain('当前扫描暂无数据');
  expect(list.querySelector('[aria-label="服务运行状态"]')?.textContent).toContain('服务运行中');
});

it('updates the alert as Worker status changes without reloading the page', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const worker: ExecutionWorker = { id: 'mac', health: 'healthy', paused: true, seenAt: 1, slots: [] };
  workers = [worker];
  await mount('/overview');

  const alert = '[data-ui="worker-connection-alert"]';
  expect(document.querySelector(alert)).toBeNull();
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workers')).toHaveLength(1);

  workers = [{ ...worker, health: 'offline' }];
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.querySelector(`${alert} a`)?.textContent).toBe('查看 Worker 主机');

  workers = [...workers, { ...worker, id: 'mac-replacement' }];
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.querySelector(alert)).toBeNull();
});

it('waits for a successful worker status check before showing the alert', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  workerStatusError = true;
  await mount();

  const alert = '[data-ui="worker-connection-alert"]';
  expect(document.querySelector(alert)).toBeNull();

  workerStatusError = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.querySelector(alert)).not.toBeNull();
});

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
  expect(document.body.querySelector('nav [data-ui~=configuration-active]')?.getAttribute('aria-label')).toBe('更多');
  expect(document.body.querySelector('.workspace-nav a[href="/workers"]')).toBeNull();
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/me'),
  ).toHaveLength(initialMeCalls);
  expect(await click('nav a[href="/queue"]')).toBe(true);
  expect(document.body.querySelector('main h1')?.textContent).toBe('执行看板');
  expect(document.body.querySelectorAll('button[aria-label="提交测试"]')).toHaveLength(1);
  expect(shell?.querySelector('button[aria-label="提交测试"]')).not.toBeNull();
});

it('keeps board and cases in the single top navigation and opens configuration with keyboard dismissal', async () => {
  await mount('/queue');
  const header = document.body.querySelector("header[data-ui~=app-header]")!;
  const nav = header.querySelector('nav')!;
  expect(header.querySelector("[data-ui~=topbar]")?.contains(nav)).toBe(true);
  expect(Array.from(nav.querySelectorAll('a')).map((link) => link.getAttribute('href')))
    .toEqual(['/queue', '/projects', '/reports']);
  expect(nav.querySelector('a[href="/queue"]')?.getAttribute('aria-label')).toBe('执行看板');
  expect(nav.querySelector('a[href="/projects"]')?.getAttribute('aria-label')).toBe('项目管理');
  expect(nav.querySelector('a[href="/queue"]')?.getAttribute('aria-current')).toBe('page');
  expect(nav.textContent).not.toMatch(/运行记录|测试队列/);
  expect(nav.textContent).not.toContain('概览');
  expect(header.querySelector("[data-ui~=brand]")?.getAttribute('href')).toBe('/');
  const trigger = await openConfiguration();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  for (const url of ['/overview', '/devices', '/workers', '/projects', '/reports']) {
    expect(header.querySelector(`a[href="${url}"]`)).not.toBeNull();
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
  ['/', '执行看板', '/api/board?'],
  ['/overview', '运行概览', '/api/requests?'],
  ['/queue', '执行看板', '/api/board?'],
  ['/reports', '测试报告', '/api/reports?'],
  ['/runs', '执行看板', '/api/board?'],
])('opens %s directly with its own collection', async (path, title, endpoint) => {
  await mount(path);
  expect(document.body.querySelector('h1')?.textContent).toBe(title);
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).startsWith(endpoint))).toBe(true);
});

it('keeps lifecycle columns on the board and published reports in their own directory', async () => {
  await mount('/queue');
  for (const path of ['/reports', '/queue']) {
    await click(`nav a[href="${path}"]`);
    expect(Array.from(document.body.querySelectorAll("[data-ui~=test-column] h3")).map((heading) => heading.textContent))
      .toEqual(path==='/reports'?[]:['待测试', '测试中', '已成功', '已失败']);
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
  expect(boardHeaderFacts()['通过率']).toBe('—');
  expect(document.body.querySelector("[data-ui~=test-column-pending] a")).not.toBeNull();
  boardItems = [boardRequest('moving', 'preparing')];
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.body.querySelector("[data-ui~=test-column-pending] a")).toBeNull();
  expect(document.body.querySelector("[data-ui~=test-column-running] a")).not.toBeNull();
  boardItems = [boardRequest('moving', 'completed', 'passed')];
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.body.querySelector("[data-ui~=test-column-running] a")).toBeNull();
  expect(document.body.querySelector("[data-ui~=test-column-passed] a")).not.toBeNull();
  expect(boardHeaderFacts()['通过率']).toBe('100%');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/board?'))).toHaveLength(3);
});

it('loads more in a single column and searches the full collection', async () => {
  let intersect: ((node:Element)=>void) | undefined;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = node => callback([{target:node,isIntersecting:true} as IntersectionObserverEntry],this as unknown as IntersectionObserver); }
    observe() {} unobserve() {} disconnect() {}
  });
  boardItems = Array.from({ length: 40 }, (_, index) => boardRequest(`run-${index}`, 'completed', index % 2 ? 'failed' : 'passed'));
  await mount('/queue');
  expect(document.body.querySelectorAll('[data-lane=passed] a')).toHaveLength(boardBatch);
  expect(document.body.querySelector('[data-ui~=test-column-passed] [data-ui=test-column-count]')?.textContent).toBe('20');
  expect(boardHeaderFacts()).toMatchObject({ '任务总数': '40', '通过率': '50%' });
  await act(async()=>intersect!(document.querySelector('[data-lane=passed] li:last-child')!));
  expect(document.body.querySelectorAll('[data-lane=passed] a')).toHaveLength(20);
  expect(document.body.querySelectorAll('[data-lane=failed] a')).toHaveLength(boardBatch);
  const search = document.body.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'run-39');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.body.querySelectorAll("[data-ui~=test-card]")).toHaveLength(1);
  expect(document.body.querySelector("[data-ui~=test-card]")?.getAttribute('href')).toBe('/requests/run-39');
  expect(document.body.querySelector("[data-ui~=pagination]")).toBeNull();
  expect(boardHeaderFacts()).toMatchObject({ '匹配任务': '1', '通过率': '0%' });
  await submitSearch('missing-task');
  expect(boardHeaderFacts()).toMatchObject({ '匹配任务': '0', '通过率': '—' });
});

it('keeps the filtered board open after submission and links to the queued task', async () => {
  await mount('/queue?search=smoke&targetId=app');
  const shell = document.body.querySelector("header[data-ui~=app-header]");
  const board = document.querySelector('.queue-lanes');
  const scroll = board!.querySelector<HTMLElement>('[data-ui="test-board-scroll"]')!;
  scroll.scrollLeft = 90;
  await openSubmission();
  const input = await enterSubmissionCommit('a'.repeat(40));
  await act(async () => {
    input.form!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(window.location.pathname + window.location.search).toBe('/queue?search=smoke&targetId=app');
  expect(document.querySelector('.queue-lanes')).toBe(board);
  expect(scroll.scrollLeft).toBe(90);
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
  const toast = await vi.waitUntil(() => document.querySelector('[data-sonner-toast]'));
  expect(toast.textContent).toContain('已加入队列');
  expect(toast.querySelector('button')?.textContent).toBe('查看任务');
  await act(async () => toast.querySelector('button')!.click());
  expect(window.location.pathname).toBe('/requests/created');
  expect(document.body.querySelector('h1')?.textContent).toContain('#created');
});

it('keeps a failed submission editable and restores focus when dismissed', async () => {
  submissionError = '测试配置暂不可用';
  await mount('/queue');
  const trigger = await openSubmission();
  const input = await enterSubmissionCommit('b'.repeat(40));
  const scenario = input.form!.querySelectorAll('select')[2];
  await act(async () => {
    scenario.value = 'clean';
    scenario.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(submissionError);
  expect(input.value).toBe('b'.repeat(40));
  expect(scenario.value).toBe('clean');
  expect(input.form!.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(false);
  await act(async () => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const attempts = vi.mocked(fetch).mock.calls.filter(([url, options]) => url === '/api/requests' && options?.method === 'POST');
  expect(attempts).toHaveLength(2);
  const keys = attempts.map(([, options]) => new Headers(options?.headers).get('idempotency-key'));
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await vi.waitFor(() => expect(document.activeElement === trigger).toBe(true));
  expect(window.location.pathname).toBe('/queue');
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

async function openReportRunPanel(value: string) {
  const menu = document.querySelector<HTMLSelectElement>('[data-ui~=replay-header] select[aria-label="运行"]')!;
  await act(async () => {
    menu.focus();
    menu.value = value;
    menu.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return document.querySelector('[role="dialog"]')!;
}

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
    const dialog = await openReportRunPanel('run');
    expect(dialog.querySelector('a[href="/reports/older"]')).not.toBeNull();
    const shell = document.body.querySelector("header[data-ui~=app-header]");
    const rerun = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('重新运行'),
    )!;
    await act(async () => rerun.click());
    expect(window.location.pathname).toBe('/requests/rerun');
    expect(document.body.querySelector("header[data-ui~=app-header]")).toBe(shell);
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
  await openReportRunPanel('run');
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
  const dialog = await openReportRunPanel('worker');
  expect(dialog.textContent).toContain('Worker 执行');
  expect(document.body.querySelector('[data-ui~=replay-panel]')).toBe(replay);
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!.click());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.querySelector('[data-ui~=replay-panel]')).toBe(replay);
  const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter(url => url.endsWith('/worker-timeline'));
  expect(calls).toContain('/api/requests/original/attempts/attempt-older/worker-timeline');
  expect(calls.some(url => url.includes('/latest/'))).toBe(false);
});

it('opens sharing and run activity from the single replay header', async () => {
  await mount('/reports/bundle');
  const header = document.querySelector('[data-ui~=replay-header]')!;
  const share = Array.from(header.querySelectorAll('button')).find(button => button.textContent === '分享报告')!;
  expect(document.querySelector('[data-ui~=report-header]')).toBeNull();
  expect(document.querySelector('[aria-label="当前步骤证据"]')?.textContent).toBe('步骤详情步骤日志源码步骤产物');
  await act(async () => share.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('生成分享链接');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!.click());
  const dialog = await openReportRunPanel('events');
  expect(dialog.querySelector('[aria-label="筛选运行动态"]')).not.toBeNull();
  const stream = streams.at(-1)!;
  expect(stream.url).toBe('/api/requests/original/events');
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!.click());
  expect(stream.close).toHaveBeenCalledOnce();
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


async function openProjectMenu() {
  const trigger = document.body.querySelector<HTMLButtonElement>('[data-ui="project-switcher"] button')!;
  await act(async () => trigger.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  return trigger;
}

it('opens project creation from the project switcher and directory', async () => {
  role = 'admin';
  await mount('/queue');
  const shell = document.body.querySelector("header[data-ui~=app-header]");
  await openProjectMenu();
  expect(document.body.querySelector('header button[aria-label="提交测试"]')).not.toBeNull();
  const create = document.body.querySelector<HTMLAnchorElement>('[data-ui="project-switcher-menu"] a[href*="createProject"]')!;
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

it('keeps submission one click away and hides project creation for members', async () => {
  await mount('/projects');
  expect(document.body.querySelector('[data-ui~=project-page-heading] [aria-label="创建项目"]')).toBeNull();
  const trigger = await openProjectMenu();
  expect(document.body.querySelector('[data-ui="project-switcher-menu"] a[href*="createProject"]')).toBeNull();
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await openSubmission();
  expect(window.location.pathname).toBe('/projects');
  expect(document.body.querySelector('[data-ui="project-switcher"] button')?.getAttribute('aria-expanded')).toBe('false');
});

it('reopens creation from the dropdown while already browsing projects', async () => {
  role = 'admin';
  await mount('/projects');
  for (let index = 0; index < 2; index++) {
    await openProjectMenu();
    await act(async () => document.body.querySelector<HTMLAnchorElement>('[data-ui="project-switcher-menu"] a[href*="createProject"]')!.click());
    expect(document.body.querySelector('[role=dialog][data-state=open] h2')?.textContent).toBe('创建项目');
    expect(window.location.search).not.toContain('createProject');
    await act(async () => document.body.querySelector<HTMLButtonElement>('[role=dialog] [aria-label="关闭对话框"]')!.click());
  }
});

function seedProjects() {
  projects = ['first', 'second'].map(id => projectSchema.parse({ id, name: `${id} app`, repository: `https://git.example.com/${id}.git`, suites: { smoke: '*.test.ts' }, scenarios: ['clean'] }));
}

it('scopes the board, totals, management and submission to the project picked in the header', async () => {
  seedProjects();
  boardItems = [boardRequest('run-1', 'queued'), boardRequest('run-2', 'completed', 'passed')];
  boardItems.forEach((request, index) => { request.input.targetId = projects[index].id; });
  await mount('/queue?search=run');
  expect(boardHeaderFacts()).toEqual({ '项目': '2', '测试套件': '2', '匹配任务': '2', '通过率': '100%' });
  await openProjectMenu();
  await click('[data-ui="project-list-item"][href*="second"]');
  expect(new URLSearchParams(window.location.search).get('search')).toBe('run');
  expect(new URLSearchParams(window.location.search).get('targetId')).toBe('second');
  expect(Array.from(document.querySelectorAll('.execution-card'), card => card.getAttribute('href'))).toEqual(['/requests/run-2']);
  expect(boardHeaderFacts()).toEqual({ '默认分支': 'main', '测试套件': '1', '匹配任务': '1', '通过率': '100%' });
  expect(document.querySelector('footer[aria-label="看板状态"]')?.textContent).not.toMatch(/匹配任务|通过率/);
  expect(document.querySelector('.workspace-nav a[aria-label="项目管理"]')?.getAttribute('href')).toBe('/projects/second');
  await openSubmission();
  const select = document.querySelector<HTMLSelectElement>('[role="dialog"] form select')!;
  expect(select.value).toBe('second');
  await act(async () => {
    select.value = 'first';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(select.value).toBe('first');
  expect(window.location.pathname).toBe('/queue');
  expect(new URLSearchParams(window.location.search).get('targetId')).toBe('second');
  expect(boardHeaderFacts()).toMatchObject({ '匹配任务': '1', '通过率': '100%' });
});

it('preserves the section when switching projects by keyboard and clears project-specific filters', async () => {
  seedProjects();
  await mount('/projects/first?view=scans&v=first-version&q=old');
  const trigger = await openProjectMenu();
  const input = document.querySelector<HTMLInputElement>('[role="combobox"][aria-label="搜索项目"]')!;
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(window.location.pathname).toBe('/projects/second');
  expect(window.location.search).toBe('?view=scans');
  expect(document.activeElement).toBe(trigger);
  expect(document.querySelector('[aria-label="项目分区"] [data-selected="true"]')?.textContent).toBe('扫描记录');
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(window.location.pathname).toBe('/projects/first');
  expect(new URLSearchParams(window.location.search).get('v')).toBe('first-version');
});

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
  expect(document.body.querySelector('[data-ui~=project-switcher] button strong')?.textContent).toBe('second app');
  expect(document.body.querySelector('header[data-ui~=app-header] [data-ui~=project-switcher]')).not.toBeNull();
  await act(async () => document.body.querySelector<HTMLButtonElement>('[data-ui~=project-switcher] button')!.click());
  expect(document.body.querySelector('[data-ui~=project-list-item][aria-current="page"]')?.getAttribute('href')).toBe('/projects/second');
  expect(document.body.querySelector('nav[aria-label="主导航"] a[href="/projects/second"]')?.getAttribute('aria-current')).toBe('page');
  expect(document.body.querySelector('[data-ui~=project-page-heading] h1')?.textContent).toBe('second app · 测试用例');
  expect(document.body.querySelector('[role=tablist]')).toBeNull();
  expect(fetch).toHaveBeenCalledWith('/api/projects/second/status', expect.anything());
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/projects/first/'))).toBe(false);
  expect(await click('[data-ui~=project-list] a[href="/projects/first"]', { ctrlKey: true })).toBe(false);
  expect(window.location.pathname).toBe('/projects/second');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(React.createElement(App)));
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button strong')?.textContent).toBe('second app');
});

it('opens the directory and restores project selections through browser history', async () => {
  seedProjects();
  await mount('/queue');
  await click('nav a[href="/projects"]');
  expect(window.location.pathname).toBe('/projects');
  await click('.project-listing a[href="/projects/first"]');
  expect(window.location.pathname).toBe('/projects/first');
  await act(async () => document.body.querySelector<HTMLButtonElement>('[data-ui~=project-switcher] button')!.click());
  await click('[data-ui~=project-list] a[href="/projects/second"]');
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button strong')?.textContent).toBe('second app');
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(window.location.pathname).toBe('/projects/first');
  expect(document.body.querySelector('[data-ui~=project-switcher] button strong')?.textContent).toBe('first app');
  await act(async () => { window.history.forward(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button strong')?.textContent).toBe('second app');
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(window.location.pathname).toBe('/projects');
});

it('shows a missing project without silently selecting another and allows recovery', async () => {
  seedProjects();
  await mount('/projects/missing');
  expect(window.location.pathname).toBe('/projects/missing');
  expect(document.body.textContent).toContain('项目不存在');
  expect(document.body.querySelector('[data-ui~=project-detail]')).toBeNull();
  await click('main a[href="/projects"]');
  await click('.project-listing a[href="/projects/second"]');
  expect(window.location.pathname).toBe('/projects/second');
  expect(document.body.querySelector('[data-ui~=project-switcher] button strong')?.textContent).toBe('second app');
});

it('consumes the creation flag on a selected project without losing its URL or draft', async () => {
  seedProjects();
  role = 'admin';
  await mount('/projects/second?createProject=true');
  expect(window.location.pathname).toBe('/projects/second');
  expect(window.location.search).toBe('');
  expect(document.body.querySelector('[role=dialog][data-state=open] h2')?.textContent).toBe('创建项目');
  expect(document.body.querySelector('[data-ui~=project-switcher] button strong')?.textContent).toBe('second app');
});

it('keeps the creation dialog on the project directory', async () => {
  seedProjects();
  role = 'admin';
  await mount('/projects?createProject=true');
  expect(window.location.pathname).toBe('/projects');
  expect(window.location.search).toBe('');
  expect(document.body.querySelector('[role=dialog][data-state=open] h2')?.textContent).toBe('创建项目');
  expect(document.body.querySelectorAll('.project-row')).toHaveLength(2);
});
