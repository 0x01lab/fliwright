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
  private controllerUrl: string | undefined;

  getAppliedRules(): AppliedMockRule[] {
    return Array.from(this.applied.values()).sort((a, b) => b.appliedAt - a.appliedAt);
  }

  isApplied(rule: MockRuleEntry): AppliedMockRule | undefined {
    const applied = this.applied.get(appliedKey(rule.method, rule.endpoint));
    return applied?.ruleName === rule.rule.name ? applied : undefined;
  }

  getControllerUrl(): string | undefined {
    return this.controllerUrl;
  }

  async ensureController(driver: FliwrightDriver): Promise<string> {
    this.controllerUrl = await driver.mock.startServer();
    await driver.mock.configureFlutterController(this.controllerUrl);
    return this.controllerUrl;
  }

  async applyRule(driver: FliwrightDriver, entry: MockRuleEntry): Promise<AppliedMockRule> {
    await this.ensureController(driver);
    await routeRule(driver, entry.endpoint, entry.method, entry.rule);
    const applied: AppliedMockRule = {
      endpoint: entry.endpoint,
      method: entry.method,
      ruleName: entry.rule.name,
      filePath: entry.uri.fsPath,
      appliedAt: Date.now(),
    };
    this.applied.set(appliedKey(entry.method, entry.endpoint), applied);
    return applied;
  }

  async stopRule(driver: FliwrightDriver, entry: MockRuleEntry): Promise<boolean> {
    const key = appliedKey(entry.method, entry.endpoint);
    const applied = this.applied.get(key);
    if (applied?.ruleName !== entry.rule.name) return false;
    await driver.mock.removeRoute(entry.endpoint, entry.method);
    this.applied.delete(key);
    return true;
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

export function formatMockRuleDebug(entry: MockRuleEntry): string {
  return [
    `${entry.method.toUpperCase()} ${entry.endpoint} -> ${entry.rule.name}`,
    `status=${entry.rule.status}`,
    `delay=${entry.rule.delay ?? 0}ms`,
    `headers=${Object.keys(entry.rule.headers ?? {}).length}`,
    `body=${summarizeBody(entry.rule.body)}`,
  ].join(' ');
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

function appliedKey(method: string, endpoint: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

function summarizeBody(body: unknown): string {
  if (body === undefined) return 'undefined';
  if (body === null) return 'null';
  if (Array.isArray(body)) return `array(${body.length})`;
  if (typeof body === 'object') return `object(${Object.keys(body).length})`;
  return typeof body;
}
