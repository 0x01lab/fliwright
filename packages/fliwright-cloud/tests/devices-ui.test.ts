// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/web/app.js';
import type { ManagedDevice } from '@fliwright/cloud-protocol';
let root: Root, container: HTMLDivElement;
let role = 'operator',
  failSave = false;
let device: ManagedDevice;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  role = 'operator';
  failSave = false;
  device = {
    id: 'phone',
    workerId: 'mac',
    nativeId: 'usb-123',
    observation: {
      id: 'usb-123',
      name: 'iPhone',
      platform: 'ios',
      kind: 'physical',
      state: 'online',
      osVersion: '18.0',
    },
    lastSeenAt: 1000,
    present: true,
    stale: false,
    settings: {
      alias: '',
      tags: ['qa'],
      managed: false,
      enabled: false,
      targets: [],
      slotId: null,
    },
    blockers: ['unmanaged', 'disabled', 'no-slot', 'no-targets'],
    ready: false,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      let data: unknown = [];
      if (url === '/api/me') data = { role, name: 'ops' };
      if (url === '/api/targets')
        data = [
          { id: 'app', name: 'App', suites: ['smoke'], scenarios: ['clean'] },
        ];
      if (url === '/api/devices') data = [device];
      if (url === '/api/devices/phone') {
        if (options?.method === 'PUT') {
          if (failSave)
            return {
              ok: false,
              json: async () => ({
                error: 'Cannot reconfigure an occupied slot',
              }),
            };
          device = {
            ...device,
            settings: JSON.parse(String(options.body)),
            blockers: ['runtime-missing'],
          };
        }
        data = device;
      }
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
});
async function mount(path: string) {
  window.history.replaceState(null, '', path);
  await act(async () => root.render(React.createElement(App)));
}
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('opens the unified list, restores URL filters and navigates to device detail in place', async () => {
  await mount('/devices?platform=android');
  expect(container.querySelector('h1')?.textContent).toBe('设备管理');
  expect(container.querySelector('a[href="/devices/phone"]')).toBeNull();
  const filter =
    container.querySelector<HTMLSelectElement>('[aria-label="平台"]')!;
  await act(async () => {
    filter.value = 'ios';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(new URLSearchParams(window.location.search).get('platform')).toBe(
    'ios',
  );
  const shell = container.querySelector('header.app-header');
  await act(async () =>
    container
      .querySelector<HTMLAnchorElement>('a[href="/devices/phone"]')!
      .click(),
  );
  expect(container.querySelector('h1')?.textContent).toBe('iPhone');
  expect(container.querySelector('header.app-header')).toBe(shell);
  expect(container.textContent).toContain('独立工作目录');
});
it('saves enrollment and application settings, showing deployment readiness', async () => {
  await mount('/devices/phone');
  await fill('#device-alias', 'QA Phone');
  await fill('#device-slot', 'phone-slot');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('#device-managed')!.click(),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('#device-enabled')!.click(),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="允许应用 App"]')!
      .click(),
  );
  await act(async () =>
    container
      .querySelector('form[data-device-settings]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  const saved = vi
    .mocked(fetch)
    .mock.calls.find(([, options]) => options?.method === 'PUT')!;
  expect(JSON.parse(String(saved[1]?.body))).toEqual({
    alias: 'QA Phone',
    tags: ['qa'],
    managed: true,
    enabled: true,
    targets: ['app'],
    slotId: 'phone-slot',
  });
  expect(container.textContent).toContain('配置已保存');
  expect(container.textContent).toContain('等待执行进程');
});
it('keeps edits after a save error and renders management controls read-only for members', async () => {
  await mount('/devices/phone');
  failSave = true;
  await fill('#device-alias', 'Unsaved');
  await act(async () =>
    container
      .querySelector('form[data-device-settings]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'occupied',
  );
  expect(
    container.querySelector<HTMLInputElement>('#device-alias')?.value,
  ).toBe('Unsaved');
  role = 'member';
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount('/devices/phone');
  expect(
    container.querySelector<HTMLFieldSetElement>('fieldset')?.disabled,
  ).toBe(true);
  expect(container.textContent).toContain('仅操作员和管理员可修改');
});

it('refreshes untouched settings while preserving local unsaved edits', async () => {
  vi.useFakeTimers();
  try {
    await mount('/devices/phone');
    device = {
      ...device,
      settings: { ...device.settings, alias: 'Updated elsewhere' },
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(
      container.querySelector<HTMLInputElement>('#device-alias')?.value,
    ).toBe('Updated elsewhere');
    await fill('#device-tags', 'local-tag');
    device = {
      ...device,
      settings: { ...device.settings, tags: ['remote-tag'] },
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(
      container.querySelector<HTMLInputElement>('#device-tags')?.value,
    ).toBe('local-tag');
    await fill('#device-alias', 'Local unsaved');
    device = {
      ...device,
      settings: { ...device.settings, alias: 'Another update' },
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(
      container.querySelector<HTMLInputElement>('#device-alias')?.value,
    ).toBe('Local unsaved');
  } finally {
    vi.useRealTimers();
  }
});
