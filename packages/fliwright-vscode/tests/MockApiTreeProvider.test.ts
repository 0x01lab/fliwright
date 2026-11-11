import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { SandboxService } from '../src/sandbox/SandboxService.js';
import { MockApiTreeProvider } from '../src/views/MockApiTreeProvider.js';
import type { MockConfigService } from '../src/sandbox/MockConfigService.js';
import type { MockEndpointEntry } from '../src/types.js';
import { createWorkspace } from './helpers/workspace.js';

async function createProvider() {
  const root = await createWorkspace();
  const endpoint: MockEndpointEntry = {
    kind: 'endpoint',
    uri: Uri.file(`${root}/.fliwright/mocks/api/user.json`),
    indexed: true,
    endpointFile: {
      version: 1,
      name: 'User info',
      method: 'POST',
      endpoint: '/api/v1/user/info',
      rules: [
        { name: 'default', status: 200 },
        { name: 'kyc-rejected', status: 200 },
      ],
    },
  };
  const discover = vi.fn().mockResolvedValue({
    root: Uri.file(`${root}/.fliwright/mocks`),
    indexUri: Uri.file(`${root}/.fliwright/mocks/mock-index.json`),
    endpoints: [endpoint],
    invalid: [],
  });
  const provider = new MockApiTreeProvider({
    discover,
  } as unknown as MockConfigService);
  await provider.getChildren();
  return { provider, endpoint, discover };
}

