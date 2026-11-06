import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchItems, assemblePlan, validatePlan, bindCase } from '../src/index.js';
import { executeCli } from '../src/cli.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const url = 'https://gitlab.example.com/mobile/app/-/work_items/128';
const source = { id: 'gid://gitlab/WorkItem/900', iid: '128', url, namespace: 'mobile/app', type: 'Task', title: '优惠券结算',
  description: '实付金额应扣减优惠金额。金额不能小于零。', updatedAt: '2026-11-03T01:00:00Z', fetchedAt: '2026-11-03T02:00:00Z',
  comments: [{ id: 'note-1', body: '优惠券不能叠加。', updatedAt: '2026-11-03T01:00:00Z' }] };
const criterion = { id: 'AC-01', text: '优惠金额计入实付金额', source: { kind: 'description', quote: '实付金额应扣减优惠金额。' } };
const entry = { title: '优惠券抵扣', description: '验证实付金额', acceptanceCriteria: ['AC-01'], preconditions: ['有可用优惠券'],
  steps: [{ action: '应用优惠券并提交订单', expectedResult: '提交成功' }], expectedResult: '实付金额扣减优惠金额' };
const draft = () => ({ items: [{ sourceUrl: url, basis: 'acceptance-checklist', acceptanceCriteria: [structuredClone(criterion)], cases: [structuredClone(entry)], openQuestions: [] as string[] }] });
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'skill-test-plan-')); roots.push(cwd);
  const snapshot = join(cwd, 'snapshot.json'), draftPath = join(cwd, 'draft.json'), output = join(cwd, 'plan.json');
  await writeFile(snapshot, JSON.stringify({ schemaVersion: 1, items: [source] }));
  await writeFile(draftPath, JSON.stringify(draft()));
  const catalog = join(cwd, 'catalog.json');
  await writeFile(catalog, JSON.stringify({ suites: [{ cases: [{ file: 'checkout.test.ts', titlePath: ['优惠券抵扣'] }] }] }));
  return { cwd, snapshot, draft: draftPath, output, catalog };
}
it('fetches a source snapshot without invoking an AI provider', async () => {
  const f = await fixture();
  const execute = vi.fn().mockResolvedValue(JSON.stringify({ data: { namespace: { workItem: { ...source, webUrl: url,
    workItemType: { name: 'Task' }, widgets: [{ __typename: 'WorkItemWidgetDescription', description: source.description }] } } } }));
  const result = await fetchItems({ items: [url], output: join(f.cwd, 'fetched.json') }, { execute });
  expect(result.snapshot.items[0].description).toBe(source.description);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0]).toBe('glab');
});
it('assembles AI-authored cases against saved acceptance criteria without any provider call', async () => {
  const f = await fixture();
  const first = await assemblePlan(f);
  const second = await assemblePlan({ ...f, output: join(f.cwd, 'plan-2.json') });
  expect(first.plan.items[0].cases[0]).toMatchObject({ ...entry, id: expect.stringMatching(/^GL-128-/) });
  expect(first.plan.items[0].cases[0].id).toBe(second.plan.items[0].cases[0].id);
  expect(first.plan.items[0].acceptanceCriteria).toEqual([criterion]);
  expect(first.plan.schemaVersion).toBe(2);
  expect(first.plan.items[0].cases[0].automation).toEqual({ status: 'pending' });
  const validation = await validatePlan({ plan: first.output });
  expect(validation).toMatchObject({ valid: true, cases: 1, acceptanceCriteria: 1, coverage: { pending: 1, partial: 0, blocked: 0, complete: 0 }, automationComplete: false, openQuestions: 0 });
  const bound = await bindCase({ plan: first.output, caseId: first.plan.items[0].cases[0].id, file: 'checkout.test.ts', name: '优惠券抵扣', catalog: f.catalog, output: join(f.cwd, 'bound.json') });
  expect(bound.plan.items[0].cases[0].acceptanceCriteria).toEqual(['AC-01']);
});
it.each(['missing-reference', 'invented-quote', 'missing-comment', 'uncovered', 'duplicate-criterion', 'missing-item'])('rejects invalid acceptance traceability (%s)', async fault => {
  const f = await fixture(), invalid = draft();
  if (fault === 'missing-reference') invalid.items[0].cases[0].acceptanceCriteria = ['AC-99'];
  if (fault === 'invented-quote') invalid.items[0].acceptanceCriteria[0].source.quote = '任何优惠券都能叠加';
  if (fault === 'missing-comment') Object.assign(invalid.items[0].acceptanceCriteria[0].source, { kind: 'comment', commentId: 'unknown' });
  if (fault === 'uncovered') invalid.items[0].acceptanceCriteria.push({ ...criterion, id: 'AC-02' });
  if (fault === 'duplicate-criterion') invalid.items[0].acceptanceCriteria.push(criterion);
  if (fault === 'missing-item') invalid.items = [];
  await writeFile(f.draft, JSON.stringify(invalid));
  await expect(assemblePlan(f)).rejects.toThrow();
  await expect(readFile(f.output)).rejects.toThrow();
});
it('retains unresolved acceptance standards as explicit questions rather than fabricating coverage', async () => {
  const f = await fixture(), unclear = draft(); unclear.items[0].cases = []; unclear.items[0].openQuestions = ['优惠券的使用门槛未定义'];
  await writeFile(f.draft, JSON.stringify(unclear));
  await assemblePlan(f);
  expect(await validatePlan({ plan: f.output })).toMatchObject({ valid: true, cases: 0, uncoveredCriteria: 1, openQuestions: 1 });
});
it('accepts comment-sourced criteria only when their quote exists in the referenced comment', async () => {
  const f = await fixture(), input = draft();
  Object.assign(input.items[0].acceptanceCriteria[0], { text: '优惠券不能叠加', source: { kind: 'comment', commentId: 'note-1', quote: '优惠券不能叠加。' } });
  await writeFile(f.draft, JSON.stringify(input));
  expect((await assemblePlan(f)).plan.items[0].acceptanceCriteria[0].source.commentId).toBe('note-1');
});
it('uses fetch / assemble / validate / bind commands and removes nested AI generation', async () => {
  const f = await fixture();
  const help = await executeCli(['--help']);
  expect(help.stdout).toContain('fetch'); expect(help.stdout).toContain('assemble'); expect(help.stdout).toContain('validate');
  expect((await executeCli(['generate'])).exitCode).toBe(2);
  const assembled = await executeCli(['assemble', '--snapshot', f.snapshot, '--draft', f.draft, '--output', f.output]);
  expect(assembled.exitCode, assembled.stderr).toBe(0);
  const validated = await executeCli(['validate', f.output]);
  expect(validated.exitCode).toBe(0); expect(JSON.parse(validated.stdout).valid).toBe(true);
});

