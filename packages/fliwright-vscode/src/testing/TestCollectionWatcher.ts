import * as vscode from 'vscode';
import * as path from 'node:path';
import { invalidateWorkspaceProjectConfig } from '../WorkspaceProjectConfig.js';

/** Imported source/data and configuration can change runtime-generated test names. */
export function watchTestCollection(provider: { refresh(): void }, runsRoot?: () => string | undefined): vscode.Disposable {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return { dispose() {} };
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = (uri: vscode.Uri) => {
    const artifacts = runsRoot?.();
    if (artifacts) {
      const artifactPath = path.relative(artifacts, uri.fsPath);
      if (!path.isAbsolute(artifactPath) && artifactPath !== '..' && !artifactPath.startsWith(`..${path.sep}`)) return;
    }
    const relative = uri.path.slice(root.path.length + 1);
    if (/(^|\/)(node_modules|\.git|\.dart_tool|build|dist|coverage|\.next|\.vscode-test)(\/|$)/.test(relative)) return;
    if (/(^|\/)\.fliwright\/(runs|cache|artifacts)(\/|$)/.test(relative)) return;
    if (!/\.(?:[cm]?[jt]sx?|json)$/.test(relative)) return;
    invalidateWorkspaceProjectConfig(root);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; provider.refresh(); }, 300);
  };
  watcher.onDidChange(changed);
  watcher.onDidCreate(changed);
  watcher.onDidDelete(changed);
  const trusted = vscode.workspace.onDidGrantWorkspaceTrust(() => provider.refresh());
  const settings = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('fliwright.testGlob')) provider.refresh();
  });
  return { dispose() {
    if (timer) clearTimeout(timer);
    invalidateWorkspaceProjectConfig(root);
    watcher.dispose(); trusted.dispose(); settings.dispose();
  } };
}
