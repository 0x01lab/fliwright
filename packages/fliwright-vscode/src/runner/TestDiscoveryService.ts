import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadConfig } from '../config.js';
import type { TestFileEntry } from '../types.js';

export class TestDiscoveryService {
  async discover(workspaceRoot: vscode.Uri): Promise<TestFileEntry[]> {
    const config = loadConfig();
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, config.testGlob));
    return uris
      .map((uri) => ({
        kind: 'testFile' as const,
        uri,
        label: path.basename(uri.fsPath),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}
