import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { readGitLabItem } from './GitLab.js';
import type { Execute } from './process.js';
import { automationUpdateSchema, bindingSchema, parseItemUrl, planDraftSchema, sourceSnapshotSchema, testPlanSchema, type TestPlan } from './schema.js';
import { readJson, replaceFile, type InputOptions } from './files.js';

interface FileOptions { output: string; cwd?: string; signal?: AbortSignal; }
async function requireNewOutput(output: string) {
  try { await lstat(output); throw new Error('Output already exists; choose a new filename.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
async function saveJson(output: string, value: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await mkdir(dirname(output), { recursive: true });
  signal?.throwIfAborted();
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}
/** Fetch only requirement data. AI interpretation and case design belong to the calling skill. */
export async function fetchItems(options: FileOptions & { items: string[]; timeoutMs?: number }, deps: { execute?: Execute } = {}) {
  const cwd = options.cwd ?? process.cwd(), output = resolve(cwd, options.output);
  if (!options.items.length) throw new Error('At least one GitLab Item URL is required.');
  const targets = options.items.map(parseItemUrl);
  if (new Set(targets.map(target => `${target.host}/${target.namespace}/${target.iid}`)).size !== targets.length) throw new Error('Duplicate GitLab Item URLs.');
  await requireNewOutput(output);
  const items = [];
  for (const value of options.items) items.push(await readGitLabItem(value, { ...options, execute: deps.execute, cwd }));
  const snapshot = sourceSnapshotSchema.parse({ schemaVersion: 1, items });
  await saveJson(output, snapshot, options.signal);
  return { output, snapshot };
}
/** Validate a skill-authored draft against the original snapshot and assign content-derived IDs. No AI subprocess is started. */
export async function assemblePlan(options: FileOptions & InputOptions & { snapshot: string; draft: string }) {
  const cwd = options.cwd ?? process.cwd(), output = resolve(cwd, options.output);
  await requireNewOutput(output);
  const snapshot = sourceSnapshotSchema.parse(await readJson(options.snapshot, options));
  const draft = planDraftSchema.parse(await readJson(options.draft, options));
  if (draft.items.length !== snapshot.items.length || new Set(draft.items.map(item => item.sourceUrl)).size !== draft.items.length)
    throw new Error('The draft must include every snapshot Item exactly once.');
  const plan = testPlanSchema.parse({ schemaVersion: 2, generatedAt: new Date().toISOString(), items: snapshot.items.map(source => {
    const item = draft.items.find(entry => entry.sourceUrl === source.url);
    if (!item) throw new Error(`Draft is missing Item: ${source.url}`);
    const cases = item.cases.map(entry => ({ ...entry, automation: { status: 'pending' }, id: `GL-${source.iid}-${createHash('sha256')
      .update(JSON.stringify([parseItemUrl(source.url).host, source.id, entry.title, entry.description, entry.acceptanceCriteria.map(id => item.acceptanceCriteria.find(criterion => criterion.id === id)), entry.preconditions, entry.steps, entry.expectedResult])).digest('hex').slice(0, 20)}` }));
    return { source, basis: item.basis, acceptanceCriteria: item.acceptanceCriteria, cases, openQuestions: item.openQuestions };
  }) });
  await saveJson(output, plan, options.signal);
  return { output, plan };
}
/** Read a raw or CLI-enveloped Fliwright catalog without importing project code. */
async function readCatalog(path: string, options: InputOptions) {
  const raw = await readJson(path, options) as { ok?: boolean; data?: unknown };
  const data = raw.ok === true ? raw.data : raw;
  const catalog = z.object({ suites: z.array(z.object({ cases: z.array(z.object({
    file: bindingSchema.shape.file, titlePath: z.array(z.string().min(1)).min(1), duplicateIndex: z.number().int().nonnegative().default(0),
  })) })) }).parse(data);
  // The same collected task can occur in multiple suite selections.
  return [...new Map(catalog.suites.flatMap(suite => suite.cases).map(test => [JSON.stringify([test.file, test.titlePath, test.duplicateIndex]), test])).values()];
}
function references(entry: TestPlan['items'][number]['cases'][number]) {
  return entry.binding ? [entry.binding] : 'tests' in entry.automation ? entry.automation.tests ?? [] : [];
}
async function catalogIssues(plan: TestPlan, options: InputOptions & { catalog?: string }) {
  if (!options.catalog) return [];
  const tests = await readCatalog(options.catalog, options);
  return plan.items.flatMap(item => item.cases.flatMap(entry => references(entry).flatMap(ref => {
    const matches = tests.filter(test => test.file === ref.file && test.titlePath.join(' ') === ref.name);
    return matches.length === 1 ? [] : [{ caseId: entry.id, file: ref.file, name: ref.name,
      reason: matches.length ? 'Test title is ambiguous in catalog.' : 'Test not found in catalog.' }];
  })));
}
/** Structural validation and script coverage are separate; neither certifies execution. */
export async function validatePlan(options: InputOptions & { plan: string; catalog?: string }) {
  const plan = testPlanSchema.parse(JSON.parse(await readFile(resolve(options.cwd ?? process.cwd(), options.plan), { encoding: 'utf8', signal: options.signal })));
  const cases = plan.items.flatMap(item => item.cases);
  const coverage = { pending: 0, partial: 0, blocked: 0, complete: 0 };
  for (const entry of cases) coverage[entry.automation.status]++;
  const uncoveredCriteria = plan.items.reduce((sum, item) => sum + item.acceptanceCriteria.filter(criterion => !item.cases.some(entry => entry.acceptanceCriteria.includes(criterion.id))).length, 0);
  const openQuestions = plan.items.reduce((sum, item) => sum + item.openQuestions.length, 0);
  const issues = await catalogIssues(plan, options);
  const automationComplete = cases.length > 0 && coverage.complete === cases.length && !uncoveredCriteria && !openQuestions
    && plan.items.every(item => item.acceptanceCriteria.length > 0 && item.cases.length > 0);
  return { valid: true, items: plan.items.length, cases: cases.length, coverage, automationComplete,
    catalogChecked: Boolean(options.catalog), catalogIssues: issues,
    scriptsReady: automationComplete && Boolean(options.catalog) && !issues.length,
    gaps: cases.filter(entry => entry.automation.status !== 'complete').map(entry => ({ caseId: entry.id, title: entry.title, ...entry.automation })),
    acceptanceCriteria: plan.items.reduce((sum, item) => sum + item.acceptanceCriteria.length, 0), uncoveredCriteria, openQuestions };
}
type UpdateOptions = InputOptions & { plan: string; output?: string };
async function saveUpdatedPlan(options: UpdateOptions, original: string, plan: TestPlan) {
  const cwd = options.cwd ?? process.cwd();
  const output = resolve(cwd, options.output ?? options.plan);
  if (output === resolve(cwd, options.plan))
    await replaceFile(output, `${JSON.stringify(plan, null, 2)}\n`, { expected: original, signal: options.signal });
  else await saveJson(output, plan, options.signal);
  return { output, plan };
}
/** Apply verified coverage decisions atomically; update the canonical plan unless a new output is requested. */
export async function updateAutomation(options: UpdateOptions & { updates: string; catalog?: string }) {
  const cwd = options.cwd ?? process.cwd();
  const original = await readFile(resolve(cwd, options.plan), { encoding: 'utf8', signal: options.signal });
  const plan = testPlanSchema.parse(JSON.parse(original));
  const updates = z.object({ cases: z.array(automationUpdateSchema).min(1) }).strict().parse(await readJson(options.updates, options));
  const ids = new Set<string>();
  for (const update of updates.cases) {
    if (ids.has(update.caseId)) throw new Error(`Duplicate update: ${update.caseId}`);
    ids.add(update.caseId);
    const entry = plan.items.flatMap(item => item.cases).find(test => test.id === update.caseId);
    if (!entry) throw new Error(`Unknown case ID: ${update.caseId}`);
    entry.automation = update.automation;
    delete entry.binding;
    if (update.binding) entry.binding = update.binding;
  }
  const validated = testPlanSchema.parse(plan);
  if (validated.items.some(item => item.cases.some(entry => references(entry).length)) && !options.catalog)
    throw new Error('A collected catalog is required to verify test references.');
  const issues = await catalogIssues(validated, options);
  if (issues.length) throw new Error(JSON.stringify(issues));
  return saveUpdatedPlan(options, original, validated);
}
/** Record a semantically verified relationship; catalog checks existence, not assertions. */
export async function bindCase(options: UpdateOptions & { caseId: string; file: string; name: string; catalog: string }) {
  if (!options.catalog) throw new Error('A collected catalog is required to verify test references.');
  const cwd = options.cwd ?? process.cwd();
  const original = await readFile(resolve(cwd, options.plan), { encoding: 'utf8', signal: options.signal });
  const plan = testPlanSchema.parse(JSON.parse(original));
  const entry = plan.items.flatMap(item => item.cases).find(test => test.id === options.caseId);
  if (!entry) throw new Error(`Unknown case ID: ${options.caseId}`);
  entry.binding = bindingSchema.parse({ file: options.file, name: options.name });
  entry.automation = { status: 'complete' };
  const validated = testPlanSchema.parse(plan);
  const issues = await catalogIssues(validated, options);
  if (issues.length) throw new Error(JSON.stringify(issues));
  return saveUpdatedPlan(options, original, validated);
}
