import {
  ensureFliwrightRunsRoot,
  legacyProjectRunsRoot as coreLegacyProjectRunsRoot,
  projectRunsRoot as coreProjectRunsRoot,
  projectRunsRootCandidates as coreProjectRunsRootCandidates,
  sanitizeProjectPathName,
} from '@fliwright/core';
import type { ProjectRunsRootResult } from '@fliwright/core';
import type * as vscode from 'vscode';

export type { ProjectRunsRootResult };

export interface ProjectRunsRootOptions {
  /** Override the user home (for tests). Defaults to os.homedir(). */
  homeDir?: string;
}

export function projectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): ProjectRunsRootResult {
  return coreProjectRunsRoot(workspaceRoot.fsPath, options);
}

export function legacyProjectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): ProjectRunsRootResult {
  return coreLegacyProjectRunsRoot(workspaceRoot.fsPath, options);
}

export function projectRunsRootCandidates(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): ProjectRunsRootResult[] {
  return coreProjectRunsRootCandidates(workspaceRoot.fsPath, options);
}

export async function ensureProjectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): Promise<string> {
  return ensureFliwrightRunsRoot({
    projectRoot: workspaceRoot.fsPath,
    projectPath: workspaceRoot.fsPath,
    homeDir: options.homeDir,
  });
}

export { sanitizeProjectPathName };
