// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TestCatalog } from '@fliwright/cloud-protocol';
import { ScenarioBuilder } from '../src/web/ScenarioBuilder.js';

let root: Root;
let container: HTMLDivElement;
const catalog = { scenarios: [{ name: 'existing' }], mocks: [{ directory: '.fliwright/mocks', profiles: ['empty', 'member', 'success'], endpoints: [
  { endpoint: '/user', method: 'GET', rules: ['success', 'member'], activeRule: 'success' },
  { endpoint: '/assets', method: 'GET', rules: ['success', 'empty'], activeRule: 'success' },
] }] } as TestCatalog;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function input(label: string, value: string) {
  const field = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function select(label: string, value: string) {
  const field = document.body.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); });
}
function button(label: string) { return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }

it('builds a combined scenario, preserves choices between steps, and supports copying and downloading', async () => {
  const close = vi.fn();
  await act(async () => root.render(React.createElement(ScenarioBuilder, { catalog, close })));
  await input('场景名称', 'member-empty');
    await input('起始页面', '/assets');
  await click('下一步');
  await select('Mock 目录', '.fliwright/mocks');
  await select('Mock profile', 'member');
  await select('Mock 规则 GET /user', 'member');
  await select('Mock 规则 GET /assets', 'empty');
  await click('生成配置');
  const preview = document.body.querySelector<HTMLTextAreaElement>('[aria-label="场景文件预览"]')!.value;
  expect(preview).not.toContain('"rule": "member"'); expect(preview).toContain('"rule": "empty"');
  expect(preview).toContain('"profile": "member"'); expect(preview).not.toContain('"kind": "auth"'); expect(preview).toContain('"route": "/assets"');
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  await click('复制场景文件'); expect(writeText).toHaveBeenCalledWith(preview);
  await click('复制接入代码'); expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('...generatedScenarios'));
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:scenario');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  let downloaded = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded = this.download; });
  await click('下载场景文件'); expect(downloaded).toBe('member-empty.ts');
  expect(createUrl).toHaveBeenCalledWith(expect.any(Blob)); expect(revokeUrl).toHaveBeenCalledWith('blob:scenario');
  writeText.mockRejectedValue(new Error('denied'));
  await click('复制场景文件'); expect(document.body.textContent).toContain('复制失败');
  expect(document.body.querySelector<HTMLTextAreaElement>('[aria-label="场景文件预览"]')!.value).toBe(preview);
  createUrl.mockImplementation(() => { throw new Error('unavailable'); });
  await click('下载场景文件'); expect(document.body.textContent).toContain('下载失败');
  expect(document.body.querySelector<HTMLTextAreaElement>('[aria-label="场景文件预览"]')!.value).toBe(preview);
  await click('上一步'); expect(document.body.querySelector<HTMLSelectElement>('[aria-label="Mock 规则 GET /assets"]')!.value).toBe('empty');
  await click('关闭'); expect(close).toHaveBeenCalledOnce();
});

it('blocks empty or duplicate names and invalid starting routes', async () => {
  await act(async () => root.render(React.createElement(ScenarioBuilder, { catalog, close: vi.fn() })));
  expect(button('下一步').disabled).toBe(true);
  await input('场景名称', 'existing'); expect(button('下一步').disabled).toBe(true);
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('同名场景');
  await input('场景名称', 'new'); await input('起始页面', 'assets'); expect(button('下一步').disabled).toBe(true);
  await input('起始页面', '/assets'); expect(button('下一步').disabled).toBe(false);
});

it('explains missing rules and still exports a scenario prepared by the test itself', async () => {
  await act(async () => root.render(React.createElement(ScenarioBuilder, { close: vi.fn() })));
  await input('场景名称', 'test-owned'); await click('下一步');
  expect(document.body.textContent).toContain('当前版本没有可选的 Mock 规则');
  await click('生成配置');
  expect(document.body.querySelector<HTMLTextAreaElement>('[aria-label="场景文件预览"]')!.value).toContain('"layers": []');
  expect(document.body.textContent).toContain('提交并推送文件');
});
