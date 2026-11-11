import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { MockApiSearchController } from '../src/views/MockApiSearchController.js';
import { MockApiTreeProvider } from '../src/views/MockApiTreeProvider.js';
import type { MockConfigService } from '../src/sandbox/MockConfigService.js';

function setup() {
  const provider = new MockApiTreeProvider({} as MockConfigService);
  const controller = new MockApiSearchController(provider);
  const createInputBox = vi.spyOn(vscode.window, 'createInputBox');
  controller.show();
  expect(createInputBox).toHaveBeenCalledOnce();
  const input = createInputBox.mock.results[0]!.value as ReturnType<typeof vscode.window.createInputBox>;
  return { provider, controller, input, createInputBox };
}

afterEach(() => vi.restoreAllMocks());

describe('Mock API search input', () => {
  it('previews changes immediately, keeps the confirmed query and pre-fills it on reopen', () => {
    const context = vi.spyOn(vscode.commands, 'executeCommand');
    const { provider, controller, input, createInputBox } = setup();
    input.__change('POST accounts');
    expect(provider.filter).toBe('POST accounts');
    expect(context).toHaveBeenCalledWith('setContext', 'fliwright.mockApis.hasFilter', true);
    input.__accept();
    expect(provider.filter).toBe('POST accounts');
    controller.show();
    expect(createInputBox.mock.results[1]!.value.value).toBe('POST accounts');
    controller.dispose();
  });

  it('restores the last confirmed query when dismissed', () => {
    const { provider, controller, input, createInputBox } = setup();
    input.__change('accounts');
    input.__accept();
    controller.show();
    const next = createInputBox.mock.results[1]!.value;
    next.__change('login');
    expect(provider.filter).toBe('login');
    next.hide();
    expect(provider.filter).toBe('accounts');
    controller.dispose();
  });

  it('clears an active search without restoring its previous value on hide', () => {
    const context = vi.spyOn(vscode.commands, 'executeCommand');
    const { provider, controller, input } = setup();
    input.__change('accounts');
    controller.clear();
    input.hide();
    expect(provider.filter).toBe('');
    expect(context).toHaveBeenLastCalledWith('setContext', 'fliwright.mockApis.hasFilter', false);
    controller.dispose();
  });

  it('reuses the open input and releases its listeners on disposal', () => {
    const { provider, controller, input, createInputBox } = setup();
    controller.show();
    expect(createInputBox).toHaveBeenCalledTimes(1);
    input.__change('accounts');
    controller.dispose();
    expect(provider.filter).toBe('');
    input.__change('login');
    expect(provider.filter).toBe('');
  });
});
