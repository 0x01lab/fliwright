import { expect, it, vi } from 'vitest';
import { readGitLabItem, parseItemUrl } from '../src/index.js';

const url = 'https://gitlab.example.com/mobile/app/-/work_items/128';
const item = { id: 'gid://gitlab/WorkItem/900', iid: '128', title: '优惠券结算', description: '使用优惠券后，实付金额应扣减优惠金额。',
  updatedAt: '2026-11-03T01:00:00Z', webUrl: url, workItemType: { name: 'Task' } };
function page(hasNextPage = false, cursor: string | null = null) {
  return { data: { namespace: { workItem: { ...item, widgets: [{ __typename: 'WorkItemWidgetNotes', description: item.description, notes: {
    nodes: [{ id: 'n1', body: '优惠券金额为 10 元', system: false, updatedAt: item.updatedAt },
      { id: 'n2', body: 'changed label', system: true, updatedAt: item.updatedAt }], pageInfo: { hasNextPage, endCursor: cursor },
  } }, { __typename: 'WorkItemWidgetDescription', description: item.description, notes: undefined }] } } } };
}

it.each(['issues', 'work_items'])('reads project %s URLs and group work items without relying on the repository remote', async kind => {
  const execute = vi.fn().mockResolvedValue(JSON.stringify(page()));
  const source = await readGitLabItem(url.replace('work_items', kind), { execute });
  expect(source).toMatchObject({ iid: '128', type: 'Task', title: item.title, description: item.description,
    namespace: 'mobile/app', comments: [{ id: 'n1', body: '优惠券金额为 10 元' }] });
  expect(execute.mock.calls[0][0]).toBe('glab');
  expect(execute.mock.calls[0][1]).toEqual(expect.arrayContaining(['--hostname', 'gitlab.example.com', 'fullPath=mobile/app', 'iid=128']));
  expect(parseItemUrl('https://gitlab.example.com/groups/mobile/-/work_items/128').namespace).toBe('mobile');
});

it.each(['javascript:alert(1)', 'https://user:secret@gitlab.example.com/a/b/-/issues/1',
  'https://gitlab.example.com/a/b/-/issues/1?token=x', 'https://gitlab.example.com/a/%2e%2e/-/issues/1',
  'https://gitlab.example.com/a/b/-/issues/0', 'http://gitlab.example.com/a/b/-/issues/1'])('rejects unsafe or invalid Item URL %s before invoking glab', async value => {
  const execute = vi.fn();
  await expect(readGitLabItem(value, { execute })).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it('fetches every comment page and excludes system notes', async () => {
  const second = page();
  second.data.namespace.workItem.widgets[0].notes.nodes = [{ id: 'n3', body: '优惠券不可叠加', system: false, updatedAt: item.updatedAt }];
  const execute = vi.fn().mockResolvedValueOnce(JSON.stringify(page(true, 'next'))).mockResolvedValueOnce(JSON.stringify(second));
  const source = await readGitLabItem(url, { execute });
  expect(source.comments.map(note => note.id)).toEqual(['n1', 'n3']);
  expect(execute.mock.calls[1][1]).toContain('after=next');
});

it.each([
  { errors: [{ message: 'permission denied' }] }, { data: { namespace: null } },
  { data: { namespace: { workItem: null } } }, page(true, null),
])('fails closed on GitLab API errors, inaccessible Items or incomplete pagination', async response => {
  await expect(readGitLabItem(url, { execute: async () => JSON.stringify(response) })).rejects.toThrow();
});

it('rejects Item edits during paginated reads rather than combining different revisions', async () => {
  const changed = page(); changed.data.namespace.workItem.updatedAt = '2026-11-03T02:00:00Z';
  const execute = vi.fn().mockResolvedValueOnce(JSON.stringify(page(true, 'next'))).mockResolvedValueOnce(JSON.stringify(changed));
  await expect(readGitLabItem(url, { execute })).rejects.toThrow(/changed/i);
});
