import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { RunArtifactStore } from '../src/testing/RunArtifactStore.js';
import { TestStatusStore } from '../src/testing/TestStatusStore.js';
import { relPathOf } from '../src/testing/relPath.js';

describe('workspace path identity', () => {
  it.each(['artifact', 'status'] as const)('joins %s results from real paths to discovery through a workspace symlink', async (kind) => {
    const temp = await mkdtemp(join(tmpdir(), 'fliwright-path-identity-'));
    try {
      const project = join(temp, 'project');
      const alias = join(temp, 'workspace');
      await mkdir(join(project, '.fliwright/tests'), { recursive: true });
      await writeFile(join(project, '.fliwright/tests/form.test.ts'), '');
      await symlink(project, alias, 'dir');
      const root = vscode.Uri.file(alias);
      const discovered = relPathOf(root, vscode.Uri.file(join(alias, '.fliwright/tests/form.test.ts')));
      const reportedFile = await realpath(join(project, '.fliwright/tests/form.test.ts'));
      const result = { passed: true, totalTests: 1, passedTests: 1, failedTests: 0, duration: 1,
        results: [{ name: 'form > saves', filePath: reportedFile, passed: true, duration: 1 }] };
      const artifacts = new RunArtifactStore({ runsRoot: join(temp, 'runs') });
      const statuses = new TestStatusStore(join(temp, 'statuses'));
      if (kind === 'artifact') await artifacts.recordTestRun(root, result, discovered, { baseRunId: 'proof', ranAt: 1 });
      else await statuses.recordRun('proof', 1, root, result, discovered);
      const index = kind === 'artifact' ? await artifacts.loadIndex(root) : await statuses.loadIndex();
      expect([...index.keys()]).toEqual([`${discovered}::form/saves`]);
      expect(relPathOf(root, vscode.Uri.file(reportedFile))).toBe(discovered);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
