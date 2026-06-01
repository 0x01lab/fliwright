import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { MockApiTreeProvider } from '../src/views/MockApiTreeProvider.js';
import { FormDataTreeProvider } from '../src/views/FormDataTreeProvider.js';
import type { FormRuleService } from '../src/form/FormRuleService.js';
import type { MockConfigService } from '../src/sandbox/MockConfigService.js';
import { createWorkspace } from './helpers/workspace.js';

describe('tree providers', () => {
  it('loads mock data on first getChildren without firing refresh events', async () => {
    const root = await createWorkspace();
    const discover = vi.fn<MockConfigService['discover']>().mockResolvedValue({
      root: Uri.file(`${root}/.fliwright/mocks`),
      indexUri: Uri.file(`${root}/.fliwright/mocks/mock-index.json`),
      endpoints: [],
      invalid: [],
    });
    const provider = new MockApiTreeProvider({ discover } as unknown as MockConfigService);
    const refresh = vi.fn();
    provider.onDidChangeTreeData(refresh);

    const children = await provider.getChildren();

    expect(discover).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(children[0]?.kind).toBe('empty');
  });

  it('uses invalid mock context values for invalid rows', () => {
    const provider = new MockApiTreeProvider({} as MockConfigService);

    const item = provider.getTreeItem({
      kind: 'invalid',
      uri: Uri.file('/tmp/broken.json'),
      label: 'broken.json',
      error: 'bad json',
    });

    expect(item.contextValue).toBe('mockInvalid');
  });

  it('marks applied mock rules in tree items', () => {
    const provider = new MockApiTreeProvider({} as MockConfigService);

    const item = provider.getTreeItem({
      kind: 'rule',
      uri: Uri.file('/tmp/token.json'),
      endpoint: '/v1/token',
      method: 'GET',
      rule: { name: 'success', status: 200 },
      isDefault: true,
      applied: true,
    });

    expect(item.contextValue).toBe('mockRuleApplied');
    expect(item.description).toContain('active');
  });

  it('returns empty form state without refresh loop', async () => {
    const root = await createWorkspace();
    const discover = vi.fn<FormRuleService['discover']>().mockResolvedValue({
      root: Uri.file(`${root}/.fliwright/forms`),
      files: [],
      invalid: [],
    });
    const provider = new FormDataTreeProvider({ discover } as unknown as FormRuleService);
    const refresh = vi.fn();
    provider.onDidChangeTreeData(refresh);

    const children = await provider.getChildren();

    expect(discover).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(children[0]).toMatchObject({ kind: 'empty', label: 'No form rules' });
  });

  it('uses invalid form context values for invalid rows', () => {
    const provider = new FormDataTreeProvider({} as FormRuleService);

    const item = provider.getTreeItem({
      kind: 'invalid',
      uri: Uri.file('/tmp/broken.json'),
      label: 'broken.json',
      error: 'bad json',
    });

    expect(item.contextValue).toBe('formInvalid');
  });
});
