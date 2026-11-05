import { z } from 'zod';
import { parseItemUrl, sourceSchema, type ItemSource } from './schema.js';
import { executeProcess, type Execute } from './process.js';

const query = `query TestPlanItem($fullPath: ID!, $iid: String!, $after: String) {
  namespace(fullPath: $fullPath) { workItem(iid: $iid) {
    id iid title webUrl updatedAt workItemType { name }
    widgets {
      __typename
      ... on WorkItemWidgetDescription { description }
      ... on WorkItemWidgetNotes { notes(first: 100, after: $after) {
        nodes { id body system updatedAt } pageInfo { hasNextPage endCursor }
      } }
    }
  } }
}`;
const noteSchema = z.object({ id: z.string(), body: z.string(), system: z.boolean(), updatedAt: z.string() });
const itemSchema = z.object({ id: z.string(), iid: z.string(), title: z.string(), webUrl: z.string(), updatedAt: z.string(),
  workItemType: z.object({ name: z.string() }), widgets: z.array(z.object({ __typename: z.string(), description: z.string().nullable().optional(),
    notes: z.object({ nodes: z.array(noteSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }).optional() })),
});
/** Read a project or group Work Item and all non-system comments using the authenticated glab host. */
export async function readGitLabItem(value: string, options: { execute?: Execute; signal?: AbortSignal; timeoutMs?: number; cwd?: string } = {}): Promise<ItemSource> {
  const target = parseItemUrl(value), execute = options.execute ?? executeProcess;
  let after: string | undefined, revision: string | undefined, first: z.infer<typeof itemSchema> | undefined;
  const comments = new Map<string, ItemSource['comments'][number]>(), cursors = new Set<string>();
  for (let page = 0; page < 100; page++) {
    options.signal?.throwIfAborted();
    const raw = JSON.parse(await execute('glab', ['api', 'graphql', '--hostname', target.host,
      '--raw-field', `query=${query}`, '--raw-field', `fullPath=${target.namespace}`, '--raw-field', `iid=${target.iid}`,
      ...(after ? ['--raw-field', `after=${after}`] : [])], options));
    if (raw.errors?.length) throw new Error('GitLab GraphQL returned errors. Check Work Item API support and access permissions.');
    if (!raw.data?.namespace?.workItem) throw new Error('GitLab Item not found or inaccessible.');
    const item = itemSchema.parse(raw.data.namespace.workItem);
    const returned = parseItemUrl(item.webUrl);
    if (returned.host !== target.host || returned.namespace !== target.namespace || returned.iid !== target.iid || item.iid !== target.iid) throw new Error('GitLab returned a different Item.');
    const currentRevision = JSON.stringify([item.id, item.updatedAt, item.title, item.widgets.filter(widget => widget.__typename !== 'WorkItemWidgetNotes')]);
    if (revision && revision !== currentRevision) throw new Error('GitLab Item changed while reading comment pages. Retry generation.');
    revision = currentRevision; first ??= item;
    const widget = item.widgets.find(entry => entry.__typename === 'WorkItemWidgetNotes');
    if (widget && !widget.notes) throw new Error('GitLab Item notes are incomplete.');
    for (const note of widget?.notes?.nodes ?? []) if (!note.system) comments.set(note.id, { id: note.id, body: note.body, updatedAt: note.updatedAt });
    if (!widget?.notes?.pageInfo.hasNextPage) {
      return sourceSchema.parse({ id: first.id, iid: first.iid, url: first.webUrl, namespace: target.namespace, type: first.workItemType.name,
        title: first.title, description: first.widgets.find(entry => entry.__typename === 'WorkItemWidgetDescription')?.description ?? '',
        updatedAt: first.updatedAt, fetchedAt: new Date().toISOString(), comments: [...comments.values()] });
    }
    after = widget.notes.pageInfo.endCursor ?? undefined;
    if (!after || cursors.has(after)) throw new Error('GitLab comment pagination is incomplete.');
    cursors.add(after);
  }
  throw new Error('GitLab comment pagination exceeded 100 pages; no partial snapshot was saved.');
}
