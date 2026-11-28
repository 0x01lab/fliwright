// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCloudRouter } from '../src/web/app.js';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { projectSchema } from '@fliwright/cloud-protocol';

function RoutedProjects() {
  const [router] = React.useState(() => createCloudRouter(createMemoryHistory({ initialEntries: ['/projects/app/testcases'] })));
  return React.createElement(RouterProvider, { router });
}

let root: Root;
let container: HTMLDivElement;
let submitted: Record<string, unknown> | undefined;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  submitted = undefined;
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    if (options?.method === 'POST') submitted = JSON.parse(String(options.body));
    return { ok: true, json: async () => path === '/api/me' ? { role: 'admin' } : [] };
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(RoutedProjects)));
  await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="创建项目"]')!.click());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function fill(label: string, value: string) {
  const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('creates a project from a URL with inferred name and collapsed optional defaults', async () => {
  const form = document.body.querySelector('[role=dialog] form')!;
  expect(form.querySelector('input')?.getAttribute('aria-label')).toBe('GitLab 仓库 URL');
  expect(form.querySelector('input[aria-label="项目 ID"]')).toBeNull();
  expect(form.querySelector('details')?.open).toBe(false);
  expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  await fill('GitLab 仓库 URL', 'https://gitlab.example.com/team/subgroup/my-app.git/');
  expect(form.querySelector<HTMLInputElement>('input[aria-label="项目名称"]')?.value).toBe('my-app');
  expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(submitted).toMatchObject({
    name: 'my-app', repository: 'https://gitlab.example.com/team/subgroup/my-app.git',
    defaultBranch: 'main', projectPath: '.', entry: 'lib/main.dart',
    suites: {}, suiteMode: 'directories', scenarios: [],
  });
  for (const field of ['id', 'configRevision', 'webhookSecretDigest', 'webhookStatus', 'autoRun']) {
    expect(submitted).not.toHaveProperty(field);
  }
  expect(document.body.querySelector('[role=dialog] form')).toBeNull();
  expect(document.querySelector('[aria-label^="操作通知"] [data-sonner-toast]')?.textContent).toContain('项目配置已保存。');
});

it('keeps typed line breaks in Flutter parameters and sends one argument per line', async () => {
  await fill('GitLab 仓库 URL', 'https://gitlab.example.com/team/app.git');
  const form = document.body.querySelector('[role=dialog] form')!;
  form.querySelector('details')!.open = true;
  const input = form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Flutter 参数"]')!;
  const change = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await change('--flavor');
  await change('--flavor\n');
  expect(input.value).toBe('--flavor\n');
  const args = ['--flavor', 'dev', '--dart-define', 'EXIO_ENV=dev', '--dart-define-from-file=.env/sentry.dev.json'];
  await change(`${args.join('\n')}\n`);
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submitted?.flutterArgs).toEqual(args);
});

