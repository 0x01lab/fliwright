import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MockRule, MockRuleEntry, MockEndpointConfig, MockIndex, MockRouteResponse } from './types.js';

export class MockRuleStore {
  private entries = new Map<string, MockRuleEntry>();

  /**
   * Load mock configurations from a directory.
   * Reads mock-index.json for the default rule and file list,
   * then parses each endpoint config file.
   * Silently skips if the directory or index file doesn't exist.
   */
  async loadFromDirectory(mockDir: string): Promise<void> {
    const indexPath = join(mockDir, 'mock-index.json');

    let indexJson: string;
    try {
      indexJson = await readFile(indexPath, 'utf-8');
    } catch {
      // Index file missing — skip silently
      return;
    }

    const index = JSON.parse(indexJson) as MockIndex;

    for (const file of index.files) {
      const filePath = join(mockDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const config = JSON.parse(content) as MockEndpointConfig;
        this.registerEndpoint(config, index.defaultRule);
      } catch (e) {
        // Skip files that fail to parse — log a warning
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[MockRuleStore] Skipping ${file}: ${message}`);
      }
    }
  }

  /**
   * Register a single endpoint config with a default active rule.
   */
  private registerEndpoint(config: MockEndpointConfig, defaultRule: string): void {
    const rules = new Map<string, MockRule>();
    for (const rule of config.rules) {
      rules.set(rule.name, rule);
    }

    const activeRule = rules.has(defaultRule) ? defaultRule : config.rules[0]?.name ?? '';

    this.entries.set(config.endpoint, {
      endpoint: config.endpoint,
      method: config.method,
      rules,
      activeRule,
    });
  }

  /**
   * List all registered endpoints with their rules and active selection.
   */
  listEndpoints(): Array<{
    endpoint: string;
    method: string;
    rules: string[];
    activeRule: string;
  }> {
    return Array.from(this.entries.values()).map((entry) => ({
      endpoint: entry.endpoint,
      method: entry.method,
      rules: Array.from(entry.rules.keys()),
      activeRule: entry.activeRule,
    }));
  }

  /**
   * Get the active rule's response for an endpoint.
   * Returns null if the endpoint is not registered.
   */
  getActiveResponse(endpoint: string): MockRouteResponse | null {
    const entry = this.entries.get(endpoint);
    if (!entry) return null;

    const rule = entry.rules.get(entry.activeRule);
    if (!rule) return null;

    const response: MockRouteResponse = {};
    if (rule.status !== undefined) response.status = rule.status;
    if (rule.headers !== undefined) response.headers = rule.headers;
    if (rule.body !== undefined) response.body = rule.body;
    if (rule.delay !== undefined) response.delay = rule.delay;

    return response;
  }

  /**
   * Switch the active rule for an endpoint.
   * Returns the new active rule's response, or throws if endpoint/rule not found.
   */
  switchRule(endpoint: string, ruleName: string): MockRouteResponse | null {
    const entry = this.entries.get(endpoint);
    if (!entry) {
      const available = Array.from(this.entries.keys());
      throw new Error(
        `Endpoint "${endpoint}" not found. Registered endpoints: ${available.join(', ') || '(none)'}`,
      );
    }

    const rule = entry.rules.get(ruleName);
    if (!rule) {
      const available = Array.from(entry.rules.keys());
      throw new Error(
        `Rule "${ruleName}" not found for endpoint "${endpoint}". available: ${available.join(', ')}`,
      );
    }

    entry.activeRule = ruleName;

    const response: MockRouteResponse = {};
    if (rule.status !== undefined) response.status = rule.status;
    if (rule.headers !== undefined) response.headers = rule.headers;
    if (rule.body !== undefined) response.body = rule.body;
    if (rule.delay !== undefined) response.delay = rule.delay;

    return response;
  }

  /**
   * Check whether any rules have been loaded.
   */
  get isLoaded(): boolean {
    return this.entries.size > 0;
  }
}
