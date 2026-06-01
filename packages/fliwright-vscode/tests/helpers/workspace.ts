import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { __setConfiguration, __setWorkspaceRoot } from 'vscode';

export async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'fliwright-vscode-'));
  __setWorkspaceRoot(root);
  __setConfiguration({});
  return root;
}

export async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeText(root: string, relativePath: string, value: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
}

export async function readText(root: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}
