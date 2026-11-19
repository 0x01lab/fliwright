import { loadConfig, resolveLoadedProjectConfig, type FliwrightCliConfig } from '@fliwright/cli';
import type { FliwrightProjectConfig } from '@fliwright/core';
import type * as vscode from 'vscode';

const projects = new Map<string, Promise<FliwrightCliConfig>>();

/** Share project imports between editor views; apply environment overrides at every boundary. */
export async function loadWorkspaceProjectConfig(
  root: vscode.Uri,
  explicit: Partial<FliwrightProjectConfig> = {},
): Promise<ReturnType<typeof resolveLoadedProjectConfig>> {
  const key = root.fsPath;
  for (;;) {
    let pending = projects.get(key);
    if (!pending) {
      pending = loadConfig(key);
      projects.set(key, pending);
    }
    let project: FliwrightCliConfig;
    try {
      project = await pending;
    } catch (error) {
      if (projects.get(key) !== pending) continue;
      projects.delete(key);
      throw error;
    }
    // A file change may have overtaken this import. Join the replacement.
    if (projects.get(key) !== pending) continue;
    return resolveLoadedProjectConfig(key, project, explicit);
  }
}

/** Invalidate immediately on source changes, before debounced view refreshes can reuse stale settings. */
export function invalidateWorkspaceProjectConfig(root: vscode.Uri): void {
  projects.delete(root.fsPath);
}
