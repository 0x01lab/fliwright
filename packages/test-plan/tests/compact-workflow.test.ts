import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeCli } from '../src/cli.js';
import { assemblePlan, updateAutomation } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'compact-plan-')); roots.push(cwd);
  const url = 'https://gitlab.example.com/team/app/-/work_items/437';
  const snapshot = join(cwd, 'snapshot.json');
  const draft = { items: [{ sourceUrl: url, basis: 'acceptance-checklist',
    acceptanceCriteria: [{ id: 'AC-01', text: '显示引导', source: { kind: 'description', quote: '显示引导' } }],
    cases: [{ title: '引导 | 初始态', description: '核对引导', acceptanceCriteria: ['AC-01'], preconditions: ['新账户'],
      steps: [{ action: '进入首页', expectedResult: '显示引导' }], expectedResult: '显示引导' }], openQuestions: [] }] };
  await writeFile(snapshot, JSON.stringify({ schemaVersion: 1, items: [{ id: 'gid://gitlab/WorkItem/437', iid: '437', url,
    namespace: 'team/app', type: 'Issue', title: '首页引导', description: '显示引导', updatedAt: '2026-11-03T01:00:00Z',
    fetchedAt: '2026-11-03T02:00:00Z', comments: [] }] }));
  const draftPath = join(cwd, 'draft.json'); await writeFile(draftPath, JSON.stringify(draft));
  const catalog = join(cwd, 'catalog.json');
  await writeFile(catalog, JSON.stringify({ suites: [{ cases: [{ file: '.fliwright/tests/home.test.ts', titlePath: ['引导'] }] }] }));
  const output = join(cwd, 'plan.json');
  return { cwd, snapshot, draft, draftPath, catalog, output };
}

it('assembles from stdin and updates the canonical plan without persisting drafts or update files', async () => {
  const f = await fixture();
  const result = await executeCli(['assemble', '--snapshot', f.snapshot, '--draft', '-', '--output', f.output], { stdin: JSON.stringify(f.draft) });
  expect(result.exitCode, result.stderr).toBe(0);
  const plan = JSON.parse(await readFile(f.output, 'utf8'));
  // The original snapshot is embedded, so the plan remains independently verifiable.
  await rm(f.snapshot); await rm(f.draftPath);
  const updates = { cases: [{ caseId: plan.items[0].cases[0].id, automation: { status: 'complete' },
    binding: { file: '.fliwright/tests/home.test.ts', name: '引导' } }] };
  const updated = await executeCli(['update', f.output, '--updates', '-', '--catalog', f.catalog], { stdin: JSON.stringify(updates) });
  expect(updated.exitCode, updated.stderr).toBe(0);
  expect(JSON.parse(updated.stdout)).toMatchObject({ output: f.output, scriptsReady: true });
  expect(JSON.parse(await readFile(f.output, 'utf8')).items[0].source).toEqual(plan.items[0].source);
  expect(await readdir(f.cwd)).toEqual(expect.arrayContaining(['plan.json', 'catalog.json']));
  expect((await readdir(f.cwd)).sort()).toEqual(['catalog.json', 'plan.json']);
});

it('binds in place and validates against a piped catalog', async () => {
  const f = await fixture();
  const { plan } = await assemblePlan({ ...f, draft: f.draftPath });
  const catalog = await readFile(f.catalog, 'utf8');
  const bound = await executeCli(['bind', f.output, plan.items[0].cases[0].id, '--catalog', '-',
    '--file', '.fliwright/tests/home.test.ts', '--name', '引导'], { stdin: catalog });
  expect(bound.exitCode, bound.stderr).toBe(0);
  const checked = await executeCli(['validate', f.output, '--catalog', '-', '--require-scripts'], { stdin: catalog });
  expect(checked.exitCode, checked.stderr).toBe(0);
  expect(JSON.parse(checked.stdout).scriptsReady).toBe(true);
});

