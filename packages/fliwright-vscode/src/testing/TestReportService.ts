import { randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import * as vscode from 'vscode';
import { resolveProjectConfig } from '@fliwright/cli';
import { artifactsReportCommand } from '@fliwright/cli/run';
import { runManifestSchema } from '@fliwright/core';
import type { TestCaseNode } from './types.js';

interface ReportRun extends vscode.QuickPickItem { runId: string; runDir: string; modifiedAt: number; }

/** Generate the existing CLI HTML report from a selected test's saved execution evidence. */
export class TestReportService {
  async generateForTest(root: vscode.Uri, node: TestCaseNode) {
    try {
      const config = await resolveProjectConfig(root.fsPath);
      const runsRoot = config.runsRoot;
      if (!runsRoot) throw new Error('Project run history could not be resolved.');
      const runs = await this.findRuns(root.fsPath, runsRoot, node);
      if (!runs.length) {
        await vscode.window.showInformationMessage('No saved execution found for this test. Run this test first to generate a report.');
        return undefined;
      }
      const selected = await vscode.window.showQuickPick(runs, {
        title: `Generate Test Report: ${node.label}`,
        placeHolder: 'Select a run — the report includes all tests in that run.',
      });
      if (!selected) return undefined;
      return await this.generate(root.fsPath, selected.runDir, selected.runId);
    } catch (error) {
      await vscode.window.showErrorMessage(`Failed to generate test report: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /** Generate the displayed run, including when the viewer is scoped to a nested attempt. */
  async generateForRun(root: vscode.Uri | undefined, viewedDirectory: vscode.Uri) {
    try {
      const viewedPath = await realpath(viewedDirectory.fsPath);
      let directory = viewedPath;
      while (true) {
        const raw = await readJson(join(directory, 'run.json'));
        if (raw) {
          const manifest = runManifestSchema.parse(raw);
          const ownsView = directory === viewedPath || manifest.tests.some(test => test.attempts.some(attempt =>
            dirname(resolve(directory, attempt.resultPath)) === viewedPath));
          if (!ownsView) throw new Error('The displayed attempt is not listed in run.json.');
          if (manifest.runId !== basename(directory)) throw new Error('The run folder must match its runId to generate a report.');
          if (manifest.status === 'running') throw new Error('Wait for this run to finish before generating a report.');
          return await this.generate(root?.fsPath ?? directory, directory, manifest.runId);
        }
        const parent = dirname(directory);
        if (parent === directory) throw new Error('No run.json found for the displayed run. Run this test again to record report evidence.');
        directory = parent;
      }
    } catch (error) {
      await vscode.window.showErrorMessage(`Failed to generate test report: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async generate(projectRoot: string, runDir: string, runId: string) {
    const destination = await vscode.window.showSaveDialog({
      title: `Save report for run ${runId} (all tests)`,
      defaultUri: vscode.Uri.file(join(runDir, `test-report-${randomUUID().slice(0, 8)}.html`)),
      filters: { 'HTML report': ['html'] }, saveLabel: 'Generate Report',
    });
    if (!destination) return undefined;
    const reviewOptions = await reviewInput(join(runDir, 'release-review.review.json'), join(runDir, 'test-plan.json'));
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Generating test report…' },
      () => artifactsReportCommand({ cwd: projectRoot, runsRoot: dirname(runDir), runId,
        output: destination.fsPath, allowPartial: true, ...reviewOptions }));
    await vscode.env.openExternal(vscode.Uri.file(result.output));
    await vscode.window.showInformationMessage(result.releaseReady
      ? 'Test report generated. Tests qualified; manual release review is still required.'
      : 'Test report generated with release blockers. See the report for details.');
    return result;
  }

  private async findRuns(projectRoot: string, runsRoot: string, node: TestCaseNode): Promise<ReportRun[]> {
    const entries = await readdir(runsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const runs: ReportRun[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(entry.name)) continue;
      const runDir = join(runsRoot, entry.name);
      const parsed = runManifestSchema.safeParse(await readJson(join(runDir, 'run.json')));
      if (!parsed.success || parsed.data.runId !== entry.name || parsed.data.status === 'running') continue;
      let matched = false;
      const actualRoot = await realpath(runDir);
      for (const test of parsed.data.tests) {
        for (const attempt of test.attempts) {
          const resultPath = resolve(runDir, attempt.resultPath);
          // Inspect only evidence contained in this run, including symlink targets.
          const actualPath = await realpath(resultPath).catch(() => undefined);
          if (!actualPath || !within(actualRoot, actualPath)) continue;
          const result = await readJson(actualPath);
          if (!result || result.status === 'skipped' || result.status === 'running') continue;
          if (test.testId === node.id || (fileMatches(projectRoot, result.testFile, node.fileUri.fsPath)
            && Array.isArray(result.testPath) && result.testPath.every(part => typeof part === 'string')
            && `${relative(projectRoot, node.fileUri.fsPath).split(sep).join('/')}::${result.testPath.join('/')}` === node.id)) matched = true;
        }
      }
      // Plain Vitest tests can have runner results without any fixture timeline/attempt.
      if (!matched) {
        const report = await readJson(join(runDir, 'report.json'));
        const pattern = new RegExp(node.testNamePattern);
        matched = Array.isArray(report?.results) && report.results.some((test: unknown) =>
          isRecord(test) && test.status !== 'skipped' && test.status !== 'running' && typeof test.name === 'string'
          && fileMatches(projectRoot, test.file, node.fileUri.fsPath)
          && (pattern.test(test.name) || pattern.test(test.name.replaceAll(' > ', ' '))));
      }
      if (!matched) continue;
      const modifiedAt = (await stat(join(runDir, 'run.json'))).mtimeMs;
      runs.push({ runId: entry.name, runDir, modifiedAt, label: entry.name,
        description: `${parsed.data.status} · ${new Date(modifiedAt).toLocaleString()}`,
        detail: 'Generate an offline HTML report for all tests in this run.' });
    }
    return runs.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }
}

async function reviewInput(review: string, plan: string): Promise<{ review?: string; plan?: string }> {
  if (await stat(review).catch(() => undefined)) return { review };
  if (await stat(plan).catch(() => undefined)) return { plan };
  return {};
}

function fileMatches(projectRoot: string, actual: unknown, expected: string): boolean {
  return typeof actual === 'string' && resolve(projectRoot, actual.replaceAll('\\', '/')) === expected;
}

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isRecord(value) ? value : undefined;
  } catch { return undefined; }
}
