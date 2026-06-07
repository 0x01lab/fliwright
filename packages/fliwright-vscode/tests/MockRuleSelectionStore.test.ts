import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { MockRuleSelectionStore } from '../src/sandbox/MockRuleSelectionStore.js';
import type { MockDiscoveryResult } from '../src/types.js';

describe('MockRuleSelectionStore', () => {
  it('persists the latest selected rule per method and endpoint', async () => {
    const state = new MemoryMemento();
    const store = new MockRuleSelectionStore(state);

    await store.saveAppliedRule({
      endpoint: '/v1/token',
      method: 'GET',
      ruleName: 'success',
      filePath: '/tmp/token.json',
      appliedAt: 1,
    });
    await store.saveAppliedRule({
      endpoint: '/v1/token',
      method: 'GET',
      ruleName: 'error',
      filePath: '/tmp/token.json',
      appliedAt: 2,
    });

    expect(store.getSelections()).toHaveLength(1);
    expect(store.getSelections()[0]).toMatchObject({
      endpoint: '/v1/token',
      method: 'GET',
      ruleName: 'error',
      filePath: '/tmp/token.json',
    });
  });

  it('removes selections by endpoint and clears the persisted state', async () => {
    const state = new MemoryMemento();
    const store = new MockRuleSelectionStore(state);

    await store.saveAppliedRule({
      endpoint: '/v1/token',
      method: 'GET',
      ruleName: 'success',
      filePath: '/tmp/token.json',
      appliedAt: 1,
    });
    await store.removeRule({
      endpoint: '/v1/token',
      method: 'GET',
    });

    expect(store.getSelections()).toHaveLength(0);

    await store.saveAppliedRule({
      endpoint: '/v1/profile',
      method: 'POST',
      ruleName: 'success',
      filePath: '/tmp/profile.json',
      appliedAt: 2,
    });
    await store.clear();

    expect(store.getSelections()).toHaveLength(0);
  });

  it('resolves stored selections against discovered mock configs', async () => {
    const state = new MemoryMemento();
    const store = new MockRuleSelectionStore(state);

    await store.saveAppliedRule({
      endpoint: '/v1/token',
      method: 'GET',
      ruleName: 'error',
      filePath: '/tmp/token.json',
      appliedAt: 1,
    });
    await store.saveAppliedRule({
      endpoint: '/v1/missing',
      method: 'GET',
      ruleName: 'success',
      filePath: '/tmp/missing.json',
      appliedAt: 2,
    });

    const resolved = store.resolveSelections(discovery());
    const missing = resolved.find((item) => item.selection.endpoint === '/v1/missing');
    const token = resolved.find((item) => item.selection.endpoint === '/v1/token');

    expect(resolved).toHaveLength(2);
    expect(missing).toMatchObject({ reason: 'endpoint not found' });
    expect(token?.entry).toMatchObject({
      endpoint: '/v1/token',
      method: 'GET',
      rule: { name: 'error', status: 500 },
    });
  });

  it('ignores invalid persisted values', () => {
    const state = new MemoryMemento();
    state.rawSet('fliwright.mock.selectedRules.v1', { version: 1, rules: [{ endpoint: '/v1/token' }] });

    const store = new MockRuleSelectionStore(state);

    expect(store.getSelections()).toEqual([]);
  });
});

class MemoryMemento {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
      return;
    }
    this.values.set(key, value);
  }

  rawSet(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

function discovery(): MockDiscoveryResult {
  return {
    root: Uri.file('/tmp/.fliwright/mocks'),
    indexUri: Uri.file('/tmp/.fliwright/mocks/mock-index.json'),
    endpoints: [
      {
        kind: 'endpoint',
        uri: Uri.file('/tmp/token.json'),
        indexed: true,
        defaultRule: 'success',
        endpointFile: {
          version: 1,
          name: 'Token',
          method: 'GET',
          endpoint: '/v1/token',
          rules: [
            { name: 'success', status: 200 },
            { name: 'error', status: 500 },
          ],
        },
      },
    ],
    invalid: [],
  };
}
