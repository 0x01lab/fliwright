import * as vscode from 'vscode';

export async function readJson<T>(uri: vscode.Uri): Promise<T> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const raw = Buffer.from(bytes).toString('utf8');
  return JSON.parse(raw) as T;
}

export async function writeJson(uri: vscode.Uri, value: unknown): Promise<void> {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(raw, 'utf8'));
}

export function jsonErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