it('updates inferred names, preserves custom names, and blocks invalid project URLs', async () => {
  await fill('GitLab 仓库 URL', 'git@gitlab.example.com:team/first.git');
  await fill('GitLab 仓库 URL', 'https://gitlab.example.com/team/second');
  const name = () => document.body.querySelector<HTMLInputElement>('input[aria-label="项目名称"]')!.value;
  expect(name()).toBe('second');
  await act(async () => { document.body.querySelector('details')!.open = true; });
  await fill('项目名称', '自定义名称');
  await fill('GitLab 仓库 URL', 'https://gitlab.example.com/team/third');
  expect(name()).toBe('自定义名称');
  await fill('项目名称', '');
  expect(name()).toBe('third');
  await fill('GitLab 仓库 URL', 'https://gitlab.example.com/team/third/-/issues');
  expect(document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('完整的 GitLab 项目地址');
  expect(document.body.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
});

it('runs cases directly by default and offers repository scenarios as optional preparation', async () => {
  const project = projectSchema.parse({ id: 'app', name: 'App', repository: 'https://git.example.com/app.git', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] });
  const catalog = { catalogId: 'scan', commit: 'a'.repeat(40), configRevision: 1, status: 'ready', createdAt: 1, scenarios: [] as Array<{ name: string }>, suites: [{ id: 'smoke', cases: [{ caseId: 'case', file: 'proof.test.ts', titlePath: ['discovered case'], duplicateIndex: 0 }] }] };
  vi.mocked(fetch).mockImplementation(async (path) => ({ ok: true, json: async () => {
    if (path === '/api/projects') return [project];
    if (path === '/api/me') return { role: 'member' };
    if (String(path).endsWith('/status')) return { ready: true, blockers: [], latestScan: null };
    if (String(path).endsWith('/catalogs')) return [catalog];
    if (String(path).endsWith('/case-runs')) return { catalogId: catalog.catalogId, items: [{ suite: 'smoke', caseId: 'case', id: 'previous-case-run', status: 'failed', createdAt: 2 }] };
    if (String(path).startsWith('/api/requests')) return { items: [] };
    return [];
  } }) as Response);
  const showCases = async (key: string) => {
    await act(async () => root.render(React.createElement(RoutedProjects, { key })));
  };
  await showCases('empty');
  expect(document.body.textContent).toContain('discovered case');
  expect(document.body.querySelector<HTMLButtonElement>('.case-ticket')?.disabled).toBe(false);
  await act(async () => document.body.querySelector<HTMLButtonElement>('.case-ticket')!.click());
  expect(document.querySelector('[role=dialog] a[href="/requests/previous-case-run?targetId=app"]')).not.toBeNull();
  await clickText('运行用例');
  expect(document.body.querySelector<HTMLSelectElement>('select[aria-label="运行场景"]')?.value).toBe('');
  expect(document.body.querySelector<HTMLButtonElement>('[role=dialog] button[type="submit"]')?.disabled).toBe(false);
  await act(async () => document.body.querySelector('[role=dialog] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const direct = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).endsWith('/requests') && options?.method === 'POST')!;
  expect(JSON.parse(String(direct[1]?.body))).not.toHaveProperty('scenario');
  vi.mocked(fetch).mockClear();
  catalog.scenarios = [{ name: 'guest' }];
  await showCases('guest');
  const run = document.body.querySelector<HTMLButtonElement>('.case-ticket')!;
  expect(run.disabled).toBe(false);
  await act(async () => run.click());
  await clickText('运行用例');
  expect(document.body.querySelector('[role=dialog][data-state=open]')).not.toBeNull();
  const select = document.body.querySelector<HTMLSelectElement>('select[aria-label="运行场景"]')!;
  expect([...select.options].map(option => option.value)).toEqual(['', 'guest']);
  expect(select.value).toBe('');
  await act(async () => { select.value = 'guest'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => document.body.querySelector('[role=dialog] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const call = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).endsWith('/requests') && options?.method === 'POST')!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ projectId: 'app', commit: catalog.commit, catalogId: 'scan', scenario: 'guest', mode: 'case', suite: 'smoke', caseId: 'case' });
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
});

it('shows the scanned source and latest execution for the selected case and version', async () => {
  const project = projectSchema.parse({ id: 'app', name: 'App', repository: 'ssh://git@git.example.com:2222/team/mobile/app.git', projectPath: 'apps/My App', suites: { smoke: '*.test.ts' } });
  const file = '.fliwright/tests/cooldown #1.test.ts';
  const first = { caseId: 'case-1', file, titlePath: ['Cooldown', 'expired'], duplicateIndex: 0 };
  const second = { ...first, caseId: 'case-2', duplicateIndex: 1 };
  const createdAt = Date.UTC(2026, 10, 25, 5, 30);
  const submittedAt = createdAt + 60_000;
  const catalog = { catalogId: 'main-scan', branch: 'main', commit: 'a'.repeat(40), configRevision: 1, status: 'ready', createdAt, scenarios: [], suites: [{ id: 'smoke', cases: [first, second] }] };
  const older = { ...catalog, catalogId: 'older-scan', branch: undefined, commit: 'b'.repeat(40), createdAt: createdAt - 60_000 };
  vi.mocked(fetch).mockImplementation(async path => ({ ok: true, json: async () => {
    if (String(path).startsWith('/api/requests')) return { items: [] };
    switch (path) {
      case '/api/projects': return [project];
      case '/api/me': return { role: 'member' };
      case '/api/projects/app/status': return { ready: true, blockers: [], latestScan: null };
      case '/api/projects/app/catalogs': return [catalog, older];
      case '/api/projects/app/catalogs/main-scan/case-runs': return { catalogId: catalog.catalogId, items: [
        { suite: 'smoke', caseId: first.caseId, id: 'first-run', status: 'passed', createdAt: submittedAt },
        { suite: 'smoke', caseId: second.caseId, id: 'second-run', status: 'failed', createdAt: submittedAt, scenario: 'guest' },
      ] };
      case '/api/projects/app/catalogs/older-scan/case-runs': return { catalogId: older.catalogId, items: [] };
      default: return [];
    }
  } }) as Response);
  await act(async () => root.render(React.createElement(RoutedProjects, { key: 'case-details' })));
  const openCase = async () => {
    await act(async () => document.body.querySelectorAll<HTMLButtonElement>('.case-ticket')[1]!.click());
    return document.body.querySelector('[role=dialog]')!;
  };
  const dialog = await openCase();
  expect(dialog.querySelector('h2')?.textContent).toBe('Cooldown › expired（同名 #2）');
  expect(dialog.textContent).toContain(catalog.branch);
  expect(dialog.querySelector(`time[datetime="${new Date(createdAt).toISOString()}"]`)).not.toBeNull();
  expect(dialog.querySelector(`time[datetime="${new Date(submittedAt).toISOString()}"]`)).not.toBeNull();
  expect(dialog.textContent).toContain('guest');
  expect(dialog.textContent).toContain('失败');
  expect(dialog.querySelector('a[href="/requests/second-run?targetId=app"]')).not.toBeNull();
  expect(dialog.querySelector('a[href^="/requests/first-run"]')).toBeNull();
  expect(dialog.querySelector(`a[href="https://git.example.com/team/mobile/app/-/blob/${catalog.commit}/apps/My%20App/.fliwright/tests/cooldown%20%231.test.ts"]`)?.getAttribute('target')).toBe('_blank');

  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!.click());
  await selectOption('已扫描版本', older.catalogId);
  const olderDialog = await openCase();
  expect(olderDialog.textContent).toContain('该版本暂无单独运行记录');
  expect(olderDialog.querySelector('a[href^="/requests/second-run"]')).toBeNull();
  expect(olderDialog.querySelector(`a[href="https://git.example.com/team/mobile/app/-/commit/${older.commit}"]`)).not.toBeNull();
});

async function clickText(text: string, scope: ParentNode = document.body) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)!;
  expect(button, text).toBeDefined();
  await act(async () => button.click());
}
async function selectOption(label: string, value: string) {
  const element = document.body.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function showProject(role = 'admin') {
  const project = projectSchema.parse({ id: 'app', name: 'App', repository: 'https://git.example.com/team/app.git', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] });
  let workerBound = false;
  const catalogs = [
    { catalogId: 'old', commit: 'b'.repeat(40), configRevision: 0, status: 'ready', createdAt: 3, scenarios: [], suites: [] },
    { catalogId: 'failed', commit: 'c'.repeat(40), configRevision: 1, status: 'failed', createdAt: 2, scenarios: [], suites: [] },
    { catalogId: 'ready', branch: 'releases/v1.5.0', commit: 'a'.repeat(40), configRevision: 1, status: 'ready', createdAt: 1, scenarios: [{ name: 'guest' }], suites: [{ id: 'smoke', cases: [{ caseId: 'case', titlePath: ['A real case'], file: 'proof.test.ts', duplicateIndex: 0 }] }] },
  ];
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (options?.method === 'POST') submitted = JSON.parse(String(options.body));
    if (path === '/api/projects/app/workers' && options?.method === 'PUT') workerBound = JSON.parse(String(options.body)).workerIds.includes('mac');
    return { ok: true, json: async () => {
      if (path === '/api/me') return { role };
      if (path === '/api/projects') return [project];
      if (path === '/api/workers') return [];
      if (path === '/api/projects/app/workers') return [{ id: 'mac', health: 'healthy', paused: false, bound: workerBound }];
      if (String(path).endsWith('/status')) return { ready: true, blockers: [], latestScan: null };
      if (String(path).endsWith('/catalogs')) return catalogs;
      if (String(path).endsWith('/scans') && options?.method !== 'POST') return [
        { scanId: 'queued', projectId: 'app', commit: 'd'.repeat(40), status: 'queued', configRevision: 1, createdAt: 3, queue: { reason: 'scanner_disconnected', workerIds: ['scan-host'] } },
        { scanId: 'running', projectId: 'app', branch: 'main', commit: 'a'.repeat(40), status: 'running', configRevision: 1, createdAt: 2, workerId: 'build-host' },
        { scanId: 'failed', projectId: 'app', commit: 'b'.repeat(40), status: 'failed', configRevision: 1, createdAt: 1, errorSummary: 'Dependency installation failed' },
      ];
      if (String(path).startsWith('/api/requests')) return { items: [] };
      if (String(path).endsWith('/webhook-secret')) return { token: 'one-time-test-token' };
      return {};
    } } as Response;
  });
  await act(async () => root.render(React.createElement(RoutedProjects, { key: role })));
  return project;
}

it('selects and saves Workers from project settings', async () => {
  await showProject();
  await act(async () => document.body.querySelector<HTMLAnchorElement>('.project-sections a[href*=settings]')!.click());
  const section = document.body.querySelector('[aria-label="绑定 Worker"]')!;
  expect([...section.parentElement!.querySelectorAll(':scope > section > div > h3')].slice(0, 2).map(heading => heading.textContent)).toEqual(['仓库与运行配置', '绑定 Worker']);
  expect(section.textContent).toContain('尚未绑定 Worker');
  await clickText('选择 Worker', section);
  await act(async () => document.body.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="mac"]')!.click());
  await act(async () => document.body.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const [, options] = vi.mocked(fetch).mock.calls.find(([url, init]) => url === '/api/projects/app/workers' && init?.method === 'PUT')!;
  expect(JSON.parse(String(options?.body))).toEqual({ workerIds: ['mac'], expectedWorkerIds: [] });
  expect(section.textContent).toContain('mac');
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it('browses only usable catalog versions and searches cases and projects without changing selection', async () => {
  await showProject();
  expect(document.body.querySelector('[data-ui~=project-summaries]')).toBeNull();
  expect(document.body.querySelector('[aria-label="项目状态"]')).toBeNull();
  expect(document.body.querySelector('.case-deck')).not.toBeNull();
  const options = [...document.body.querySelector<HTMLSelectElement>('[aria-label="已扫描版本"]')!.options].filter(option => !option.disabled);
  expect(options.map(option => option.value)).toEqual(['ready']);
  expect(options[0]?.textContent).toContain('releases/v1.5.0');
  await fill('筛选文件或用例名称', 'no match');
  expect(document.body.textContent).toContain('没有匹配的测试用例');
  await clickText('清除搜索');
  expect(document.body.textContent).toContain('A real case');
  expect(document.body.querySelector('header [aria-label="项目分区"]')).not.toBeNull();
  await act(async () => document.body.querySelector<HTMLButtonElement>('[data-ui~=project-switcher] button')!.click());
  await fill('搜索项目', 'no match');
  expect(document.body.textContent).toContain('没有匹配的项目');
  expect(document.body.querySelector('[data-ui~=project-switcher-menu]')?.textContent).toContain('没有匹配的项目');
  expect(document.body.textContent).toContain('A real case');
});

it('updates cases from a selected branch and starts a scan for an explicit SHA from scan history', async () => {
  await showProject('operator');
  await clickText('更新测试用例', document.body.querySelector('.project-page-heading')!);
  expect(document.body.querySelector<HTMLInputElement>('input[aria-label="分支名称"]')?.value).toBe('main');
  await fill('分支名称', 'releases/v1.6.0');
  expect(submitted).toBeUndefined();
  await act(async () => document.body.querySelector('[role=dialog] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fetch).toHaveBeenCalledWith('/api/projects/app/scans', expect.objectContaining({ method: 'POST' }));
  expect(submitted).toEqual({ branch: 'releases/v1.6.0' });
  expect(document.body.querySelector('.project-page-heading h1')?.textContent).toContain('扫描记录');
  const toast = document.querySelector('[aria-label^="操作通知"] [data-sonner-toast]');
  expect(toast?.textContent).toBe('仓库扫描已排队。');
  expect(document.querySelector('main')?.textContent).not.toContain('仓库扫描已排队。');
  expect(toast?.closest('[data-sonner-toaster]')?.matches('[data-x-position="right"][data-y-position="bottom"]')).toBe(true);
  expect(toast?.querySelector('button')).toBeNull();
  const scanTable = document.body.querySelector('.project-workbody table');
  expect(scanTable?.textContent).toContain('扫描服务未连接');
  expect(scanTable?.textContent).toContain('scan-host');
  expect(scanTable?.textContent).toContain('build-host');
  await selectOption('筛选扫描状态', 'failed');
  expect(document.body.querySelector('.project-workbody table')?.textContent).toContain('失败');
  expect(document.body.querySelector('.project-workbody table')?.textContent).not.toContain('运行中');
  expect(document.body.querySelector('.project-workbody details')?.textContent).toContain('Dependency installation failed');
  await clickText('新建扫描', document.body.querySelector('.project-workbody')!);
  await act(async () => document.body.querySelector<HTMLInputElement>('input[value="commit"]')!.click());
  await fill('完整 Commit SHA', 'short');
  expect(document.body.querySelector<HTMLButtonElement>('[role=dialog] button[type="submit"]')!.disabled).toBe(true);
  await fill('完整 Commit SHA', 'd'.repeat(40));
  await act(async () => document.body.querySelector('[role=dialog] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submitted).toEqual({ commit: 'd'.repeat(40) });
});

it('preserves dialog input and reports a failed request inside the dialog', async () => {
  await fill('GitLab 仓库 URL', 'https://git.example.com/team/draft');
  vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Repository is unavailable' }) } as Response);
  await act(async () => document.body.querySelector('[role=dialog] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(document.body.querySelector('[role=dialog][data-state=open] [role="alert"]')?.textContent).toBe('Repository is unavailable');
  expect(document.body.querySelector<HTMLInputElement>('[aria-label="GitLab 仓库 URL"]')?.value).toContain('/draft');
  expect(document.body.querySelector<HTMLButtonElement>('[role=dialog] button[type="submit"]')?.disabled).toBe(false);
});

it('requires name confirmation before deleting and makes settings read-only for members', async () => {
  await showProject();
  await act(async () => document.querySelector<HTMLAnchorElement>('.project-sections a[href*=settings]')!.click());
  expect(document.body.querySelectorAll('[aria-label="项目状态"] [data-ui~=project-summary]')).toHaveLength(4);
  await clickText('删除项目');
  expect(document.body.querySelector<HTMLButtonElement>('[role=dialog] button[type="submit"]')?.disabled).toBe(true);
  await fill('确认项目名称', 'App');
  expect(document.body.querySelector<HTMLButtonElement>('[role=dialog] button[type="submit"]')?.disabled).toBe(false);
  // Dismiss instead of deleting: this verifies the accidental-deletion guard.
  await clickText('取消', document.body.querySelector('[role=dialog]')!);
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
  await showProject('member');
  expect(document.body.querySelector('button[aria-label="创建项目"]')).toBeNull();
  expect(document.body.querySelector('[aria-label="已扫描版本"]')).not.toBeNull();
  expect(document.body.querySelector('.project-page-heading')?.textContent).not.toContain('更新测试用例');
  await act(async () => document.querySelector<HTMLAnchorElement>('.project-sections a[href*=settings]')!.click());
  expect(document.body.textContent).toContain('仓库与运行配置');
  expect(document.body.textContent).not.toContain('编辑配置');
  expect(document.body.textContent).not.toContain('删除项目');
});

it('configures automatic direct runs without selecting a named scenario', async () => {
  await showProject();
  await act(async () => document.querySelector<HTMLAnchorElement>('.project-sections a[href*=settings]')!.click());
  await clickText('配置自动运行');
  const choice = [...document.body.querySelectorAll('label')].find(label => label.textContent?.includes('smoke / 直接运行（无场景）'))!;
  expect(choice).toBeDefined();
  await act(async () => choice.querySelector<HTMLButtonElement>('[role=checkbox]')!.click());
  await clickText('保存策略');
  const call = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).endsWith('/auto-run') && options?.method === 'PUT')!;
  expect(JSON.parse(String(call[1]?.body)).selections).toEqual([{ suite: 'smoke' }]);
  expect(document.querySelector('[aria-label^="操作通知"] [data-sonner-toast]')?.textContent).toBe('自动运行策略已保存。');
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('自动运行策略已保存。');
});

it('keeps the one-time webhook token visible across project refreshes', async () => {
  await showProject();
  await act(async () => document.querySelector<HTMLAnchorElement>('.project-sections a[href*=settings]')!.click());
  await clickText('配置自动运行');
  await clickText('生成 / 轮换 Secret Token');
  expect(document.body.querySelector<HTMLInputElement>('[aria-label="一次性 Webhook Secret Token"]')?.value).toBe('one-time-test-token');
  expect(document.body.querySelector('[role=dialog][data-state=open]')).not.toBeNull();
});

it('blocks Escape during submission, then dismisses with focus and background scrolling restored', async () => {
  await clickText('取消', document.body.querySelector('[role=dialog]')!);
  const trigger = document.body.querySelector<HTMLButtonElement>('[aria-label="创建项目"]')!;
  await act(async () => { trigger.focus(); trigger.click(); });
  await fill('GitLab 仓库 URL', 'https://git.example.com/team/app');
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => document.body.querySelector('[role=dialog] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await act(async () => document.body.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.body.querySelector('[role=dialog][data-state=open]')).not.toBeNull();
  expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
  await act(async () => finish({ ok: false, json: async () => ({ error: 'Try again' }) } as Response));
  await act(async () => document.body.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
  expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});
