// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkerPairingStatus } from '@fliwright/cloud-protocol';
import { WorkerPairing } from '../src/web/WorkerPairing.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  vi.unstubAllGlobals(); vi.useRealTimers();
});
const code = 'ABCD-1234-ABCD-1234-ABCD';
async function render(role = 'admin') {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const records: WorkerPairingStatus[] = [];
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit) => {
    calls.push(`${options.method} ${path}`);
    if (options.method === 'POST') {
      const row: WorkerPairingStatus = { id: 'pair', workerId: JSON.parse(String(options.body)).workerId, expiresAt: Date.now() + 600000, state: 'pending' };
      records.push(row);
      return { ok: true, json: async () => ({ ...row, code }) };
    }
    if (options.method === 'DELETE') {
      records[0].state = 'revoked';
      return { ok: true, json: async () => ({ ...records[0] }) };
    }
    return { ok: true, json: async () => records.map(row => ({ ...row })) };
  }));
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node); cleanups.push(() => node.remove(), () => act(async () => root.unmount()));
  await act(async () => root.render(React.createElement(WorkerPairing, { role })));
  return { calls, records };
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
async function click(label: string) {
  const target = [...(dialog() ?? document.body).querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label);
  expect(target, label).toBeDefined();
  await act(async () => target!.click());
}
async function generate() {
  await click('添加 Worker 主机');
  const input = dialog().querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'mac');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('生成配对码');
}
it('copies the npx command and advances after redemption', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const { records, calls } = await render();
  expect(dialog()).toBeNull();
  await generate();
  expect(dialog().textContent).toContain(code);
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  try {
    await click('复制配对并启动命令');
    const command = `npx --yes @fliwright/cloud-worker pair '${window.location.origin}' ./cloud-worker --code '${code}' --start`;
    expect(writeText).toHaveBeenCalledWith(command);
    expect(dialog().querySelector('code.select-all')?.textContent).toBe(command);
  } finally { writeText.mockRestore(); }
  await click('关闭对话框');
  expect(document.body.textContent).not.toContain(code);
  await click('继续配对');
  expect(dialog().textContent).toContain(code);
  expect(calls.filter(call => call.startsWith('POST'))).toHaveLength(1);
  records[0].state = 'paired';
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(dialog().textContent).not.toContain(code);
  expect(dialog().textContent).not.toContain('fliwright-worker run');
  expect(dialog().textContent).toContain('等待主机上线');
  await click('返回主机列表');
  expect(dialog()).toBeNull();
});
it('requires confirmation to revoke and offers a fresh enrollment for the same host', async () => {
  const { calls } = await render();
  await generate();
  await click('撤销配对码');
  expect(calls.every(call => !call.startsWith('DELETE'))).toBe(true);
  await click('确认撤销');
  expect(calls).toContain('DELETE /api/worker-pairings/pair');
  expect(dialog().textContent).not.toContain(code);
  await click('重新配对');
  expect(dialog().querySelector('input')?.value).toBe('mac');
});
it('removes expired codes even before another status response and allows retry', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  await render(); await generate();
  expect(dialog().querySelector('[role=timer]')?.textContent).toBe('10:00');
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(dialog().querySelector('[role=timer]')?.textContent).toBe('9:59');
  vi.setSystemTime(Date.now() + 599000);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(dialog().textContent).toContain('已过期');
  expect(dialog().textContent).not.toContain(code);
  await click('重新配对');
  expect(dialog().querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false);
});
it.each(['member', 'operator'])('hides enrollment and history from %s', async role => {
  const { calls } = await render(role);
  expect(document.querySelector('button')).toBeNull();
  expect(calls).toEqual([]);
});
