import {
  ensureFliwrightRunsRoot,
  resolveFliwrightRunsRoot,
  legacyProjectRunsRoot as coreLegacyProjectRunsRoot,
  projectRunsRoot as coreProjectRunsRoot,
  projectRunsRootCandidates as coreProjectRunsRootCandidates,
  sanitizeProjectPathName,
} from '@fliwright/core';
import type { ProjectRunsRootResult } from '@fliwright/core';
import { dirname } from 'node:path';
import { resolveProjectConfig } from '@fliwright/cli';
import type * as vscode from 'vscode';

export type { ProjectRunsRootResult };

export interface ProjectRunsRootOptions {
  /** Override the user home (for tests). Defaults to os.homedir(). */
  homeDir?: string;
  runsRoot?: string;
}

export function projectRunsRoot(
  workspaceRoot: vscode.Uri,
  options: ProjectRunsRootOptions = {},
): ProjectRunsRootResult {
  const runsDir = resolveFliwrightRunsRoot({ projectRoot: workspaceRoot.fsPath, runsRoot: options.runsRoot });
  return { ...coreProjectRunsRoot(workspaceRoot.fsPath, options), rootDir: dirname(runsDir), runsDir };
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
  const config = await resolveProjectConfig(workspaceRoot.fsPath, { runsRoot: options.runsRoot });
  return ensureFliwrightRunsRoot({
    projectRoot: workspaceRoot.fsPath,
    runsRoot: config.runsRoot,
    projectPath: workspaceRoot.fsPath,
    homeDir: options.homeDir,
  });
}

export { sanitizeProjectPathName };
