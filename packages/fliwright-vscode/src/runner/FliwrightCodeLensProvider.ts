import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadConfig } from '../config.js';

const FLIWRIGHT_IMPORT = '@fliwright/vitest';

export class FliwrightCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!loadConfig().codeLensEnabled || !isLikelyFliwrightTest(document)) {
      return [];
    }

    const top = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    return [
      new vscode.CodeLens(top, {
        title: 'Run Fliwright Test',
        command: 'fliwright.runCurrentTest',
        arguments: [{ kind: 'testFile', uri: document.uri, label: path.basename(document.uri.fsPath) }],
      }),
      new vscode.CodeLens(top, {
        title: 'Run Test With Failure Context',
        command: 'fliwright.runCurrentTest',
        arguments: [{ kind: 'testFile', uri: document.uri, label: path.basename(document.uri.fsPath) }],
      }),
      new vscode.CodeLens(top, {
        title: 'Record After This Test',
        command: 'fliwright.startRecording',
      }),
    ];
  }
}

function isLikelyFliwrightTest(document: vscode.TextDocument): boolean {
  const fileName = document.uri.fsPath;
  if (fileName.endsWith('.test.ts') || fileName.endsWith('.spec.ts')) {
    return true;
  }

  const text = document.getText();
  return text.includes(FLIWRIGHT_IMPORT);
}
