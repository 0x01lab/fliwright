import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { TestReportService } from '../src/testing/TestReportService.js';
import type { TestCaseNode } from '../src/testing/types.js';

const roots: string[] = [];
beforeEach(() => vi.restoreAllMocks());
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-test-report-')); roots.push(root);
  await writeFile(join(root, 'fliwright.config.ts'), "export default { runsRoot: 'history' };");
  const node: TestCaseNode = { kind: 'testCase', id: 'checks/cart.test.ts::suite/checkout', label: 'checkout',
    testNamePattern: '^suite checkout$', status: 'failed', fileUri: vscode.Uri.file(join(root, 'checks/cart.test.ts')) };
  const runDir = join(root, 'history', 'failed-run');
  const attemptDir = join(runDir, 'tests/task/attempts/attempt-0');
  await mkdir(attemptDir, { recursive: true });
  await writeFile(join(runDir, 'run.json'), JSON.stringify({ schemaVersion: 1, runId: 'failed-run',
    status: 'failed', evidenceStatus: 'partial', tests: [{ testId: 'opaque-task',
      attempts: [{ attemptId: 'attempt-0', resultPath: 'tests/task/attempts/attempt-0/result.json' }] }] }));
  await writeFile(join(attemptDir, 'result.json'), JSON.stringify({ testName: 'checkout',
    testFile: 'checks/cart.test.ts', testPath: ['suite', 'checkout'], status: 'failed', evidenceStatus: 'partial' }));
  await writeFile(join(runDir, 'report.json'), JSON.stringify({ passed: false, status: 'failed', totalTests: 1,
    results: [{ name: 'suite checkout', file: 'checks/cart.test.ts', passed: false, status: 'failed', duration: 10, error: 'Expected checkout' }] }));
  return { root: vscode.Uri.file(root), runDir, node, output: join(runDir, 'test-report.html') };
}

it('generates an offline report for a failed run without a timeline, using the configured history', async () => {
  const f = await fixture();
  const picker = vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async items => (items as any[])[0]);
  vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(vscode.Uri.file(f.output));
  const open = vi.spyOn(vscode.env, 'openExternal');
  const result = await new TestReportService().generateForTest(f.root, f.node);
  expect(result).toMatchObject({ runId: 'failed-run', output: f.output, partial: true, releaseReady: false });
  expect(picker.mock.calls[0]?.[1]).toMatchObject({ placeHolder: expect.stringContaining('all tests') });
  expect(await readFile(f.output, 'utf8')).toContain('Expected checkout');
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ fsPath: f.output }));
});

it.each(['', 'tests/task/attempts/attempt-0'])('generates the exact viewed run from its directory (%s) without a run picker', async subdirectory => {
  const f = await fixture();
  const picker = vi.spyOn(vscode.window, 'showQuickPick');
  vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(vscode.Uri.file(f.output));
  const result = await new TestReportService().generateForRun(f.root, vscode.Uri.file(join(f.runDir, subdirectory)));
  expect(result).toMatchObject({ runId: 'failed-run', output: f.output, releaseReady: false });
  expect(picker).not.toHaveBeenCalled();
  expect(await readFile(f.output, 'utf8')).toContain('Expected checkout');
});

it('does not substitute workspace history when the viewed run has no canonical manifest', async () => {
  const f = await fixture();
  const legacy = join(f.root.fsPath, 'legacy-view');
  await mkdir(legacy);
  const save = vi.spyOn(vscode.window, 'showSaveDialog');
  const error = vi.spyOn(vscode.window, 'showErrorMessage');
  expect(await new TestReportService().generateForRun(f.root, vscode.Uri.file(legacy))).toBeUndefined();
  expect(error).toHaveBeenCalledWith(expect.stringContaining('run.json'));
  expect(save).not.toHaveBeenCalled();
});

it('does not use a same-title test from a different file or a skipped sibling', async () => {
  const f = await fixture();
  const info = vi.spyOn(vscode.window, 'showInformationMessage');
  const save = vi.spyOn(vscode.window, 'showSaveDialog');
  expect(await new TestReportService().generateForTest(f.root, { ...f.node,
    id: 'checks/other.test.ts::suite/checkout', fileUri: vscode.Uri.file(join(f.root.fsPath, 'checks/other.test.ts')) })).toBeUndefined();
  await writeFile(join(f.runDir, 'report.json'), JSON.stringify({ results: [{ name: 'suite checkout',
    file: 'checks/cart.test.ts', status: 'skipped', passed: false, duration: 0 }] }));
  await writeFile(join(f.runDir, 'tests/task/attempts/attempt-0/result.json'), JSON.stringify({
    testFile: 'checks/cart.test.ts', testPath: ['suite', 'checkout'], status: 'skipped' }));
  expect(await new TestReportService().generateForTest(f.root, f.node)).toBeUndefined();
  expect(info).toHaveBeenCalledWith(expect.stringContaining('Run this test first'));
  expect(save).not.toHaveBeenCalled();
});