it.each(['invalid-json', 'unknown-case', 'missing-test', 'cancelled', 'locked'])('preserves the canonical plan when an update fails (%s)', async fault => {
  const f = await fixture();
  const { plan } = await assemblePlan({ ...f, draft: f.draftPath });
  const original = await readFile(f.output, 'utf8');
  const updates = join(f.cwd, 'updates.json');
  await writeFile(updates, fault === 'invalid-json' ? '{' : JSON.stringify({ cases: [{
    caseId: fault === 'unknown-case' ? 'missing' : plan.items[0].cases[0].id,
    automation: { status: 'complete' }, binding: { file: '.fliwright/tests/home.test.ts', name: fault === 'missing-test' ? 'missing' : '引导' },
  }] }));
  const controller = new AbortController();
  if (fault === 'cancelled') controller.abort();
  if (fault === 'locked') await writeFile(`${f.output}.lock`, 'another writer');
  await expect(updateAutomation({ plan: f.output, updates, catalog: f.catalog, signal: controller.signal })).rejects.toThrow();
  expect(await readFile(f.output, 'utf8')).toBe(original);
  const files = await readdir(f.cwd);
  expect(files.filter(file => file.startsWith('.test-plan-'))).toEqual([]);
  if (fault === 'locked') expect(await readFile(`${f.output}.lock`, 'utf8')).toBe('another writer');
  else expect(files).not.toContain('plan.json.lock');
});

it('rejects multiple stdin inputs rather than using one payload for unrelated schemas', async () => {
  const f = await fixture();
  const result = await executeCli(['assemble', '--snapshot', '-', '--draft', '-', '--output', f.output], { stdin: '{}' });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('Only one');
  await expect(readFile(f.output)).rejects.toThrow();
});

it('rejects in-place writes through symlinks and preserves an explicit existing output', async () => {
  const f = await fixture();
  const { plan } = await assemblePlan({ ...f, draft: f.draftPath });
  const alias = join(f.cwd, 'alias.json'); await symlink(f.output, alias);
  const updates = join(f.cwd, 'updates.json');
  await writeFile(updates, JSON.stringify({ cases: [{ caseId: plan.items[0].cases[0].id, automation: { status: 'blocked', reason: '没有设备' } }] }));
  await expect(updateAutomation({ plan: alias, updates })).rejects.toThrow(/regular file/);
  const existing = join(f.cwd, 'existing.json'); await writeFile(existing, 'keep');
  await expect(updateAutomation({ plan: f.output, updates, output: existing })).rejects.toThrow();
  expect(await readFile(existing, 'utf8')).toBe('keep');
  expect(JSON.parse(await readFile(f.output, 'utf8')).items[0].cases[0].automation.status).toBe('pending');
});

it('regenerates one coverage view with source quotes, test locations and explicit gaps', async () => {
  const f = await fixture();
  const { plan } = await assemblePlan({ ...f, draft: f.draftPath });
  const coverage = join(f.cwd, 'coverage.md');
  const first = await executeCli(['coverage', f.output]);
  expect(first.exitCode, first.stderr).toBe(0);
  const initial = await readFile(coverage, 'utf8');
  expect(initial).toContain(plan.items[0].cases[0].id);
  expect(initial).toContain('AC-01'); expect(initial).toContain('显示引导');
  expect(initial).toContain('引导 \\| 初始态');
  const updates = { cases: [{ caseId: plan.items[0].cases[0].id,
    automation: { status: 'partial', reason: '缺少返回首页后的状态断言', tests: [{ file: '.fliwright/tests/home.test.ts', name: '引导' }] } }] };
  const updated = await executeCli(['update', f.output, '--updates', '-', '--catalog', f.catalog], { stdin: JSON.stringify(updates) });
  expect(updated.exitCode, updated.stderr).toBe(0);
  expect((await executeCli(['coverage', f.output])).exitCode).toBe(0);
  const current = await readFile(coverage, 'utf8');
  expect(current).toContain('缺少返回首页后的状态断言');
  expect(current).toContain('.fliwright/tests/home.test.ts');
  expect(current).toContain('partial'); expect(current).not.toContain('| pending |');
  expect(current).toContain('不表示测试运行通过');
  const printed = await executeCli(['coverage', f.output, '--output', '-']);
  expect(printed.stdout).toBe(current);
  const rejected = await executeCli(['coverage', f.output, '--output', f.output]);
  expect(rejected.exitCode).not.toBe(0);
  expect(JSON.parse(await readFile(f.output, 'utf8')).schemaVersion).toBe(2);
});
