import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { loadSupportSettings, missingSupportSettingMessage, saveSupportSettings, SupportSettingsError, type SupportSettingsDefinition, type SupportSettingValue } from '@fliwright/core';
import { invalidateWorkspaceProjectConfig, loadWorkspaceAuthoredConfig } from '../WorkspaceProjectConfig.js';
import type { SupportSettingsHostMessage, SupportSettingsViewState } from './messages.js';

interface OpenForm {
  token: string;
  folder: vscode.WorkspaceFolder;
  definition: SupportSettingsDefinition;
  revision: string | null;
}

export function showMissingSupportSetting(errors: readonly unknown[], ...otherActions: string[]): Thenable<string | undefined> | undefined {
  const message = errors.map(missingSupportSettingMessage).find(Boolean);
  if (!message) return undefined;
  const action = 'Open Support Settings';
  return vscode.window.showErrorMessage(message, action, ...otherActions).then(async selection => {
    if (selection !== action) return selection;
    await vscode.commands.executeCommand('fliwright.supportSettings.focus');
    return undefined;
  });
}

/** Discover support declarations and edit their machine-local values in the Fliwright sidebar. */
export function registerSupportSettingsView(extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider('fliwright.supportSettings', {
    resolveWebviewView(view) { connectView(view, extensionUri); },
  }, { webviewOptions: { retainContextWhenHidden: true } });
}

function connectView(view: vscode.WebviewView, extensionUri: vscode.Uri): void {
  const { webview } = view;
  const assets = vscode.Uri.joinPath(extensionUri, 'dist', 'support');
  webview.options = { enableScripts: true, localResourceRoots: [assets] };
  webview.html = renderSupportSettingsHtml(webview.asWebviewUri(vscode.Uri.joinPath(assets, 'app.js')).toString());
  let selection: { project?: string; support?: string } = {};
  let current: OpenForm | undefined;
  let queue = Promise.resolve();
  let disposed = false;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const post = async (message: SupportSettingsHostMessage) => {
    if (!disposed) await webview.postMessage(message);
  };

  async function load(project?: string, support?: string, refresh = false, saved = false): Promise<void> {
    current = undefined;
    const folders = availableFolders();
    const state: SupportSettingsViewState = {
      projects: folders.map(folder => ({ id: folder.uri.toString(), name: folder.name })), supports: [],
    };
    const folder = folders.find(candidate => candidate.uri.toString() === project) ?? folders[0];
    if (!folder) state.notice = 'Open a project folder to manage support settings.';
    else {
      state.project = folder.uri.toString();
      if (!vscode.workspace.isTrusted) state.notice = 'Trust this workspace to load support settings.';
      else {
        try {
          if (refresh) invalidateWorkspaceProjectConfig(folder.uri);
          const { supportSettings = [] } = await loadWorkspaceAuthoredConfig(folder.uri);
          state.supports = supportSettings.map(({ id, title }) => ({ id, title }));
          const definition = supportSettings.find(item => item.id === support) ?? supportSettings[0];
          if (!definition) state.notice = 'This project has no support settings registered in fliwright.config.ts.';
          else {
            state.support = definition.id;
            const { revision, values, issues } = await loadSupportSettings(definition, { projectRoot: folder.uri.fsPath });
            const token = randomUUID();
            current = { folder, definition, revision, token };
            state.form = { token, definition, values, issues };
          }
        } catch (error) {
          state.error = error instanceof Error ? error.message : 'Could not load support settings.';
        }
      }
    }
    selection = { project: state.project, support: state.support };
    await post({ type: 'state', state, saved });
  }

  async function receive(message: unknown): Promise<void> {
    if (disposed || !isRecord(message)) return;
    if (message.type === 'load') {
      if (message.discard === true) {
        const action = await vscode.window.showWarningMessage('Discard unsaved support settings?', { modal: true }, 'Discard');
        if (action !== 'Discard') return post({ type: 'cancelled' });
      }
      return load(typeof message.project === 'string' ? message.project : selection.project,
        typeof message.support === 'string' ? message.support : selection.support, message.refresh === true);
    }
    if (message.type !== 'save') return;
    const open = current;
    if (!open || open.token !== message.token || !vscode.workspace.isTrusted || !availableFolders().some(folder => folder.uri.toString() === open.folder.uri.toString())) {
      await post({ type: 'error', message: 'The selected support settings have changed. Refresh before saving.' });
      return;
    }
    const { folder, definition, revision } = open;
    const changes = parseChanges(message.changes);
    invalidateWorkspaceProjectConfig(folder.uri);
    const project = await loadWorkspaceAuthoredConfig(folder.uri);
    const updated = project.supportSettings?.find(item => item.id === definition.id);
    if (JSON.stringify(updated) !== JSON.stringify(definition)) {
      await post({ type: 'error', message: 'The support declaration has changed. Refresh before saving.' });
      return;
    }
    await saveSupportSettings(definition, { revision, changes }, { projectRoot: folder.uri.fsPath });
    await load(folder.uri.toString(), definition.id, false, true);
  }

  const changed = () => {
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { void post({ type: 'changed' }); }, 150);
  };
  const disposables = [
    webview.onDidReceiveMessage(message => {
      queue = queue.then(() => receive(message)).catch(async error => {
        await post({ type: 'error', message: error instanceof Error ? error.message : 'Could not save support settings.',
          field: error instanceof SupportSettingsError ? error.field : undefined });
      });
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(changed),
    vscode.workspace.onDidChangeWorkspaceFolders(changed),
  ];
  for (const pattern of ['**/fliwright.config.ts', '**/.fliwright/support/**']) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const invalidate = (uri: vscode.Uri) => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return;
      invalidateWorkspaceProjectConfig(folder.uri);
      if (selection.project === folder.uri.toString()) changed();
    };
    disposables.push(watcher, watcher.onDidChange(invalidate), watcher.onDidCreate(invalidate), watcher.onDidDelete(invalidate));
  }
  view.onDidDispose(() => {
    disposed = true;
    if (changeTimer) clearTimeout(changeTimer);
    disposables.forEach(disposable => disposable.dispose());
  });
}

