import * as path from 'node:path';
import { realpathSync } from 'node:fs';
import type * as vscode from 'vscode';
import type { TestCaseResult } from '../types.js';

/**
 * Workspace-relative path with FORWARD slashes, matching the relPath form used
 * by `TestStatusStore.recordRun` and `testNodeId` — `<a>/<b>/<c>.ts`.
 *
 * Getting this form right is load-bearing for status patching: the relPath
 * string is hashed into the test node id, so a separator or normalization
 * mismatch between the producer (here, when recording a run) and the consumer
 * (the `testNodeId` helper in `testing/types.ts`, used by both
 * `TestStatusStore.recordRun` and `TestsTreeProvider`) silently no-ops the
 * status join.
 *
 * Shared between `extension.ts` (run recording) and `TestsTreeProvider`
 * (root discovery) to keep the two producers identical.
 */
export function relPathOf(root: Pick<vscode.Uri, 'fsPath'>, uri: Pick<vscode.Uri, 'fsPath'>): string {
  const rel = path.relative(realPathOrOriginal(root.fsPath), realPathOrOriginal(uri.fsPath));
  return rel.split(path.sep).join('/');
}

export function relPathForTestCase(root: Pick<vscode.Uri, 'fsPath'>, fallback: string, test: TestCaseResult): string {
  if (!test.filePath) return fallback;
  if (!path.isAbsolute(test.filePath) && !test.filePath.includes('/') && fallback.endsWith(`/${test.filePath}`)) return fallback;
  return (path.isAbsolute(test.filePath) ? relPathOf(root, { fsPath: test.filePath }) : test.filePath).replace(/\\/g, '/');
}

function realPathOrOriginal(value: string): string {
  try { return realpathSync.native(value); } catch { return value; }
}
