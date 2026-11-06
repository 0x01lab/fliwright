import { z } from 'zod';

const text = z.string().trim().min(1);
/** Only explicit HTTPS GitLab project/group Item URLs are accepted. Authentication remains in glab. */
export function parseItemUrl(value: string): { host: string; namespace: string; iid: string; url: string } {
  const url = new URL(value);
  const match = /^\/(.+)\/-\/(?:issues|work_items)\/([1-9]\d*)\/?$/.exec(url.pathname);
  // Check the raw path as URL normalizes dot segments before validation.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !match
    || /%|\\|\s/.test(value) || /\/\.{1,2}(?:\/|$)/.test(value)) throw new Error('Expected an HTTPS GitLab Issue or Work Item URL without credentials, query or fragment.');
  const namespace = match[1].replace(/^groups\//, '');
  if (!namespace.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')) throw new Error('Invalid GitLab namespace.');
  url.pathname = url.pathname.replace(/\/$/, '');
  return { host: url.host, namespace, iid: match[2], url: url.href };
}
export const itemUrlSchema = text.refine(value => { try { parseItemUrl(value); return true; } catch { return false; } }, 'Invalid GitLab Item URL.');
export const bindingSchema = z.object({ file: text.refine(value => !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
  && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '.' || !part), 'Use a project-relative file path.'), name: text }).strict();
export const draftCaseSchema = z.object({ title: text, description: text, acceptanceCriteria: z.array(text).min(1), preconditions: z.array(text),
  steps: z.array(z.object({ action: text, expectedResult: text }).strict()).min(1), expectedResult: text }).strict();
export const acceptanceCriterionSchema = z.object({ id: text, text,
  source: z.object({ kind: z.enum(['description', 'comment']), commentId: text.optional(), quote: text }).strict()
    .refine(value => value.kind === 'comment' ? Boolean(value.commentId) : value.commentId === undefined, 'Comment criteria require commentId; description criteria must omit it.'),
}).strict();
export const planDraftSchema = z.object({ items: z.array(z.object({ sourceUrl: itemUrlSchema, basis: z.enum(['acceptance-checklist', 'requirements']),
  acceptanceCriteria: z.array(acceptanceCriterionSchema), cases: z.array(draftCaseSchema).max(200), openQuestions: z.array(text),
}).strict()).min(1) }).strict();
export const sourceSchema = z.object({ id: text, iid: text, url: itemUrlSchema, namespace: text, type: text, title: text,
  description: z.string(), updatedAt: z.string().datetime({ offset: true }), fetchedAt: z.string().datetime({ offset: true }),
  comments: z.array(z.object({ id: text, body: z.string(), updatedAt: z.string().datetime({ offset: true }) }).strict()),
}).strict();
export const sourceSnapshotSchema = z.object({ schemaVersion: z.literal(1), items: z.array(sourceSchema).min(1) }).strict();
/** Coverage declarations describe authored scripts, never execution outcomes. */
export const automationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), reason: text.optional() }).strict(),
  z.object({ status: z.literal('complete') }).strict(),
  z.object({ status: z.literal('partial'), reason: text, tests: z.array(bindingSchema).min(1) }).strict(),
  z.object({ status: z.literal('blocked'), reason: text, tests: z.array(bindingSchema).optional() }).strict(),
]);
export const automationUpdateSchema = z.object({ caseId: text, automation: automationSchema, binding: bindingSchema.optional() }).strict()
  .refine(entry => (entry.automation.status === 'complete') === Boolean(entry.binding), 'Complete coverage requires a binding; incomplete coverage must use supporting tests.');
export const testCaseSchema = draftCaseSchema.extend({ id: text, automation: automationSchema, binding: bindingSchema.optional() }).strict()
  .refine(entry => (entry.automation.status === 'complete') === Boolean(entry.binding), 'Complete coverage requires a binding; incomplete coverage must use supporting tests.');
export const testPlanSchema = z.object({ schemaVersion: z.literal(2), generatedAt: z.string().datetime({ offset: true }),
  items: z.array(z.object({ source: sourceSchema, basis: z.enum(['acceptance-checklist', 'requirements']), acceptanceCriteria: z.array(acceptanceCriterionSchema), cases: z.array(testCaseSchema), openQuestions: z.array(text) }).strict()).min(1),
}).strict().superRefine((plan, context) => {
  const ids = new Set<string>(), sources = new Set<string>(), bindings = new Set<string>();
  for (const [i, item] of plan.items.entries()) {
    const parsed = parseItemUrl(item.source.url);
    const key = `${parsed.host}/${item.source.id}`;
    if (sources.has(key) || parsed.iid !== item.source.iid || parsed.namespace !== item.source.namespace) {
      context.addIssue({ code: 'custom', path: ['items', i, 'source'], message: 'Duplicate or inconsistent Item source.' });
    }
    sources.add(key);
    if (!item.cases.length && !item.openQuestions.length) context.addIssue({ code: 'custom', path: ['items', i], message: 'Item has no cases or open questions.' });
    const criteria = new Set<string>();
    for (const [j, criterion] of item.acceptanceCriteria.entries()) {
      const original = criterion.source.kind === 'description' ? item.source.description
        : item.source.comments.find(note => note.id === criterion.source.commentId)?.body;
      if (criteria.has(criterion.id) || !original?.includes(criterion.source.quote)) context.addIssue({ code: 'custom', path: ['items', i, 'acceptanceCriteria', j], message: 'Duplicate criterion or quote absent from its source.' });
      criteria.add(criterion.id);
      if (!item.openQuestions.length && !item.cases.some(entry => entry.acceptanceCriteria.includes(criterion.id)))
        context.addIssue({ code: 'custom', path: ['items', i, 'acceptanceCriteria', j], message: 'Acceptance criterion has no case and no unresolved question.' });
    }
    if (!criteria.size && !item.openQuestions.length) context.addIssue({ code: 'custom', path: ['items', i], message: 'No acceptance criteria or unresolved questions.' });
    for (const [j, entry] of item.cases.entries()) {
      if (new Set(entry.acceptanceCriteria).size !== entry.acceptanceCriteria.length || entry.acceptanceCriteria.some(id => !criteria.has(id)))
        context.addIssue({ code: 'custom', path: ['items', i, 'cases', j, 'acceptanceCriteria'], message: 'Unknown or duplicate acceptance criterion reference.' });
      const selector = entry.binding && `${entry.binding.file}\0${entry.binding.name}`;
      if (ids.has(entry.id) || (selector && bindings.has(selector))) context.addIssue({ code: 'custom', path: ['items', i, 'cases', j], message: 'Duplicate case ID or automation binding.' });
      ids.add(entry.id); if (selector) bindings.add(selector);
    }
  }
});
export type TestPlan = z.infer<typeof testPlanSchema>;
export type ItemSource = z.infer<typeof sourceSchema>;

export type Automation = z.infer<typeof automationSchema>;
