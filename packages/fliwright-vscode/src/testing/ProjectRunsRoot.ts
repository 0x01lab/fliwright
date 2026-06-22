import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type * as vscode from 'vscode';

export interface ProjectRunsRootResult {
  hash: string;
  rootDir: string;
  runsDir: string;
}

export interface ProjectRunsRootOptions {
  /** Override the user home (for tests). Defaults to os.homedir(). */
  homeDir?: string;
}

export function projectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): ProjectRunsRootResult {
  const home = options.homeDir ?? homedir();
  const hash = sanitizeProjectPathName(workspaceRoot.fsPath);
  const rootDir = join(home, '.fliwright', 'projects', hash);
  const runsDir = join(rootDir, 'runs');
  return { hash, rootDir, runsDir };
}

export function legacyProjectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): ProjectRunsRootResult {
  const home = options.homeDir ?? homedir();
  const hash = createHash('sha1').update(workspaceRoot.fsPath).digest('hex').slice(0, 12);
  const rootDir = join(home, '.fliwright', 'projects', hash);
  const runsDir = join(rootDir, 'runs');
  return { hash, rootDir, runsDir };
}

export function projectRunsRootCandidates(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): ProjectRunsRootResult[] {
  const primary = projectRunsRoot(workspaceRoot, options);
  const legacy = legacyProjectRunsRoot(workspaceRoot, options);
  return primary.rootDir === legacy.rootDir ? [primary] : [primary, legacy];
}

export async function ensureProjectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): Promise<string> {
  const { rootDir, runsDir } = projectRunsRoot(workspaceRoot, options);
  await mkdir(runsDir, { recursive: true });
  const now = Date.now();
  // Use Date.now() — this runs in the extension host, not a workflow script.
  await writeFile(join(rootDir, 'meta.json'), JSON.stringify({ projectPath: workspaceRoot.fsPath, updatedAt: now }, null, 2), 'utf8');
  return runsDir;
}

export function sanitizeProjectPathName(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  const name = normalized.replace(/\//g, '-').replace(/^-+|-+$/g, '');
  return name || 'project';
}
