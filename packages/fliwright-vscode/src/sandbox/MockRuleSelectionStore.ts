import type * as vscode from 'vscode';
import type {
  AppliedMockRule,
  HttpMethod,
  MockDiscoveryResult,
  MockRuleEntry,
} from '../types.js';

const SELECTED_MOCK_RULES_KEY = 'fliwright.mock.selectedRules.v1';

export interface StoredMockRuleSelection {
  endpoint: string;
  method: HttpMethod;
  ruleName: string;
  filePath?: string;
  updatedAt: number;
}

interface StoredMockRuleSelectionsState {
  version: 1;
  rules: StoredMockRuleSelection[];
}

export class MockRuleSelectionStore {
  constructor(private readonly state: Pick<vscode.Memento, 'get' | 'update'>) {}

  getSelections(): StoredMockRuleSelection[] {
    const value = this.state.get<unknown>(SELECTED_MOCK_RULES_KEY);
    if (!isSelectionState(value)) return [];
    return normalizeSelections(value.rules);
  }

  async saveAppliedRule(rule: AppliedMockRule): Promise<void> {
    const selections = this.getSelections();
    const next = upsertSelection(selections, {
      endpoint: rule.endpoint,
      method: rule.method,
      ruleName: rule.ruleName,
      filePath: rule.filePath,
      updatedAt: Date.now(),
    });
    await this.write(next);
  }

  async removeRule(rule: Pick<MockRuleEntry, 'endpoint' | 'method'>): Promise<void> {
    const next = this.getSelections().filter((selection) => (
      selectionKey(selection.method, selection.endpoint) !== selectionKey(rule.method, rule.endpoint)
    ));
    await this.write(next);
  }

  async clear(): Promise<void> {
    await this.write([]);
  }

  resolveSelections(discovery: MockDiscoveryResult): Array<{
    selection: StoredMockRuleSelection;
    entry?: MockRuleEntry;
    reason?: string;
  }> {
    return this.getSelections().map((selection) => {
      const endpoint = discovery.endpoints.find((candidate) => (
        candidate.endpointFile.endpoint === selection.endpoint &&
        candidate.endpointFile.method.toUpperCase() === selection.method.toUpperCase()
      ));
      if (!endpoint) {
        return { selection, reason: 'endpoint not found' };
      }

      const rule = endpoint.endpointFile.rules.find((candidate) => candidate.name === selection.ruleName);
      if (!rule) {
        return { selection, reason: 'rule not found' };
      }

      return {
        selection,
        entry: {
          kind: 'rule',
          uri: endpoint.uri,
          endpoint: endpoint.endpointFile.endpoint,
          method: endpoint.endpointFile.method,
          rule,
          isDefault: rule.name === (endpoint.defaultRule ?? endpoint.endpointFile.rules[0]?.name),
        },
      };
    });
  }

  private async write(rules: StoredMockRuleSelection[]): Promise<void> {
    const normalized = normalizeSelections(rules);
    const value: StoredMockRuleSelectionsState | undefined = normalized.length
      ? { version: 1, rules: normalized }
      : undefined;
    await this.state.update(SELECTED_MOCK_RULES_KEY, value);
  }
}

function upsertSelection(
  selections: StoredMockRuleSelection[],
  next: StoredMockRuleSelection,
): StoredMockRuleSelection[] {
  const key = selectionKey(next.method, next.endpoint);
  return normalizeSelections([
    ...selections.filter((selection) => selectionKey(selection.method, selection.endpoint) !== key),
    next,
  ]);
}

function normalizeSelections(selections: StoredMockRuleSelection[]): StoredMockRuleSelection[] {
  const latestByEndpoint = new Map<string, StoredMockRuleSelection>();
  for (const selection of selections) {
    const key = selectionKey(selection.method, selection.endpoint);
    const previous = latestByEndpoint.get(key);
    if (!previous || selection.updatedAt >= previous.updatedAt) {
      latestByEndpoint.set(key, {
        endpoint: selection.endpoint,
        method: selection.method.toUpperCase() as HttpMethod,
        ruleName: selection.ruleName,
        filePath: selection.filePath,
        updatedAt: selection.updatedAt,
      });
    }
  }
  return Array.from(latestByEndpoint.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function selectionKey(method: string, endpoint: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

function isSelectionState(value: unknown): value is StoredMockRuleSelectionsState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredMockRuleSelectionsState>;
  return candidate.version === 1 && Array.isArray(candidate.rules) && candidate.rules.every(isSelection);
}

function isSelection(value: unknown): value is StoredMockRuleSelection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredMockRuleSelection>;
  return (
    typeof candidate.endpoint === 'string' &&
    typeof candidate.method === 'string' &&
    typeof candidate.ruleName === 'string' &&
    typeof candidate.updatedAt === 'number' &&
    (candidate.filePath === undefined || typeof candidate.filePath === 'string')
  );
}