function availableFolders(): readonly vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter(folder => ['file', 'vscode-remote'].includes(folder.uri.scheme));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseChanges(value: unknown): Record<string, SupportSettingValue | null> {
  if (!isRecord(value)) throw new Error('Invalid support settings edit.');
  const result: Array<[string, SupportSettingValue | null]> = [];
  for (const [key, field] of Object.entries(value)) {
    if (field !== null && typeof field !== 'string' && typeof field !== 'boolean' &&
        !(typeof field === 'number' && Number.isFinite(field))) throw new Error('Invalid support settings edit.');
    result.push([key, field]);
  }
  return Object.fromEntries(result);
}

function renderSupportSettingsHtml(script: string): string {
  const nonce = randomUUID();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Support Settings</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { margin: 0; padding: 12px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
    main, form { display: grid; gap: 14px; }
    form { margin: 0; }
    p { margin: 0; overflow-wrap: anywhere; }
    label { font-weight: 600; overflow-wrap: anywhere; }
    select, input, button { font: inherit; }
    input:not([type=checkbox]), select { width: 100%; min-width: 0; padding: 4px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }
    :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    input::placeholder { color: var(--vscode-input-placeholderForeground); }
    input[type=checkbox] { margin: 2px 0; accent-color: var(--vscode-button-background); }
    button { padding: 4px 9px; border: 1px solid transparent; border-radius: 2px; cursor: pointer; overflow-wrap: anywhere; }
    button:disabled { opacity: .55; cursor: default; }
    button:not(:disabled):hover { background: var(--vscode-button-secondaryHoverBackground); }
    button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button[type=submit] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button[type=submit]:not(:disabled):hover { background: var(--vscode-button-hoverBackground); }
    .entry, .field { display: grid; gap: 5px; min-width: 0; }
    .actions, .label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .reset { background: transparent; color: var(--vscode-textLink-foreground); padding: 0 2px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
    #fields { display: grid; gap: 12px; }
  </style>
</head>
<body>
  <main>
    <div class="entry" id="project-entry" hidden><label for="project">Project</label><select id="project"></select></div>
    <div class="entry" id="support-entry" hidden><label for="support">Support</label><select id="support"></select></div>
    <p id="notice" role="status">Loading support settings...</p>
    <p id="error" class="error" role="alert" hidden></p>
    <form id="settings" novalidate>
      <div id="fields"></div>
      <div class="actions"><button type="submit" id="save" hidden>Save</button><button type="button" id="refresh">Refresh</button></div>
    </form>
  </main>
  <script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
}
