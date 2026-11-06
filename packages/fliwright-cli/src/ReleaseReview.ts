import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { HtmlReportTest } from './HtmlReport.js';
import { deviceMetadataSchema } from './DeviceMetadata.js';

const text = z.string().trim().min(1);
/** Identity supplied for the tested build; absent fields remain release blockers. */
export const releaseMetadataSchema = z.object({
  app: text.optional(), version: text.optional(), build: text.optional(), commit: text.optional(),
  platform: text.optional(), environment: text.optional(),
}).strict();
export type ReleaseMetadata = z.infer<typeof releaseMetadataSchema>;
const releaseFieldLabels = { app: '应用', version: '版本', build: '构建号', commit: '被测代码提交', platform: '平台', environment: '环境' } as const;
const issueUrl = text.refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && /\/-\/(?:issues|work_items)\/[1-9]\d*\/?$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}, 'Expected an HTTPS GitLab Item URL.');
const binding = z.object({ name: text, file: text.refine(value => !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
  && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '.' || !part), 'Expected a project-relative test path.') }).strict();
const automationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), reason: text.optional() }).strict(),
  z.object({ status: z.literal('complete') }).strict(),
  z.object({ status: z.literal('partial'), reason: text, tests: z.array(binding).min(1) }).strict(),
  z.object({ status: z.literal('blocked'), reason: text, tests: z.array(binding).optional() }).strict(),
]);
const caseSchema = z.object({ id: text, title: text, description: text, expectedResult: text,
  acceptanceCriteria: z.array(text).min(1), preconditions: z.array(text), steps: z.array(z.object({ action: text, expectedResult: text }).strict()).min(1),
  automation: automationSchema, binding: binding.optional() }).strict()
  .refine(entry => (entry.automation.status === 'complete') === Boolean(entry.binding), 'Complete coverage requires a binding; incomplete coverage must use supporting tests.');
const criterionSchema = z.object({ id: text, text, source: z.object({
  kind: z.enum(['description', 'comment']), commentId: text.optional(), quote: text,
}).strict().refine(value => value.kind === 'comment' ? Boolean(value.commentId) : value.commentId === undefined, 'Invalid criterion source.') }).strict();
// Consumer validation at the JSON boundary; the independent planner is not a runtime dependency.
const planSchema = z.object({ schemaVersion: z.literal(2), generatedAt: z.string().datetime({ offset: true }), items: z.array(z.object({
  source: z.object({ id: text, iid: text, namespace: text, type: text, url: issueUrl, title: text, description: z.string(),
    updatedAt: z.string().datetime({ offset: true }), fetchedAt: z.string().datetime({ offset: true }),
    comments: z.array(z.object({ id: text, body: z.string(), updatedAt: z.string().datetime({ offset: true }) }).strict()), }).strict(),
  basis: z.enum(['acceptance-checklist', 'requirements']), acceptanceCriteria: z.array(criterionSchema), cases: z.array(caseSchema), openQuestions: z.array(text),
}).strict()).min(1) }).strict().superRefine((plan, context) => {
  const ids = new Set<string>(), items = new Set<string>(), selectors = new Set<string>();
  for (const [i, item] of plan.items.entries()) {
    let url: URL;
    try { url = new URL(item.source.url); } catch { continue; }
    const namespace = url.pathname.split('/-/')[0].replace(/^\/(?:groups\/)?/, '');
    const key = `${url.host}/${item.source.id}`;
    if (items.has(key) || item.source.iid !== url.pathname.replace(/\/$/, '').split('/').at(-1) || namespace !== item.source.namespace)
      context.addIssue({ code: 'custom', path: ['items', i, 'source'], message: 'Duplicate or inconsistent Item source.' });
    items.add(key);
    const criteria = new Set<string>();
    for (const [j, criterion] of item.acceptanceCriteria.entries()) {
      const original = criterion.source.kind === 'description' ? item.source.description
        : item.source.comments.find(note => note.id === criterion.source.commentId)?.body;
      if (criteria.has(criterion.id) || !original?.includes(criterion.source.quote)) context.addIssue({ code: 'custom', path: ['items', i, 'acceptanceCriteria', j], message: 'Invalid criterion provenance or duplicate id.' });
      criteria.add(criterion.id);
    }
    for (const [j, test] of item.cases.entries()) {
      if (new Set(test.acceptanceCriteria).size !== test.acceptanceCriteria.length || test.acceptanceCriteria.some(id => !criteria.has(id)))
        context.addIssue({ code: 'custom', path: ['items', i, 'cases', j], message: 'Unknown or duplicate acceptance criterion reference.' });
      const selector = test.binding && `${test.binding.file}\0${test.binding.name}`;
      if (ids.has(test.id) || (selector && selectors.has(selector))) context.addIssue({ code: 'custom', path: ['items', i, 'cases', j], message: 'Duplicate case id or binding.' });
      ids.add(test.id); if (selector) selectors.add(selector);
    }
  }
});
export const releaseReviewSchema = z.object({ runId: text,
  release: releaseMetadataSchema.default({}), device: deviceMetadataSchema.optional(), plan: text,
}).strict();
export type ReleaseReview = z.infer<typeof releaseReviewSchema> & { items: z.infer<typeof planSchema>['items'] };
/** Resolve a portable test plan relative to its release review manifest, without accessing GitLab or AI. */
export async function loadReleaseReview(path: string, signal?: AbortSignal): Promise<ReleaseReview> {
  const review = releaseReviewSchema.parse(JSON.parse(await readFile(path, { encoding: 'utf8', signal })));
  return { ...await loadReleasePlan(resolve(dirname(path), review.plan), review.runId, signal), ...review };
}
/** Read an existing plan directly, including script coverage gaps and unresolved cases. */
export async function loadReleasePlan(path: string, runId: string, signal?: AbortSignal): Promise<ReleaseReview> {
  const plan = planSchema.parse(JSON.parse(await readFile(path, { encoding: 'utf8', signal })));
  return { runId, plan: path, release: {}, items: plan.items };
}
export interface ReviewedCase { definition: z.infer<typeof caseSchema>; test?: HtmlReportTest; supportingTests: HtmlReportTest[];
  status: HtmlReportTest['status'] | 'pending' | 'partial' | 'blocked' | 'missing' | 'ambiguous'; result: string; qualified: boolean; }
