import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { MockRule, MockRuleEntry, MockEndpointConfig, MockIndex, MockRouteResponse } from './types.js';

const FALLBACK_DEFAULT_RULE = 'success';

export class MockRuleStore {
  private entries = new Map<string, MockRuleEntry>();

  /**
   * Convert a MockRule to a MockRouteResponse.
   */
  private ruleToResponse(rule: MockRule): MockRouteResponse {
    const response: MockRouteResponse = {};
    if (rule.status !== undefined) response.status = rule.status;
    if (rule.headers !== undefined) response.headers = rule.headers;
    if (rule.body !== undefined) response.body = rule.body;
    if (rule.delay !== undefined) response.delay = rule.delay;
    return response;
  }

  /**
   * Load mock configurations from a directory.
   * Reads mock-index.json for the default rule and file list when present.
   * If no index exists, scans api/*.json and uses "success" as the default
   * active rule, falling back to the first rule in each endpoint file.
   */
  async loadFromDirectory(mockDir: string): Promise<void> {
    const indexPath = join(mockDir, 'mock-index.json');

    const source = await this.resolveLoadSource(mockDir, indexPath);
    if (!source) return;

    for (const file of source.files) {
      const filePath = join(mockDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const config = JSON.parse(content) as MockEndpointConfig;
        this.registerEndpoint(config, source.defaultRule);
      } catch (e) {
        // Skip files that fail to parse — log a warning
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[MockRuleStore] Skipping ${file}: ${message}`);
      }
    }
  }

  private async resolveLoadSource(
    mockDir: string,
    indexPath: string,
  ): Promise<{ defaultRule: string; files: string[] } | null> {
    let indexJson: string | null = null;
    try {
      indexJson = await readFile(indexPath, 'utf-8');
    } catch {
      return this.fallbackScanApiDirectory(mockDir);
    }

    try {
      const index = JSON.parse(indexJson) as MockIndex;
      if (!index.files || !Array.isArray(index.files)) {
        console.warn('[MockRuleStore] Index missing "files" array, skipping');
        return null;
      }
      if (!index.defaultRule) {
        console.warn('[MockRuleStore] Index missing "defaultRule", using "success"');
      }
      return {
        defaultRule: index.defaultRule || FALLBACK_DEFAULT_RULE,
        files: index.files,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[MockRuleStore] Invalid index JSON: ${message}, skipping`);
      return null;
    }
  }

  private async fallbackScanApiDirectory(
    mockDir: string,
  ): Promise<{ defaultRule: string; files: string[] } | null> {
    try {
      const entries = await readdir(join(mockDir, 'api'), { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => `api/${entry.name}`)
        .sort();

      if (files.length === 0) {
        console.warn('[MockRuleStore] No mock-index.json and no api/*.json files found');
        return null;
      }

      console.warn(
        `[MockRuleStore] mock-index.json not found; auto-loading ${files.length} api/*.json file(s) with defaultRule="${FALLBACK_DEFAULT_RULE}"`,
      );
      return { defaultRule: FALLBACK_DEFAULT_RULE, files };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[MockRuleStore] mock-index.json not found and api directory could not be scanned: ${message}`);
      return null;
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

    this.entries.set(routeKey(config.endpoint, config.method), {
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
  getActiveResponse(endpoint: string, method?: string): MockRouteResponse | null {
    const entry = this.findEntry(endpoint, method);
    if (!entry) return null;

    const rule = entry.rules.get(entry.activeRule);
    if (!rule) return null;

    return this.ruleToResponse(rule);
  }

  /**
   * Switch the active rule for an endpoint.
   * Returns the new active rule's response, or throws if endpoint/rule not found.
   */
  switchRule(endpoint: string, ruleName: string, method?: string): MockRouteResponse | null {
    const entry = this.findEntry(endpoint, method);
    if (!entry) {
      const available = this.listEndpoints().map((item) => `${item.method} ${item.endpoint}`);
      throw new Error(
        `Endpoint "${formatRoute(endpoint, method)}" not found. Registered endpoints: ${available.join(', ') || '(none)'}`,
      );
    }

    const rule = entry.rules.get(ruleName);
    if (!rule) {
      const available = Array.from(entry.rules.keys());
      throw new Error(
        `Rule "${ruleName}" not found for endpoint "${formatRoute(endpoint, entry.method)}". available: ${available.join(', ')}`,
      );
    }

    entry.activeRule = ruleName;

    return this.ruleToResponse(rule);
  }

  /**
   * Check whether any rules have been loaded.
   */
  get isLoaded(): boolean {
    return this.entries.size > 0;
  }

  private findEntry(endpoint: string, method?: string): MockRuleEntry | undefined {
    if (method) return this.entries.get(routeKey(endpoint, method));

    const matches = Array.from(this.entries.values()).filter((entry) => entry.endpoint === endpoint);
    if (matches.length <= 1) return matches[0];

    throw new Error(
      `Endpoint "${endpoint}" is ambiguous. Specify method. Available: ${
        matches.map((entry) => `${entry.method} ${entry.endpoint}`).join(', ')
      }`,
    );
  }
}

function routeKey(endpoint: string, method: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

function formatRoute(endpoint: string, method?: string): string {
  return method ? `${method.toUpperCase()} ${endpoint}` : endpoint;
}
