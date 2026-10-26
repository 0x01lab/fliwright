// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerPairing } from '../src/web/WorkerPairing.js';
const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); vi.unstubAllGlobals(); });
async function render(role = 'admin') {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    calls.push(`${options?.method ?? 'GET'} ${path}`);
    return { ok: true, json: async () => path === '/api/me' ? { role } : path === '/api/worker-pairings' && options?.method !== 'POST' ? [] : options?.method === 'POST' ? { id: 'pair', workerId: 'mac', code: 'ABCD-1234-ABCD-1234-ABCD', expiresAt: Date.now() + 600000, state: 'pending' } : { id: 'pair', workerId: 'mac', expiresAt: Date.now() + 600000, state: options?.method === 'DELETE' ? 'revoked' : 'pending' } };
  }));
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node); cleanups.push(() => node.remove()); cleanups.push(() => act(async () => root.unmount()));
  await act(async () => root.render(React.createElement(WorkerPairing, { role })));
  return { node, calls };
}
it('allows an administrator to create and cancel a pairing without exposing credentials', async () => {
  const { node, calls } = await render();
  const input = node.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'mac');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(node.textContent).toContain('ABCD-1234-ABCD-1234-ABCD');
  expect(node.textContent).toContain('fliwright-worker pair');
  const cancel = [...node.querySelectorAll('button')].find(button => button.textContent?.includes('撤销'))!;
  await act(async () => cancel.click());
  expect(calls).toContain('DELETE /api/worker-pairings/pair');
  expect(node.textContent).not.toContain('ABCD-1234-ABCD-1234-ABCD');
});
it('hides enrollment controls from members', async () => {
  const { node, calls } = await render('member');
  expect(node.querySelector('form')).toBeNull();
  expect(calls).toEqual([]);
});
