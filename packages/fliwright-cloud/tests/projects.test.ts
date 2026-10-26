// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Projects } from '../src/web/Projects.js';
import { projectSchema } from '@fliwright/cloud-protocol';

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
  await act(async () => root.render(React.createElement(Projects)));
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function fill(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('creates a project from a URL with inferred name and collapsed optional defaults', async () => {
  const form = container.querySelector('form')!;
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
    suites: { smoke: '.fliwright/tests/**/*.test.ts' }, scenarios: ['clean'],
  });
  for (const field of ['id', 'configRevision', 'webhookSecretDigest', 'webhookStatus', 'autoRun']) {
    expect(submitted).not.toHaveProperty(field);
  }
  expect(container.querySelector('form')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain('已保存');
});

it('updates inferred names, preserves custom names, and blocks invalid project URLs', async () => {
  await fill('GitLab 仓库 URL', 'git@gitlab.example.com:team/first.git');
  await fill('GitLab 仓库 URL', 'https://gitlab.example.com/team/second');
  const name = () => container.querySelector<HTMLInputElement>('input[aria-label="项目名称"]')!.value;
  expect(name()).toBe('second');
  await act(async () => { container.querySelector('details')!.open = true; });
  await fill('项目名称', '自定义名称');
  await fill('GitLab 仓库 URL', 'https://gitlab.example.com/team/third');
  expect(name()).toBe('自定义名称');
  await fill('项目名称', '');
  expect(name()).toBe('third');
  await fill('GitLab 仓库 URL', 'https://gitlab.example.com/team/third/-/issues');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('完整的 GitLab 项目地址');
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
});

it('shows cases without scenarios and offers only repository-discovered scenarios for execution', async () => {
  const project = projectSchema.parse({ id: 'app', name: 'App', repository: 'https://git.example.com/app.git', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] });
  const catalog = { catalogId: 'scan', commit: 'a'.repeat(40), configRevision: 1, status: 'ready', createdAt: 1, scenarios: [] as Array<{ name: string }>, suites: [{ id: 'smoke', cases: [{ caseId: 'case', file: 'proof.test.ts', titlePath: ['discovered case'], duplicateIndex: 0 }] }] };
  vi.mocked(fetch).mockImplementation(async (path) => ({ ok: true, json: async () => {
    if (path === '/api/projects') return [project];
    if (path === '/api/me') return { role: 'member' };
    if (String(path).endsWith('/status')) return { ready: true, blockers: [], latestScan: null };
    if (String(path).endsWith('/catalogs')) return [catalog];
    if (String(path).startsWith('/api/requests')) return { items: [] };
    return [];
  } }) as Response);
  const showCases = async (key: string) => {
    await act(async () => root.render(React.createElement(Projects, { key })));
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '测试用例')!.click());
  };
  await showCases('empty');
  expect(container.textContent).toContain('discovered case');
  expect(container.textContent).toContain('仓库尚未声明运行场景');
  expect(container.querySelector('select[aria-label="运行场景"]')).toBeNull();
  expect(container.querySelector<HTMLButtonElement>('[aria-label="运行此用例：discovered case"]')?.disabled).toBe(true);
  catalog.scenarios = [{ name: 'guest' }];
  await showCases('guest');
  const run = container.querySelector<HTMLButtonElement>('[aria-label="运行此用例：discovered case"]')!;
  expect(run.disabled).toBe(false);
  await act(async () => run.click());
  expect(container.querySelector('dialog[open]')).not.toBeNull();
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="运行场景"]')!;
  expect([...select.options].map(option => option.value)).toEqual(['guest']);
  expect(select.value).toBe('guest');
  await act(async () => container.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const call = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).endsWith('/requests') && options?.method === 'POST')!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ projectId: 'app', commit: catalog.commit, catalogId: 'scan', scenario: 'guest', mode: 'case', suite: 'smoke', caseId: 'case' });
  expect(container.querySelector('dialog')).toBeNull();
});

async function clickText(text: string, scope: ParentNode = container) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)!;
  expect(button, text).toBeDefined();
  await act(async () => button.click());
}
async function select(label: string, value: string) {
  const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function showProject(role = 'admin') {
  const project = projectSchema.parse({ id: 'app', name: 'App', repository: 'https://git.example.com/team/app.git', suites: { smoke: '*.test.ts' }, scenarios: ['clean'] });
  const catalogs = [
    { catalogId: 'old', commit: 'b'.repeat(40), configRevision: 0, status: 'ready', createdAt: 3, scenarios: [], suites: [] },
    { catalogId: 'failed', commit: 'c'.repeat(40), configRevision: 1, status: 'failed', createdAt: 2, scenarios: [], suites: [] },
    { catalogId: 'ready', commit: 'a'.repeat(40), configRevision: 1, status: 'ready', createdAt: 1, scenarios: [{ name: 'guest' }], suites: [{ id: 'smoke', cases: [{ caseId: 'case', titlePath: ['A real case'], file: 'proof.test.ts', duplicateIndex: 0 }] }] },
  ];
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (options?.method === 'POST') submitted = JSON.parse(String(options.body));
    return { ok: true, json: async () => {
      if (path === '/api/me') return { role };
      if (path === '/api/projects') return [project];
      if (String(path).endsWith('/status')) return { ready: true, blockers: [], latestScan: null };
      if (String(path).endsWith('/catalogs')) return catalogs;
      if (String(path).endsWith('/scans') && options?.method !== 'POST') return [
        { scanId: 'running', projectId: 'app', branch: 'main', commit: 'a'.repeat(40), status: 'running', configRevision: 1, createdAt: 2 },
        { scanId: 'failed', projectId: 'app', commit: 'b'.repeat(40), status: 'failed', configRevision: 1, createdAt: 1, errorSummary: 'Dependency installation failed' },
      ];
      if (String(path).startsWith('/api/requests')) return { items: [] };
      if (String(path).endsWith('/webhook-secret')) return { token: 'one-time-test-token' };
      return {};
    } } as Response;
  });
  await act(async () => root.render(React.createElement(Projects, { key: role })));
  return project;
}