it('records requirements as the fallback basis when the skill found no acceptance checklist', async () => {
  const f = await fixture(), input = draft();
  input.items[0].basis = 'requirements';
  await writeFile(f.draft, JSON.stringify(input));
  expect((await assemblePlan(f)).plan.items[0].basis).toBe('requirements');
});
it('preserves output plans and does not write after cancellation', async () => {
  const f = await fixture();
  await writeFile(f.output, 'keep original');
  await expect(assemblePlan(f)).rejects.toThrow(/exists/);
  expect(await readFile(f.output, 'utf8')).toBe('keep original');
  const controller = new AbortController(); controller.abort();
  const output = join(f.cwd, 'cancelled.json');
  await expect(assemblePlan({ ...f, output, signal: controller.signal })).rejects.toThrow();
  await expect(readFile(output)).rejects.toThrow();
});
it('does not inherit a stable case identity when the linked acceptance standard changes', async () => {
  const f = await fixture(); const first = await assemblePlan(f), edited = draft();
  edited.items[0].acceptanceCriteria[0].text = '优惠抵扣金额准确计入实付金额';
  await writeFile(f.draft, JSON.stringify(edited));
  const second = await assemblePlan({ ...f, output: join(f.cwd, 'updated.json') });
  expect(first.plan.items[0].cases[0].id).not.toBe(second.plan.items[0].cases[0].id);
});

