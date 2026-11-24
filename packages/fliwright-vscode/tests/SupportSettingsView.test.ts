// @vitest-environment happy-dom
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSupportSettings, MissingSupportSettingError, readSupportSettings, saveSupportSettings } from '@fliwright/core';
import { expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerSupportSettingsView, showMissingSupportSetting } from '../src/support/SupportSettingsView.js';
import { loadWorkspaceAuthoredConfig } from '../src/WorkspaceProjectConfig.js';

const host = vi.hoisted(() => ({ register: vi.fn(), folders: [] as unknown[], trusted: false, discard: vi.fn(),
  showError: vi.fn(), executeCommand: vi.fn() }));
vi.mock('vscode', async importOriginal => {
  const stub = await importOriginal<typeof import('./stubs/vscode.js')>();
  const disposable = () => ({ dispose() {} });
  return {
    ...stub,
    workspace: { ...stub.workspace, onDidChangeWorkspaceFolders: disposable,
      createFileSystemWatcher: () => ({ onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable, dispose() {} }),
      get workspaceFolders() { return host.folders; }, get isTrusted() { return host.trusted; } },
    window: { ...stub.window, registerWebviewViewProvider: host.register, showWarningMessage: host.discard, showErrorMessage: host.showError },
    commands: { ...stub.commands, executeCommand: host.executeCommand },
  };
});

it('opens Support Settings from a reported missing field and preserves other failure actions', async () => {
  const error = new MissingSupportSettingError('example', 'mode', '/runtime/example.json');
  expect(showMissingSupportSetting(['AssertionError: expected a visible element'])).toBeUndefined();
  expect(host.showError).not.toHaveBeenCalled();
  host.showError.mockResolvedValueOnce('View Trace').mockResolvedValueOnce('Open Support Settings');
  expect(await showMissingSupportSetting([error.stack], 'View Trace')).toBe('View Trace');
  expect(host.executeCommand).not.toHaveBeenCalled();
  expect(await showMissingSupportSetting([error.message])).toBeUndefined();
  expect(host.showError).toHaveBeenCalledWith(error.message, 'Open Support Settings', 'View Trace');
  expect(host.executeCommand).toHaveBeenCalledWith('fliwright.supportSettings.focus');
});

const definition = {
  id: 'example', title: 'Example', fields: {
    route: { type: 'string', label: 'Route', default: '/home' },
    delay: { type: 'number', label: 'Delay', default: 10, min: 0 },
    wait: { type: 'boolean', label: 'Wait', default: true },
    mode: { type: 'select', label: 'Mode', options: [{ value: '', label: 'Empty option' }, { value: 'test', label: 'Test' }] },
  },
} as const;

it('renders registered fields, saves and resets project values, and retains a conflicting draft', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fliwright-support-view-'));
  vi.stubEnv('FLIWRIGHT_RUNTIME_ROOT', join(directory, 'runtime'));
  const alpha = join(directory, 'alpha');
  const beta = join(directory, 'beta');
  let dispose: (() => void) | undefined;
  try {
    for (const root of [alpha, beta]) {
      await mkdir(root);
      await writeFile(join(root, 'fliwright.config.ts'), `import { writeFileSync } from 'node:fs';
        writeFileSync(${JSON.stringify(join(root, 'imported'))}, 'yes');
        export default { supportSettings: [${JSON.stringify(definition)}] };`);
    }
    host.folders = [alpha, beta].map((root, index) => ({ index, name: index === 0 ? 'Alpha' : 'Beta',
      uri: Object.assign(vscode.Uri.file(root), { scheme: 'file' }) }));
    registerSupportSettingsView(vscode.Uri.file(directory));
    const provider = host.register.mock.calls[0][1] as vscode.WebviewViewProvider;
    let receive: ((message: unknown) => void) | undefined;
    const webview = {
      asWebviewUri: (uri: vscode.Uri) => uri,
      onDidReceiveMessage: (callback: (message: unknown) => void) => { receive = callback; return { dispose() {} }; },
      postMessage: async (message: unknown) => { window.dispatchEvent(new MessageEvent('message', { data: message })); return true; },
      html: '',
    };
    provider.resolveWebviewView({ webview, onDidDispose: (callback: () => void) => { dispose = callback; } } as never, {} as never, {} as never);
    expect(webview.html).toContain('Content-Security-Policy');
    expect(webview.html).toContain('/dist/support/app.js');
    const parsed = new DOMParser().parseFromString(webview.html, 'text/html');
    document.body.replaceChildren(parsed.querySelector('main')!);
    vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage: (message: unknown) => receive?.(message), getState: () => undefined, setState: vi.fn() }));
    await import('../src/support/app.js');
    const query = <Element extends HTMLElement>(selector: string) => document.querySelector<Element>(selector)!;
    const edit = (selector: string, value: string) => {
      const input = query<HTMLInputElement | HTMLSelectElement>(selector);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const save = () => query<HTMLFormElement>('#settings').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(query('#notice').textContent).toContain('Trust this workspace'));
    expect(query('#field-0')).toBeNull();
    expect((await loadWorkspaceAuthoredConfig(vscode.Uri.file(alpha))).supportSettings).toBeUndefined();
    await expect(readFile(join(alpha, 'imported'))).rejects.toMatchObject({ code: 'ENOENT' });
    host.trusted = true;
    query<HTMLButtonElement>('#refresh').click();
    await vi.waitFor(() => {
      expect(query('#error').textContent).toBe('');
      expect(query<HTMLInputElement>('#field-0')?.placeholder).toBe('/home');
    });
    expect(query<HTMLInputElement>('#field-1').type).toBe('number');
    expect(query<HTMLInputElement>('#field-2').checked).toBe(true);
    edit('#field-0', '/preview');
    edit('#field-1', '0');
    query<HTMLInputElement>('#field-2').click();
    edit('#field-3', '0');
    save();
    await vi.waitFor(() => expect(query('#notice').textContent).toBe('Saved.'));
    await expect(readSupportSettings(definition, { projectRoot: alpha })).resolves.toEqual({ route: '/preview', delay: 0, wait: false, mode: '' });
    await expect(readSupportSettings(definition, { projectRoot: beta })).resolves.toMatchObject({ route: '/home', delay: 10, wait: true });

    query<HTMLButtonElement>('[aria-label="Clear the local value for Delay"]').click();
    save();
    await vi.waitFor(() => expect(query('#notice').textContent).toBe('Saved.'));
    await expect(readSupportSettings(definition, { projectRoot: alpha })).resolves.toMatchObject({ delay: 10 });

    edit('#field-0', '/draft');
    host.discard.mockResolvedValue(undefined);
    query<HTMLButtonElement>('#refresh').click();
    await vi.waitFor(() => expect(query<HTMLButtonElement>('#save').disabled).toBe(false));
    expect(query<HTMLInputElement>('#field-0').value).toBe('/draft');
    await saveSupportSettings(definition, {
      revision: (await loadSupportSettings(definition, { projectRoot: alpha })).revision,
      changes: { route: '/other-window' },
    }, { projectRoot: alpha });
    save();
    await vi.waitFor(() => expect(query('#error').textContent).toContain('changed in another window'));
    expect(query<HTMLInputElement>('#field-0').value).toBe('/draft');

    host.discard.mockResolvedValue('Discard');
    const select = query<HTMLSelectElement>('#project');
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(query<HTMLInputElement>('#field-0').value).toBe(''));
  } finally {
    dispose?.();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
