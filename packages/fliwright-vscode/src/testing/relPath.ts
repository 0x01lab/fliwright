import * as path from 'node:path';
import type * as vscode from 'vscode';

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
export function relPathOf(root: vscode.Uri, uri: vscode.Uri): string {
  const rel = path.relative(root.fsPath, uri.fsPath);
  return rel.split(path.sep).join('/');
}