it('browses only usable catalog versions and searches cases and projects without changing selection', async () => {
  await showProject();
  const options = [...container.querySelector<HTMLSelectElement>('[aria-label="已扫描版本"]')!.options].filter(option => !option.disabled);
  expect(options.map(option => option.value)).toEqual(['ready']);
  await fill('筛选文件或用例名称', 'no match');
  expect(container.textContent).toContain('没有匹配的测试用例');
  await clickText('清除搜索');
  expect(container.textContent).toContain('A real case');
  await fill('搜索项目', 'no match');
  expect(container.textContent).toContain('没有匹配的项目');
  expect(container.querySelector('h2')?.textContent).toBe('所有项目');
  expect(container.textContent).toContain('A real case');
});

it('scans the default branch or a validated explicit SHA and opens a filterable scan history', async () => {
  await showProject();
  await clickText('扫描仓库');
  expect(container.querySelector('dialog[open]')?.textContent).toContain('默认分支');
  await act(async () => container.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submitted).toEqual({});
  expect(container.querySelector('dialog h2')?.textContent).toBe('扫描记录');
  await select('筛选扫描状态', 'failed');
  expect(container.querySelector('dialog table')?.textContent).toContain('失败');
  expect(container.querySelector('dialog table')?.textContent).not.toContain('运行中');
  expect(container.querySelector('dialog details')?.textContent).toContain('Dependency installation failed');
  await clickText('新建扫描');
  await act(async () => container.querySelector<HTMLInputElement>('input[value="commit"]')!.click());
  await fill('完整 Commit SHA', 'short');
  expect(container.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!.disabled).toBe(true);
  await fill('完整 Commit SHA', 'd'.repeat(40));
  await act(async () => container.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submitted).toEqual({ commit: 'd'.repeat(40) });
});

it('preserves dialog input and reports a failed request inside the dialog', async () => {
  await fill('GitLab 仓库 URL', 'https://git.example.com/team/draft');
  vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Repository is unavailable' }) } as Response);
  await act(async () => container.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(container.querySelector('dialog[open] [role="alert"]')?.textContent).toBe('Repository is unavailable');
  expect(container.querySelector<HTMLInputElement>('[aria-label="GitLab 仓库 URL"]')?.value).toContain('/draft');
  expect(container.querySelector<HTMLButtonElement>('dialog button[type="submit"]')?.disabled).toBe(false);
});

it('requires name confirmation before deleting and makes settings read-only for members', async () => {
  await showProject();
  const settings = container.querySelector<HTMLButtonElement>('[role="tab"][id$="trigger-settings"]')!;
  await act(async () => settings.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  await clickText('删除项目');
  expect(container.querySelector<HTMLButtonElement>('dialog button[type="submit"]')?.disabled).toBe(true);
  await fill('确认项目名称', 'App');
  expect(container.querySelector<HTMLButtonElement>('dialog button[type="submit"]')?.disabled).toBe(false);
  // Dismiss instead of deleting: this verifies the accidental-deletion guard.
  await clickText('取消', container.querySelector('dialog')!);
  expect(container.querySelector('dialog')).toBeNull();
  await showProject('member');
  expect([...container.querySelectorAll('button')].some(button => button.textContent === '创建项目')).toBe(false);
  expect([...container.querySelectorAll('button')].some(button => button.textContent === '扫描仓库')).toBe(false);
  await act(async () => container.querySelector('[role="tab"][id$="trigger-settings"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  expect(container.textContent).toContain('仓库与运行配置');
  expect(container.textContent).not.toContain('编辑配置');
  expect(container.textContent).not.toContain('删除项目');
});

it('keeps the one-time webhook token visible across project refreshes', async () => {
  await showProject();
  await act(async () => container.querySelector('[role="tab"][id$="trigger-settings"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  await clickText('配置自动运行');
  await clickText('生成 / 轮换 Secret Token');
  expect(container.querySelector<HTMLInputElement>('[aria-label="一次性 Webhook Secret Token"]')?.value).toBe('one-time-test-token');
  expect(container.querySelector('dialog[open]')).not.toBeNull();
});

it('blocks Escape during submission, then dismisses with focus and background scrolling restored', async () => {
  await clickText('取消', container.querySelector('dialog')!);
  const trigger = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '创建项目')!;
  await act(async () => { trigger.focus(); trigger.click(); });
  await fill('GitLab 仓库 URL', 'https://git.example.com/team/app');
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => container.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await act(async () => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(container.querySelector('dialog[open]')).not.toBeNull();
  expect(document.body.style.overflow).toBe('hidden');
  await act(async () => finish({ ok: false, json: async () => ({ error: 'Try again' }) } as Response));
  await act(async () => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(container.querySelector('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(trigger);
});