it('does not generate a report when selection or saving is cancelled', async () => {
  const f = await fixture();
  const picker = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);
  const save = vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(undefined);
  expect(await new TestReportService().generateForTest(f.root, f.node)).toBeUndefined();
  expect(save).not.toHaveBeenCalled();
  picker.mockImplementation(async items => (items as any[])[0]);
  expect(await new TestReportService().generateForTest(f.root, f.node)).toBeUndefined();
  expect(await readFile(f.output).catch(() => undefined)).toBeUndefined();
});

it('finds plain Vitest results with suite separators and no recorded fixture attempts', async () => {
  const f = await fixture();
  await writeFile(join(f.runDir, 'run.json'), JSON.stringify({ schemaVersion: 1, runId: 'failed-run',
    status: 'failed', evidenceStatus: 'partial', tests: [] }));
  await writeFile(join(f.runDir, 'report.json'), JSON.stringify({ results: [{ name: 'suite > checkout',
    file: f.node.fileUri.fsPath, passed: false, status: 'failed', duration: 1, error: 'Plain test failed' }] }));
  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async items => (items as any[])[0]);
  vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(vscode.Uri.file(f.output));
  expect(await new TestReportService().generateForTest(f.root, f.node)).toMatchObject({ runId: 'failed-run' });
  expect(await readFile(f.output, 'utf8')).toContain('Plain test failed');
});

it.each([false, true])('reuses the selected run snapshot and keeps unexecuted plan cases as release blockers (review=%s)', async withReview => {
  const f = await fixture();
  const plan = { schemaVersion: 2, generatedAt: '2026-11-08T01:00:00Z', items: [{
    source: { id: 'gid://gitlab/WorkItem/1', iid: '1', url: 'https://gitlab.example.com/mobile/app/-/work_items/1',
      namespace: 'mobile/app', type: 'Task', title: 'Checkout acceptance', description: 'Check checkout and refunds',
      updatedAt: '2026-11-08T01:00:00Z', fetchedAt: '2026-11-08T01:00:00Z', comments: [] },
    basis: 'requirements', acceptanceCriteria: [{ id: 'AC-1', text: 'Checkout and refunds work',
      source: { kind: 'description', quote: 'Check checkout and refunds' } }],
    cases: ['checkout', 'refund'].map(title => ({ id: title, title, description: `Verify ${title}`,
      acceptanceCriteria: ['AC-1'], preconditions: [], steps: [{ action: title, expectedResult: 'success' }],
      expectedResult: 'success', automation: { status: 'complete' }, binding: { file: 'checks/cart.test.ts', name: `suite ${title}` } })),
    openQuestions: [],
  }] };
  await writeFile(join(f.runDir, 'test-plan.json'), JSON.stringify(plan));
  if (withReview) await writeFile(join(f.runDir, 'release-review.review.json'), JSON.stringify({ runId: 'failed-run',
    plan: 'test-plan.json', release: { app: 'Checkout App', version: '1.0' } }));
  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async items => (items as any[])[0]);
  vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(vscode.Uri.file(f.output));
  const result = await new TestReportService().generateForTest(f.root, f.node);
  expect(result).toMatchObject({ plannedCases: 2, releaseReady: false,
    reviewPath: join(f.runDir, withReview ? 'release-review.review.json' : 'test-report.review.json') });
  expect(result?.blockers).toContainEqual(expect.stringContaining('refund'));
  const html = await readFile(f.output, 'utf8');
  if (withReview) expect(html).toContain('Checkout App');
  expect(html).toContain('Checkout acceptance');
  expect(await readFile(join(f.runDir, 'test-plan.json'), 'utf8')).toBe(JSON.stringify(plan));
});

it('preserves existing output and reports generation errors without opening it', async () => {
  const f = await fixture();
  await writeFile(f.output, 'original');
  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async items => (items as any[])[0]);
  vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(vscode.Uri.file(f.output));
  const error = vi.spyOn(vscode.window, 'showErrorMessage');
  const open = vi.spyOn(vscode.env, 'openExternal');
  expect(await new TestReportService().generateForTest(f.root, f.node)).toBeUndefined();
  expect(await readFile(f.output, 'utf8')).toBe('original');
  expect(error).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  expect(open).not.toHaveBeenCalled();
});
