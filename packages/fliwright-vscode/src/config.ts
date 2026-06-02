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
    testGlob: config.get<string>('testGlob', 'tests/**/*.test.ts'),
    runner: config.get<'vitest' | 'cli'>('runner', 'vitest'),
    screenshotMode: config.get<'file' | 'base64' | 'off'>('screenshotMode', 'file'),
    failureContextDir: config.get<string>('failureContextDir', '.fliwright/failures'),
    traceDir: config.get<string>('traceDir', '.fliwright/traces'),
    formRulesDir: config.get<string>('formRulesDir', '.fliwright/forms'),
    formRulesFile: config.get<string | null>('formRulesFile', null),
    formLocale: config.get<string>('formLocale', 'zh_CN'),
    formPreviewBeforeFill: config.get<boolean>('formPreviewBeforeFill', true),
    codeLensEnabled: config.get<boolean>('codeLensEnabled', true),
  };
}

export function resolveWorkspacePath(root: vscode.Uri, value: string): vscode.Uri {
  if (path.isAbsolute(value)) {
    return vscode.Uri.file(value);
  }
  return vscode.Uri.joinPath(root, ...value.split(/[\\/]+/).filter(Boolean));
}
