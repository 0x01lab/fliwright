import type { FliwrightDriver } from '@fliwright/core';
import type {
  AppliedMockRule,
  MockDiscoveryResult,
  MockEndpointEntry,
  MockRule,
  MockRuleEntry,
} from '../types.js';

export class SandboxService {
  private readonly applied = new Map<string, AppliedMockRule>();

  getAppliedRules(): AppliedMockRule[] {
    return Array.from(this.applied.values()).sort((a, b) => b.appliedAt - a.appliedAt);
  }

  isApplied(rule: MockRuleEntry): AppliedMockRule | undefined {
    return this.applied.get(appliedKey(rule.method, rule.endpoint, rule.rule.name));
  }

  async applyRule(driver: FliwrightDriver, entry: MockRuleEntry): Promise<AppliedMockRule> {
    await routeRule(driver, entry.endpoint, entry.method, entry.rule);
    const applied: AppliedMockRule = {
      endpoint: entry.endpoint,
      method: entry.method,
      ruleName: entry.rule.name,
      filePath: entry.uri.fsPath,
      appliedAt: Date.now(),
    };
    this.applied.set(appliedKey(entry.method, entry.endpoint, entry.rule.name), applied);
    return applied;
  }

  async applyDefaultMocks(driver: FliwrightDriver, discovery: MockDiscoveryResult): Promise<{
    applied: AppliedMockRule[];
    skipped: number;
  }> {
    const applied: AppliedMockRule[] = [];
    let skipped = discovery.invalid.length;

    for (const endpoint of discovery.endpoints) {
      const rule = selectDefaultRule(endpoint);
      if (!rule) {
        skipped++;
        continue;
      }
      const entry: MockRuleEntry = {
        kind: 'rule',
        uri: endpoint.uri,
        endpoint: endpoint.endpointFile.endpoint,
        method: endpoint.endpointFile.method,
        rule,
        isDefault: true,
      };
      applied.push(await this.applyRule(driver, entry));
    }

    return { applied, skipped };
  }

  async clear(driver: FliwrightDriver): Promise<number> {
    const count = this.applied.size;
    await driver.mock.clear();
    this.applied.clear();
    return count;
  }
}

function selectDefaultRule(endpoint: MockEndpointEntry): MockRule | undefined {
  const defaultName = endpoint.defaultRule;
  if (defaultName) {
    return endpoint.endpointFile.rules.find((rule) => rule.name === defaultName) ?? endpoint.endpointFile.rules[0];
  }
  return endpoint.endpointFile.rules[0];
}

async function routeRule(
  driver: FliwrightDriver,
  endpoint: string,
  method: string,
  rule: MockRule,
): Promise<void> {
  await driver.mock.route(endpoint, {
    method,
    status: rule.status,
    delay: rule.delay,
    headers: rule.headers,
    body: rule.body,
  });
}

function appliedKey(method: string, endpoint: string, ruleName: string): string {
  return `${method.toUpperCase()} ${endpoint} ${ruleName}`;
}
