import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionConfig } from './types.js';

export function getWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export function loadConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('fliwright');
  return {
    mockDir: config.get<string>('mockDir', '.fliwright/mocks'),
    mockIndex: config.get<string>('mockIndex', '.fliwright/mocks/mock-index.json'),
    vmServiceUrl: config.get<string | null>('vmServiceUrl', null),
    autoDiscoverVmService: config.get<boolean>('autoDiscoverVmService', true),
    formRulesDir: config.get<string>('formRulesDir', '.fliwright/forms'),
    formRulesFile: config.get<string | null>('formRulesFile', null),
    formLocale: config.get<string>('formLocale', 'zh_CN'),
    formPreviewBeforeFill: config.get<boolean>('formPreviewBeforeFill', true),
  };
}

export function resolveWorkspacePath(root: vscode.Uri, value: string): vscode.Uri {
  if (path.isAbsolute(value)) {
    return vscode.Uri.file(value);
  }
  return vscode.Uri.joinPath(root, ...value.split(/[\\/]+/).filter(Boolean));
}
