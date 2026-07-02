import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { MockApiTreeProvider } from '../src/views/MockApiTreeProvider.js';
import { FormDataTreeProvider } from '../src/views/FormDataTreeProvider.js';
import { StateTreeProvider } from '../src/views/StateTreeProvider.js';
import { DevicesTreeProvider } from '../src/views/DevicesTreeProvider.js';
import { FlowsTreeProvider } from '../src/views/FlowsTreeProvider.js';
import { ScriptDiscoveryService } from '../src/scripts/ScriptDiscoveryService.js';
import { ScriptsTreeProvider } from '../src/views/ScriptsTreeProvider.js';
import type { FormRuleService } from '../src/form/FormRuleService.js';
import type { MockConfigService } from '../src/sandbox/MockConfigService.js';
import { createWorkspace, writeText } from './helpers/workspace.js';

describe('tree providers', () => {
  it('nests connected device capabilities under the status row', () => {
    const provider = new DevicesTreeProvider();
    provider.setState({
      status: 'connected',
      url: 'ws://127.0.0.1:52215/A1QIwGccBzA=/ws',
      connectedAt: 1,
    });

    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ kind: 'deviceStatus' });

    const rootItem = provider.getTreeItem(roots[0]!);
    expect(rootItem.collapsibleState).toBe(2);

    const children = provider.getChildren(roots[0]);
    expect(children).toMatchObject([
      { kind: 'deviceCapability', label: 'Mock APIs' },
      { kind: 'deviceCapability', label: 'Form Helper' },
    ]);
  });

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
    provider.setAppliedRules([
      {
        endpoint: '/v1/token',
        method: 'GET',
        ruleName: 'success',
        filePath: '/tmp/token.json',
        appliedAt: 1,
      },
    ]);

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

  it('renders stale mock rule elements from the current applied state', () => {
    const provider = new MockApiTreeProvider({} as MockConfigService);
    const staleRule = {
      kind: 'rule' as const,
      uri: Uri.file('/tmp/token.json'),
      endpoint: '/v1/token',
      method: 'get',
      rule: { name: 'success', status: 200 },
      isDefault: false,
      applied: false,
    };

    provider.setAppliedRules([
      {
        endpoint: '/v1/token',
        method: 'GET',
        ruleName: 'success',
        filePath: '/tmp/token.json',
        appliedAt: 1,
      },
    ]);

    const item = provider.getTreeItem(staleRule);

    expect(item.contextValue).toBe('mockRuleApplied');
    expect(item.description).toContain('active');
    expect(item.iconPath).toMatchObject({ id: 'pass-filled' });
  });

  it('shows at most one applied rule per mock endpoint', async () => {
    const root = await createWorkspace();
    const provider = new MockApiTreeProvider({
      discover: vi.fn<MockConfigService['discover']>().mockResolvedValue({
        root: Uri.file(`${root}/.fliwright/mocks`),
        indexUri: Uri.file(`${root}/.fliwright/mocks/mock-index.json`),
        endpoints: [
          {
            kind: 'endpoint',
            uri: Uri.file(`${root}/.fliwright/mocks/api/token.json`),
            indexed: true,
            defaultRule: 'success',
            endpointFile: {
              version: 1,
              name: 'Token',
              method: 'GET',
              endpoint: '/v1/token',
              rules: [
                { name: 'success', status: 200 },
                { name: 'error', status: 400 },
              ],
            },
          },
        ],
        invalid: [],
      }),
    } as unknown as MockConfigService);

    provider.setAppliedRules([
      {
        endpoint: '/v1/token',
        method: 'GET',
        ruleName: 'success',
        filePath: `${root}/.fliwright/mocks/api/token.json`,
        appliedAt: 1,
      },
      {
        endpoint: '/v1/token',
        method: 'GET',
        ruleName: 'error',
        filePath: `${root}/.fliwright/mocks/api/token.json`,
        appliedAt: 2,
      },
    ]);
    const [endpoint] = await provider.getChildren();
    const rules = await provider.getChildren(endpoint);

    expect(rules).toHaveLength(2);
    expect(rules.filter((rule) => rule.kind === 'rule' && rule.applied)).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: 'rule', applied: false });
    expect(rules[1]).toMatchObject({ kind: 'rule', applied: true });
    expect(provider.getTreeItem(endpoint!).description).toContain('1 active');
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

  it('shows last analyzed form fields as clickable insert rows', async () => {
    const root = await createWorkspace();
    const provider = new FormDataTreeProvider({
      discover: vi.fn<FormRuleService['discover']>().mockResolvedValue({
        root: Uri.file(`${root}/.fliwright/forms`),
        files: [
          {
            kind: 'formRulesFile',
            uri: Uri.file(`${root}/.fliwright/forms/login.json`),
            rulesFile: { version: 1, rules: [] },
          },
        ],
        invalid: [],
      }),
    } as unknown as FormRuleService);

    provider.setLastSummary({ action: 'analyze', total: 1, ranAt: 1 });
    provider.setLastAnalyze({
      fields: [
        {
          id: 'username',
          label: 'Username',
          semanticType: 'email',
          generatedValue: 'test@example.com',
          selector: 'name=username',
        },
      ],
    });

    const [summary] = await provider.getChildren();
    expect(summary).toMatchObject({ kind: 'formRoot', label: 'Last analyze' });
    const fields = await provider.getChildren(summary);
    expect(fields).toHaveLength(1);

    const item = provider.getTreeItem(fields[0]!);
    expect(item.contextValue).toBe('formAnalyzeField');
    expect(item.command).toMatchObject({ command: 'fliwright.addAnalyzedFieldToFormRules' });
  });

  it('discovers runnable scripts only under .fliwright/scripts', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/auto-register-fill.mjs', 'console.log("root");\n');
    await writeText(root, '.fliwright/scripts/auto-register-fill.mjs', 'console.log("script");\n');

    const scripts = await new ScriptDiscoveryService().discover(Uri.file(root));

    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({
      kind: 'scriptFile',
      label: 'auto-register-fill.mjs',
      description: '.fliwright/scripts/auto-register-fill.mjs',
    });
  });

  it('opens script rows from the label click', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/scripts/auto-register-fill.mjs', 'console.log("script");\n');
    const provider = new ScriptsTreeProvider(new ScriptDiscoveryService());

    const [script] = await provider.getChildren();
    expect(script).toMatchObject({ kind: 'scriptFile', label: 'auto-register-fill.mjs' });

    const item = provider.getTreeItem(script!);
    expect(item.contextValue).toBe('scriptFile');
    expect(item.command).toMatchObject({ command: 'fliwright.openScript' });
  });

  it('discovers flows sorted by most recently updated and ignores malformed files', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/flows/broken.flow.json', '{bad json');
    await writeText(root, '.fliwright/flows/ignored.json', '{}\n');
    await writeText(root, '.fliwright/flows/older.flow.json', `${JSON.stringify({
      version: 1,
      id: 'older',
      title: 'Checkout happy path',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      source: { kind: 'recording' },
      nodes: [{ id: 'start', type: 'start', title: 'Start', position: { x: 0, y: 0 } }],
      edges: [],
    }, null, 2)}\n`);
    await writeText(root, '.fliwright/flows/newer.flow.json', `${JSON.stringify({
      version: 1,
      id: 'newer',
      title: 'Payment failed branch',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      source: { kind: 'manual' },
      nodes: [
        { id: 'start', type: 'start', title: 'Start', position: { x: 0, y: 0 } },
        { id: 'failed', type: 'decision', title: 'Payment failed?', position: { x: 240, y: 0 } },
      ],
      edges: [{ id: 'edge-1', from: 'start', to: 'failed' }],
    }, null, 2)}\n`);

    const provider = new FlowsTreeProvider();
    const flows = await provider.getChildren();

    expect(flows).toHaveLength(2);
    expect(flows[0]).toMatchObject({
      kind: 'flowFile',
      label: 'Payment failed branch',
      description: 'manual',
    });
    expect(flows[1]).toMatchObject({
      kind: 'flowFile',
      label: 'Checkout happy path',
      description: 'recording',
    });

    const item = provider.getTreeItem(flows[0]!);
    expect(item.contextValue).toBe('flowFile');
    expect(item.command).toMatchObject({ command: 'fliwright.openFlow' });
    expect(item.tooltip).toContain('2 node(s), 1 edge(s)');
  });

  it('offers a create flow command from the empty flows state', async () => {
    await createWorkspace();
    const provider = new FlowsTreeProvider();

    const [empty] = await provider.getChildren();

    expect(empty).toMatchObject({
      kind: 'empty',
      label: 'No Fliwright flows',
      command: { command: 'fliwright.createFlow' },
    });
    const item = provider.getTreeItem(empty!);
    expect(item.command).toMatchObject({ command: 'fliwright.createFlow' });
  });

  it('updates state provider rows without replacing the whole tree', () => {
    const provider = new StateTreeProvider();

    provider.setProviders([
      {
        kind: 'stateProvider',
        key: 'counterProvider',
        type: 'int',
        value: 0,
        readable: true,
        overridable: false,
      },
    ]);
    provider.updateProvider({
      kind: 'stateProvider',
      key: 'counterProvider',
      value: 1,
      watching: true,
    });

    const [node] = provider.getChildren();
    expect(node).toMatchObject({ key: 'counterProvider', value: 1, type: 'int', watching: true });

    const item = provider.getTreeItem(node!);
    expect(item.iconPath).toMatchObject({ id: 'eye' });
    expect(item.tooltip).toContain('Watching: true');
  });
});
