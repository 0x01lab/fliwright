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
  const provider = new MockApiTreeProvider({
    discover: vi.fn().mockResolvedValue({
      root: Uri.file(`${root}/.fliwright/mocks`),
      indexUri: Uri.file(`${root}/.fliwright/mocks/mock-index.json`),
      endpoints: [endpoint],
      invalid: [],
    }),
  } as unknown as MockConfigService);
  await provider.getChildren();
  return { provider, endpoint };
}

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