export interface ReviewedIssue {
  url: string; title: string; description: string; source: z.infer<typeof planSchema>['items'][number]['source'];
  basis: 'acceptance-checklist' | 'requirements'; acceptanceCriteria: z.infer<typeof criterionSchema>[];
  cases: ReviewedCase[]; qualified: boolean;
}
export interface ReleaseAssessment {
  review?: ReleaseReview;
  release: ReleaseMetadata;
  missingReleaseFields: Array<keyof ReleaseMetadata>;
  issues: ReviewedIssue[];
  releaseReady: boolean;
  blockers: string[];
}
function normalizeFile(file: string): string { return file.replaceAll('\\', '/').replace(/^\.\//, ''); }
function fileMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const file = normalizeFile(actual), target = normalizeFile(expected);
  return file === target || file.endsWith(`/${target}`);
}
const results = { passed: '通过', failed: '失败', skipped: '跳过', interrupted: '中断', running: '执行中' };

/** Assess the complete declared release scope; successful subsets and absent metadata cannot qualify a release. */
export function assessRelease(input: {
  runId: string; status: string; evidenceStatus: string; tests: HtmlReportTest[];
  missing: string[]; runnerErrors: unknown[]; review?: ReleaseReview;
  recordedRelease?: ReleaseMetadata;
  summaryConfirmed: boolean;
}): ReleaseAssessment {
  const blockers: string[] = [];
  const review = input.review;
  const release = { ...review?.release, ...input.recordedRelease };
  const fields = Object.keys(releaseFieldLabels) as Array<keyof ReleaseMetadata>;
  const missingReleaseFields = fields.filter(field => !release[field]);
  for (const field of missingReleaseFields) blockers.push(`发版信息缺失：${releaseFieldLabels[field]}。`);
  for (const field of fields) {
    if (review?.release[field] && input.recordedRelease?.[field] && review.release[field] !== input.recordedRelease[field])
      blockers.push(`发版信息冲突：${releaseFieldLabels[field]}与测试运行记录不一致。`);
  }
  const matched = new Set<HtmlReportTest>();
  if (!review) blockers.push('未提供发版审核清单，无法确认 GitLab Item 和应测用例范围。');
  if (review && review.runId !== input.runId) blockers.push('审核清单与测试运行不匹配。');
  if (!input.tests.length) blockers.push('没有测试执行结果。');
  if (input.status !== 'passed') blockers.push(`测试运行未通过（${input.status}）。`);
  if (!input.summaryConfirmed) blockers.push('运行汇总未确认全部通过，或用例数量与执行记录不一致。');
  if (input.missing.length || input.evidenceStatus !== 'complete') blockers.push('测试证据不完整或自动记录已关闭。');
  if (input.runnerErrors.length) blockers.push('存在运行环境错误。');
  for (const test of input.tests) {
    if (test.status !== 'passed') blockers.push(`${test.name}：${results[test.status]}。`);
    if (test.attempts.some(attempt => attempt.evidenceStatus !== 'complete')) blockers.push(`${test.name}：执行证据不完整。`);
    if (test.attempts.some(attempt => attempt.expectedFailure)) blockers.push(`${test.name}：预期失败用例不能作为发版验收通过依据。`);
  }
  const issues = (review?.items ?? []).map(item => {
    if (!item.acceptanceCriteria.length) blockers.push(`#${item.source.iid}：没有可验证的验收标准。`);
    const uncovered = item.acceptanceCriteria.filter(criterion => !item.cases.some(entry => entry.acceptanceCriteria.includes(criterion.id)));
    for (const criterion of uncovered) blockers.push(`#${item.source.iid} / ${criterion.id}：验收标准未覆盖。`);
    if (!item.cases.length) blockers.push(`#${item.source.iid}：没有测试用例。`);
    for (const question of item.openQuestions) blockers.push(`#${item.source.iid}：需求待确认：${question}`);
    const cases = item.cases.map(definition => {
      const findTests = (ref: z.infer<typeof binding>) => input.tests.filter(test => test.name === ref.name && fileMatches(test.file, ref.file));
      const candidates = definition.binding ? findTests(definition.binding) : [];
      const test = candidates.length === 1 ? candidates[0] : undefined;
      const supportingTests = [...new Set(('tests' in definition.automation ? definition.automation.tests ?? [] : []).flatMap(ref => {
        const matches = findTests(ref);
        if (matches.length !== 1) blockers.push(`${definition.id}：部分覆盖的测试${matches.length ? '匹配不唯一' : '本次未执行'}（${ref.name}）。`);
        return matches.length === 1 ? matches : [];
      }))];
      if (test) matched.add(test);
      for (const supporting of supportingTests) matched.add(supporting);
      const status: ReviewedCase['status'] = definition.automation.status !== 'complete' ? definition.automation.status
        : candidates.length > 1 ? 'ambiguous' : test?.status ?? 'missing';
      const result = ({ pending: '待编写', partial: '部分覆盖', blocked: '受阻', ambiguous: '匹配不唯一', missing: '待执行', ...results })[status];
      const qualified = Boolean(test && definition.automation.status === 'complete' && test.status === 'passed'
        && test.attempts.every(attempt => attempt.evidenceStatus === 'complete' && !attempt.expectedFailure));
      const reason = 'reason' in definition.automation ? `：${definition.automation.reason}` : '';
      if (!qualified) blockers.push(`${definition.id}：${result}${reason}。`);
      return { definition, test, supportingTests, status, result, qualified };
    });
    return { source: item.source, basis: item.basis, acceptanceCriteria: item.acceptanceCriteria, url: item.source.url, title: item.source.title, description: item.source.description,
      cases, qualified: item.acceptanceCriteria.length > 0 && !uncovered.length && cases.length > 0 && !item.openQuestions.length && cases.every(test => test.qualified) };
  });
  if (review) for (const test of input.tests) if (!matched.has(test)) blockers.push(`${test.name}：未关联 GitLab Item 和验收描述。`);
  return { review, release, missingReleaseFields, issues, releaseReady: blockers.length === 0, blockers: [...new Set(blockers)] };
}