it('records partial coverage and blockers atomically, checks catalog references and enforces script delivery', async () => {
  const f = await fixture(), input = draft();
  input.items[0].cases.push({ ...structuredClone(entry), title: '金额边界' });
  await writeFile(f.draft, JSON.stringify(input));
  const first = await assemblePlan(f);
  const updates = join(f.cwd, 'updates.json'), catalog = join(f.cwd, 'catalog.json'), output = join(f.cwd, 'coverage.json');
  const ref = { file: 'checkout.test.ts', name: 'checkout applies coupon' };
  await writeFile(catalog, JSON.stringify({ suites: [{ cases: [{ file: ref.file, titlePath: ['checkout', 'applies coupon'] }] }] }));
  await writeFile(updates, JSON.stringify({ cases: [
    { caseId: first.plan.items[0].cases[0].id, automation: { status: 'partial', reason: '缺少边界断言', tests: [ref] } },
    { caseId: first.plan.items[0].cases[1].id, automation: { status: 'blocked', reason: '金额上限待确认' } },
  ] }));
  const result = await executeCli(['update', first.output, '--updates', updates, '--catalog', catalog, '--output', output]);
  expect(result.exitCode, result.stderr).toBe(0);
  const check = await executeCli(['validate', output, '--catalog', catalog, '--require-scripts']);
  expect(check.exitCode).toBe(1);
  expect(JSON.parse(check.stdout)).toMatchObject({ valid: true, automationComplete: false, coverage: { pending: 0, partial: 1, blocked: 1, complete: 0 } });
  const complete = first.plan.items[0].cases.map((c, i) => ({ caseId: c.id, automation: { status: 'complete' }, binding: { ...ref, name: i ? 'checkout boundary' : ref.name } }));
  await writeFile(updates, JSON.stringify({ cases: complete }));
  const rejected = await executeCli(['update', output, '--updates', updates, '--catalog', catalog, '--output', join(f.cwd, 'bad.json')]);
  expect(rejected.exitCode).not.toBe(0);
  await expect(readFile(join(f.cwd, 'bad.json'))).rejects.toThrow();
  await writeFile(catalog, JSON.stringify({ suites: [{ cases: complete.map(c => ({ file: c.binding.file, titlePath: [c.binding.name] })) }] }));
  const completed = join(f.cwd, 'complete.json');
  expect((await executeCli(['update', output, '--updates', updates, '--catalog', catalog, '--output', completed])).exitCode).toBe(0);
  expect((await executeCli(['validate', completed, '--catalog', catalog, '--require-scripts'])).exitCode).toBe(0);
});

it.each([
  { status: 'partial', reason: '缺少断言', tests: [] },
  { status: 'blocked', reason: '' },
  { status: 'complete' },
])('rejects invalid automation declarations without writing output (%j)', async automation => {
  const f = await fixture(), first = await assemblePlan(f), updates = join(f.cwd, 'updates.json'), output = join(f.cwd, 'invalid.json');
  await writeFile(updates, JSON.stringify({ cases: [{ caseId: first.plan.items[0].cases[0].id, automation }] }));
  expect((await executeCli(['update', first.output, '--updates', updates, '--output', output])).exitCode).not.toBe(0);
  await expect(readFile(output)).rejects.toThrow();
});

it('completes the script-delivery flow for requirements without a checklist', async () => {
  const f = await fixture(), input = draft();
  input.items[0].basis = 'requirements';
  await writeFile(f.draft, JSON.stringify(input));
  const first = await assemblePlan(f);
  expect((await executeCli(['validate', first.output, '--catalog', f.catalog, '--require-scripts'])).exitCode).toBe(1);
  const bound = await bindCase({ plan: first.output, catalog: f.catalog, caseId: first.plan.items[0].cases[0].id,
    file: 'checkout.test.ts', name: '优惠券抵扣', output: join(f.cwd, 'scripts.json') });
  const response = await executeCli(['validate', bound.output, '--catalog', f.catalog, '--require-scripts']);
  expect(response.exitCode, response.stderr).toBe(0);
  expect(JSON.parse(response.stdout)).toMatchObject({ automationComplete: true, scriptsReady: true, coverage: { complete: 1 } });
  expect(bound.plan.items[0].basis).toBe('requirements');
  expect(JSON.stringify(bound.plan)).not.toContain('passed');
});

