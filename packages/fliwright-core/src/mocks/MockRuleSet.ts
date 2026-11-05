import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { normalizeMockEndpointConfig } from '../MockRuleStore.js';
import type { MockEndpointConfig, MockRouteResponse, NormalizedMockEndpointConfig } from '../types.js';

/** A named library of existing endpoint JSON files, shared or local to one Item. */
export interface MockRuleSource {
  name: string;
  directory: string;
  /** Relative paths within directory; no implicit directory scanning or activation. */
  files: string[];
}

/** Select one response. Replacing an earlier selection requires replace: true. */
export interface MockRuleSelection {
  source: string;
  endpoint: string;
  method: string;
  rule: string;
  replace?: boolean;
}

export interface MockRuleSet {
  sources: MockRuleSource[];
  rules: MockRuleSelection[];
  /** Unmatched requests are denied unless explicitly set to false. */
  denyUnmatchedRequests?: boolean;
}

export interface MockRuleProvenance {
  source: string;
  directory: string;
  file: string;
  contentHash: string;
  endpoint: string;
  method: string;
  rule: string;
}

/** Audit metadata only: response bodies are deliberately excluded. */
export interface MockRuleSetReport {
  fingerprint: string;
  denyUnmatchedRequests: boolean;
  routes: MockRuleProvenance[];
}

export interface ResolvedMockRuleSet extends Omit<MockRuleSetReport, 'routes'> {
  routes: Array<MockRuleProvenance & { response: MockRouteResponse }>;
}

/** Resolve and validate all named sources and selections before changing runtime state. */
export async function resolveMockRuleSet(config: MockRuleSet): Promise<ResolvedMockRuleSet> {
  if (!Array.isArray(config.sources) || !Array.isArray(config.rules)) {
    throw new Error('Mock rule sets require sources and rules arrays.');
  }
  if (config.denyUnmatchedRequests !== undefined && typeof config.denyUnmatchedRequests !== 'boolean') {
    throw new Error('denyUnmatchedRequests must be a boolean.');
  }
  const sources = new Map<string, Map<string, { config: NormalizedMockEndpointConfig; file: string; contentHash: string }>>();
  for (const source of config.sources) {
    if (!source || !nonempty(source.name) || !nonempty(source.directory) || !Array.isArray(source.files) || !source.files.length) {
      throw new Error('Mock sources require a name, directory and non-empty files array.');
    }
    if (sources.has(source.name)) throw new Error(`Duplicate mock source '${source.name}'.`);
    const endpoints = new Map<string, { config: NormalizedMockEndpointConfig; file: string; contentHash: string }>();
    for (const file of source.files) {
      if (!nonempty(file) || isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.includes('\\')
        || file.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Mock source '${source.name}' requires relative file paths within its directory: '${file}'.`);
      }
      try {
        const content = await readFile(join(source.directory, file), 'utf8');
        const parsed = validateEndpoint(JSON.parse(content));
        const key = routeKey(parsed.method, parsed.endpoint);
        if (endpoints.has(key)) throw new Error(`Duplicate endpoint ${key} within source '${source.name}'.`);
        endpoints.set(key, { config: parsed, file, contentHash: digest(content) });
      } catch (error) {
        throw new Error(`Mock source '${source.name}', file '${file}': ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
    sources.set(source.name, endpoints);
  }

  const routes = new Map<string, ResolvedMockRuleSet['routes'][number]>();
  for (const selection of config.rules) {
    if (!selection || !nonempty(selection.method) || !nonempty(selection.endpoint) || !nonempty(selection.rule)) {
      throw new Error('Mock selections require source, method, endpoint and rule.');
    }
    const source = sources.get(selection.source);
    if (!source) throw new Error(`Unknown mock source '${selection.source}'.`);
    const method = selection.method.toUpperCase();
    const key = routeKey(method, selection.endpoint);
    const entry = source.get(key);
    const rule = entry?.config.rules.find(rule => rule.name === selection.rule);
    if (!entry || !rule) throw new Error(`Mock selection '${selection.source}': ${key} -> '${selection.rule}' not found.`);
    if (selection.replace !== undefined && typeof selection.replace !== 'boolean') throw new Error('Mock selection replace must be a boolean.');
    if (routes.has(key) && selection.replace !== true) throw new Error(`Duplicate mock selection ${key}; declare replace: true to replace it.`);
    if (!routes.has(key) && selection.replace === true) throw new Error(`Cannot replace unselected mock endpoint ${key}.`);
    const { name: _name, ...response } = rule;
    routes.set(key, {
      source: selection.source,
      directory: config.sources.find(source => source.name === selection.source)!.directory,
      file: entry.file, contentHash: entry.contentHash, endpoint: selection.endpoint, method, rule: selection.rule, response,
    });
  }
  const selected = [...routes.values()].sort((a, b) => routeKey(a.method, a.endpoint).localeCompare(routeKey(b.method, b.endpoint)));
  const denyUnmatchedRequests = config.denyUnmatchedRequests !== false;
  const provenance = selected.map(({ response: _response, ...route }) => route);
  return { routes: selected, denyUnmatchedRequests, fingerprint: digest(JSON.stringify({ denyUnmatchedRequests, routes: provenance })) };
}

function validateEndpoint(value: unknown): NormalizedMockEndpointConfig {
  if (!record(value) || value.version !== 1 || !nonempty(value.name) || !nonempty(value.method)
    || !/^[A-Za-z]+$/.test(value.method) || !nonempty(value.endpoint) || !value.endpoint.startsWith('/')
    || !Array.isArray(value.rules) || !value.rules.length) {
    throw new Error('Expected a version 1 endpoint config with name, method, endpoint and non-empty rules.');
  }
  const names = new Set<string>();
  if (value.baseRule !== undefined) validateResponse(value.baseRule);
  for (const rule of value.rules) {
    validateResponse(rule);
    if (!record(rule) || !nonempty(rule.name) || names.has(rule.name)) throw new Error('Mock rule names must be non-empty and unique.');
    names.add(rule.name);
    if (rule.removeBodyFields !== undefined && (!Array.isArray(rule.removeBodyFields) || !rule.removeBodyFields.every(nonempty))) {
      throw new Error('removeBodyFields must be an array of field names.');
    }
  }
  return normalizeMockEndpointConfig({ ...value, method: value.method.toUpperCase() } as unknown as MockEndpointConfig);
}

function validateResponse(value: unknown): void {
  if (!record(value)) throw new Error('Mock response definitions must be objects.');
  if (value.status !== undefined && (!Number.isInteger(value.status) || (value.status as number) < 100 || (value.status as number) > 599)) {
    throw new Error('Mock status must be an HTTP status between 100 and 599.');
  }
  if (value.delay !== undefined && (typeof value.delay !== 'number' || !Number.isFinite(value.delay) || value.delay < 0)) {
    throw new Error('Mock delay must be a non-negative finite number.');
  }
  if (value.headers !== undefined && (!record(value.headers) || !Object.values(value.headers).every(value => typeof value === 'string'))) {
    throw new Error('Mock headers must contain string values.');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function routeKey(method: string, endpoint: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