describe('Mock API search', () => {
  it('narrows a long endpoint list by method and path without changing the default-mock input', async () => {
    const { provider, endpoint } = await createProvider();
    const other: MockEndpointEntry = {
      ...endpoint, uri: Uri.file('/mocks/login.json'),
      endpointFile: { ...endpoint.endpointFile, method: 'GET', endpoint: '/api/v1/auth/login', name: 'Login' },
    };
    provider.currentResult!.endpoints.push(other);
    provider.setFilter('GET login');
    expect((await provider.getChildren()).filter((node) => node.kind === 'endpoint')).toEqual([other]);
    expect(provider.currentResult!.endpoints).toEqual([endpoint, other]);
    provider.setFilter('');
    expect(await provider.getChildren()).toEqual([endpoint, other]);
  });

  it.each(['post /USER', 'USER INFO', 'kyc-REJECTED', 'post rejected'])('matches %s without case sensitivity', async (query) => {
    const { provider, endpoint } = await createProvider();
    const changed = vi.fn();
    provider.onDidChangeTreeData(changed);
    provider.setFilter(query);

    expect((await provider.getChildren()).filter((node) => node.kind === 'endpoint')).toEqual([endpoint]);
    expect(changed).toHaveBeenCalledWith(undefined);
  });

  it('filters rules by name while retaining method and path search context', async () => {
    const { provider, endpoint } = await createProvider();
    provider.setFilter('post rejected');
    expect(await provider.getChildren(endpoint)).toMatchObject([{ rule: { name: 'kyc-rejected' } }]);
    provider.setFilter('/user');
    expect(await provider.getChildren(endpoint)).toHaveLength(2);
  });

  it('shows an actionable filter summary and restores the complete list when cleared', async () => {
    const { provider, endpoint, discover } = await createProvider();
    provider.setFilter('  get missing  ');
    expect(provider.filter).toBe('get missing');
    const nodes = await provider.getChildren();
    expect(nodes).toEqual([expect.objectContaining({
      kind: 'empty', label: 'No matching Mock APIs', description: 'get missing',
      command: { command: 'fliwright.clearMockApiSearch', title: 'Clear Mock API Search' },
    })]);

    await provider.refresh();
    expect(await provider.getChildren()).toEqual(nodes);
    provider.setFilter('   ');
    expect(await provider.getChildren()).toEqual([endpoint]);
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('keeps invalid configs discoverable by file name and preserves the unfiltered discovery', async () => {
    const { provider, endpoint } = await createProvider();
    const invalid = { kind: 'invalid' as const, label: 'broken.json', uri: Uri.file('/mocks/broken.json'), error: 'Invalid JSON' };
    provider.currentResult!.invalid.push(invalid);
    provider.setFilter('BROKEN');
    expect((await provider.getChildren()).filter((node) => node.kind === 'invalid')).toEqual([invalid]);
    expect(provider.currentResult!.endpoints).toEqual([endpoint]);
  });

  it('includes active rules missing from the config in search results', async () => {
    const { provider, endpoint } = await createProvider();
    provider.setAppliedRules([{ endpoint: endpoint.endpointFile.endpoint, method: 'POST', ruleName: 'deleted-rule', filePath: endpoint.uri.fsPath, appliedAt: 1 }]);
    provider.setFilter('deleted');
    expect((await provider.getChildren()).filter((node) => node.kind === 'endpoint')).toEqual([endpoint]);
    expect(await provider.getChildren(endpoint)).toMatchObject([{ kind: 'runtimeRule', activeRule: { ruleName: 'deleted-rule' } }]);
  });
});

describe('Mock API active-only filter', () => {
  it('hides inactive rules and endpoints, then restores all configs when switched off', async () => {
    const { provider, endpoint } = await createProvider();
    const inactive: MockEndpointEntry = {
      ...endpoint, endpointFile: { ...endpoint.endpointFile, method: 'GET' },
    };
    provider.currentResult!.endpoints.push(inactive);
    const invalid = { kind: 'invalid' as const, label: 'broken.json', uri: Uri.file('/mocks/broken.json'), error: 'Invalid JSON' };
    provider.currentResult!.invalid.push(invalid);
    provider.setAppliedRules([{ endpoint: endpoint.endpointFile.endpoint, method: 'post', ruleName: 'kyc-rejected', filePath: endpoint.uri.fsPath, appliedAt: 1 }]);
    const changed = vi.fn();
    provider.onDidChangeTreeData(changed);

    expect(provider.activeOnly).toBe(false);
    provider.setActiveOnly(true);
    expect(changed).toHaveBeenCalledWith(undefined);
    expect(provider.activeOnly).toBe(true);
    expect(await provider.getChildren()).toEqual([endpoint]);
    expect(await provider.getChildren(endpoint)).toMatchObject([{ kind: 'rule', rule: { name: 'kyc-rejected' }, applied: true }]);
    expect(await provider.getChildren(inactive)).toEqual([]);
    expect(provider.currentResult!.endpoints).toEqual([endpoint, inactive]);

    provider.setActiveOnly(false);
    expect(await provider.getChildren()).toEqual([invalid, endpoint, inactive]);
    expect(await provider.getChildren(endpoint)).toHaveLength(2);
  });

  it('combines search with active-only filtering without matching hidden rule names', async () => {
    const { provider, endpoint } = await createProvider();
    provider.setAppliedRules([{ endpoint: endpoint.endpointFile.endpoint, method: 'POST', ruleName: 'default', filePath: endpoint.uri.fsPath, appliedAt: 1 }]);
    provider.setActiveOnly(true);
    provider.setFilter('rejected');
    expect((await provider.getChildren()).filter((node) => node.kind === 'endpoint')).toEqual([]);
    provider.setFilter('POST user');
    expect((await provider.getChildren()).filter((node) => node.kind === 'endpoint')).toEqual([endpoint]);
    expect(await provider.getChildren(endpoint)).toMatchObject([{ rule: { name: 'default' } }]);
    provider.setFilter('');
    expect(provider.activeOnly).toBe(true);
    expect(await provider.getChildren(endpoint)).toHaveLength(1);
  });

  it.each(['(external)', 'deleted-rule'])('keeps active runtime rule %s visible', async (ruleName) => {
    const { provider, endpoint } = await createProvider();
    provider.setAppliedRules([{ endpoint: endpoint.endpointFile.endpoint, method: 'POST', ruleName, filePath: endpoint.uri.fsPath, appliedAt: 1 }]);
    provider.setActiveOnly(true);
    expect(await provider.getChildren()).toEqual([endpoint]);
    expect(await provider.getChildren(endpoint)).toMatchObject([{ kind: 'runtimeRule', activeRule: { ruleName } }]);
  });

  it('follows runtime changes and refreshes while retaining the filter and showing an empty state', async () => {
    const { provider, endpoint } = await createProvider();
    const rule = { endpoint: endpoint.endpointFile.endpoint, method: 'POST', ruleName: 'default', filePath: endpoint.uri.fsPath, appliedAt: 1 };
    provider.setActiveOnly(true);
    expect(await provider.getChildren()).toEqual([{ kind: 'empty', label: 'No active Mock APIs' }]);
    provider.setAppliedRules([rule]);
    await provider.refresh();
    expect(provider.activeOnly).toBe(true);
    expect(await provider.getChildren()).toEqual([endpoint]);
    provider.removeAppliedRule({ endpoint: rule.endpoint, method: rule.method, rule: endpoint.endpointFile.rules[0]! });
    expect(await provider.getChildren()).toEqual([{ kind: 'empty', label: 'No active Mock APIs' }]);
    provider.setAppliedRules([rule]);
    provider.setAppliedRules([]);
    expect(await provider.getChildren()).toEqual([{ kind: 'empty', label: 'No active Mock APIs' }]);
  });
});

describe('Mock API active state', () => {
  it('puts the active rule first and moves the marker when runtime state changes', async () => {
    const { provider, endpoint } = await createProvider();
    const service = new SandboxService();
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      {
        id: 'fliwright-vscode:POST:%2Fapi%2Fv1%2Fuser%2Finfo:kyc-rejected',
        method: 'POST',
        path: '/api/v1/user/info',
      },
    ]);
    const driver = { mock: { listFlutterRoutes } } as any;
    provider.setAppliedRules(await service.getActiveRules(driver));

    const children = await provider.getChildren(endpoint);
    expect(children[0]).toMatchObject({ kind: 'rule', rule: { name: 'kyc-rejected' }, applied: true });
    expect(provider.getTreeItem(children[0]!).description).toContain('active');
    expect(provider.getTreeItem(endpoint).description).toContain('kyc-rejected');

    listFlutterRoutes.mockResolvedValue([
      { id: 'fliwright-vscode:POST:%2Fapi%2Fv1%2Fuser%2Finfo:default', method: 'POST', path: '/api/v1/user/info' },
    ]);
    provider.setAppliedRules(await service.getActiveRules(driver));
    expect((await provider.getChildren(endpoint))[0]).toMatchObject({ rule: { name: 'default' }, applied: true });
    expect(provider.getTreeItem(children[0]!).description).not.toContain('active');

    listFlutterRoutes.mockResolvedValue([]);
    provider.setAppliedRules(await service.getActiveRules(driver));
    expect(provider.getTreeItem(endpoint).description).not.toContain('active');
    expect((await provider.getChildren(endpoint)).every((node) => !String(provider.getTreeItem(node).description).includes('active'))).toBe(true);
  });

  it.each([
    ['test-script-route', 'External mock route'],
    ['fliwright-vscode:POST:%2Fapi%2Fv1%2Fuser%2Finfo:deleted-rule', 'deleted-rule'],
  ])('shows a runtime row when active route %s has no matching config rule', async (id, label) => {
    const { provider, endpoint } = await createProvider();
    const service = new SandboxService();
    provider.setAppliedRules(await service.getActiveRules({
      mock: { listFlutterRoutes: vi.fn().mockResolvedValue([{ id, method: 'POST', path: endpoint.endpointFile.endpoint }]) },
    } as any));

    expect(provider.getTreeItem(endpoint).description).toContain('1 active');
    const children = await provider.getChildren(endpoint);
    const activeItems = children.map((node) => provider.getTreeItem(node))
      .filter((item) => String(item.description).includes('active'));
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0]).toMatchObject({ label, iconPath: { id: 'pass-filled' } });
    expect(children.filter((node) => node.kind === 'rule').every((node) => !node.applied)).toBe(true);

    provider.setAppliedRules([]);
    expect(await provider.getChildren(endpoint)).toHaveLength(2);
  });
});