it('checks missing and ambiguous collected tests without changing the original plan', async () => {
  const f = await fixture(), first = await assemblePlan(f), caseId = first.plan.items[0].cases[0].id;
  const catalog = join(f.cwd, 'ambiguous.json');
  await writeFile(catalog, JSON.stringify({ ok: true, data: { suites: [{ cases: [
    { file: 'checkout.test.ts', titlePath: ['优惠券抵扣'], duplicateIndex: 0 },
    { file: 'checkout.test.ts', titlePath: ['优惠券抵扣'], duplicateIndex: 1 },
  ] }] } }));
  const output = join(f.cwd, 'bound.json');
  await expect(bindCase({ plan: first.output, caseId, file: 'checkout.test.ts', name: '优惠券抵扣', catalog, output })).rejects.toThrow(/ambiguous/);
  await expect(readFile(output)).rejects.toThrow();
  expect(await validatePlan({ plan: first.output })).toMatchObject({ coverage: { pending: 1 } });
  await expect(bindCase({ plan: first.output, caseId, file: 'checkout.test.ts', name: 'missing test', catalog: f.catalog, output })).rejects.toThrow(/not found/);
});

it('deduplicates the same catalog task across suites and detects stale bindings during validation', async () => {
  const f = await fixture(), first = await assemblePlan(f);
  const c = { file: 'checkout.test.ts', titlePath: ['优惠券抵扣'], duplicateIndex: 0 };
  await writeFile(f.catalog, JSON.stringify({ suites: [{ cases: [c] }, { cases: [c] }] }));
  const bound = await bindCase({ plan: first.output, caseId: first.plan.items[0].cases[0].id,
    file: c.file, name: c.titlePath[0], catalog: f.catalog, output: join(f.cwd, 'ready.json') });
  expect(await validatePlan({ plan: bound.output, catalog: f.catalog })).toMatchObject({ scriptsReady: true });
  await writeFile(f.catalog, JSON.stringify({ suites: [{ cases: [] }] }));
  const result = await executeCli(['validate', bound.output, '--catalog', f.catalog, '--require-scripts']);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout).catalogIssues).toHaveLength(1);
  expect((await executeCli(['validate', bound.output, '--require-scripts'])).exitCode).toBe(1);
});

it.each(['duplicate-id', 'unknown-id', 'duplicate-test', 'cancelled', 'existing-output'])('does not publish a partial automation batch (%s)', async fault => {
  const f = await fixture(), input = draft();
  input.items[0].cases.push({ ...structuredClone(entry), title: '金额边界' });
  await writeFile(f.draft, JSON.stringify(input));
  const first = await assemblePlan(f), updates = join(f.cwd, 'updates.json'), output = join(f.cwd, 'out.json');
  const changes: Array<{ caseId: string; automation: { status: string; reason?: string }; binding?: { file: string; name: string } }> = first.plan.items[0].cases.map(c => ({ caseId: c.id, automation: { status: 'blocked', reason: '测试环境缺少数据' } }));
  if (fault === 'duplicate-id') changes[1].caseId = changes[0].caseId;
  if (fault === 'unknown-id') changes[1].caseId = 'missing';
  if (fault === 'duplicate-test') for (const c of changes) { c.automation = { status: 'complete' }; c.binding = { file: 'checkout.test.ts', name: '优惠券抵扣' }; }
  await writeFile(updates, JSON.stringify({ cases: changes }));
  if (fault === 'existing-output') await writeFile(output, 'keep original');
  const controller = new AbortController();
  if (fault === 'cancelled') controller.abort();
  const { updateAutomation } = await import('../src/index.js');
  await expect(updateAutomation({ plan: first.output, updates, catalog: f.catalog, output, signal: controller.signal })).rejects.toThrow();
  if (fault === 'existing-output') expect(await readFile(output, 'utf8')).toBe('keep original');
  else await expect(readFile(output)).rejects.toThrow();
  expect(await validatePlan({ plan: first.output })).toMatchObject({ coverage: { pending: 2 } });
});
