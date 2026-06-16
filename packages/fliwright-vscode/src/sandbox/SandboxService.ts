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
    const applied = this.applied.get(appliedKey(rule.method, rule.endpoint));
    return applied?.ruleName === rule.rule.name ? applied : undefined;
  }

  getControllerUrl(): string | undefined {
    return undefined;
  }

  async ensureController(_driver: FliwrightDriver): Promise<string | undefined> {
    return undefined;
  }

  async applyRule(driver: FliwrightDriver, entry: MockRuleEntry): Promise<AppliedMockRule> {
    const routeResult = await routeRule(driver, entry.endpoint, entry.method, entry.rule);
    await assertFlutterMockReady(driver, entry.endpoint, entry.method, routeResult);
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

  async syncFromFlutter(driver: FliwrightDriver, discovery: MockDiscoveryResult): Promise<{
    applied: AppliedMockRule[];
    routes: Array<{ id?: string; method?: string; path: string }>;
    unmatched: Array<{ id?: string; method?: string; path: string }>;
  }> {
    const routes = await driver.mock.listFlutterRoutes();
    this.applied.clear();
    const applied: AppliedMockRule[] = [];
    const unmatched: Array<{ id?: string; method?: string; path: string }> = [];

    for (const route of routes) {
      const match = resolveFlutterRoute(route, discovery);
      if (!match) {
        unmatched.push(route);
        continue;
      }

      this.applied.set(appliedKey(match.method, match.endpoint), match);
      applied.push(match);
    }

    return { applied, routes, unmatched };
  }

  async reconcileFromFlutter(
    driver: FliwrightDriver,
    discovery: MockDiscoveryResult,
    options: {
      selectedEntries?: MockRuleEntry[];
      applyDefaultRules?: boolean;
      onStaleRoutes?: (summary: {
        routes: Array<{ id?: string; method?: string; path: string }>;
        applied: AppliedMockRule[];
        unmatched: Array<{ id?: string; method?: string; path: string }>;
      }) => Promise<void> | void;
    } = {},
  ): Promise<{
    applied: AppliedMockRule[];
    routes: Array<{ id?: string; method?: string; path: string }>;
    unmatched: Array<{ id?: string; method?: string; path: string }>;
    rebuilt: boolean;
    reconciled: AppliedMockRule[];
    skipped: number;
  }> {
    let sync = await this.syncFromFlutter(driver, discovery);
    let rebuilt = false;
    if (sync.unmatched.length > 0) {
      await options.onStaleRoutes?.(sync);
      await this.clear(driver);
      rebuilt = true;
      sync = { applied: [], routes: [], unmatched: [] };
    }

    const activeKeys = new Set(
      this.getAppliedRules().map((rule) => appliedKey(rule.method, rule.endpoint)),
    );
    const selectedByKey = new Map(
      (options.selectedEntries ?? []).map((entry) => [appliedKey(entry.method, entry.endpoint), entry] as const),
    );
    const reconciled: AppliedMockRule[] = [];
    let skipped = 0;

    for (const endpoint of discovery.endpoints) {
      const key = appliedKey(endpoint.endpointFile.method, endpoint.endpointFile.endpoint);
      if (activeKeys.has(key)) continue;

      const selected = selectedByKey.get(key);
      if (selected) {
        const applied = await this.applyRule(driver, selected);
        activeKeys.add(key);
        reconciled.push(applied);
        continue;
      }

      if (!options.applyDefaultRules) {
        skipped++;
        continue;
      }

      const rule = selectDefaultRule(endpoint);
      if (!rule) {
        skipped++;
        continue;
      }

      const applied = await this.applyRule(driver, {
        kind: 'rule',
        uri: endpoint.uri,
        endpoint: endpoint.endpointFile.endpoint,
        method: endpoint.endpointFile.method,
        rule,
        isDefault: true,
      });
      activeKeys.add(key);
      reconciled.push(applied);
    }

    return {
      ...sync,
      rebuilt,
      reconciled,
      skipped,
    };
  }

  async stopRule(driver: FliwrightDriver, entry: MockRuleEntry): Promise<boolean> {
    const key = appliedKey(entry.method, entry.endpoint);
    const applied = this.applied.get(key);
    if (applied && applied.ruleName !== entry.rule.name) return false;
    if (!applied) {
      const flutterRoute = await findFlutterRoute(driver, entry.endpoint, entry.method);
      if (!flutterRoute) return false;
      const parsed = parseRouteId(flutterRoute.id);
      if (parsed && parsed.ruleName !== entry.rule.name) return false;
    }
    await driver.mock.removeFlutterRoute(entry.endpoint, entry.method);
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
      const routeResult = await routeRule(driver, entry.endpoint, entry.method, entry.rule);
      await assertFlutterMockReady(driver, entry.endpoint, entry.method, routeResult);
      const appliedRule: AppliedMockRule = {
        endpoint: entry.endpoint,
        method: entry.method,
        ruleName: entry.rule.name,
        filePath: entry.uri.fsPath,
        appliedAt: Date.now(),
      };
      this.applied.set(appliedKey(entry.method, entry.endpoint), appliedRule);
      applied.push(appliedRule);
    }

    return { applied, skipped };
  }

  async clear(driver: FliwrightDriver): Promise<number> {
    const count = this.applied.size;
    await driver.mock.clearFlutterRoutes();
    this.applied.clear();
    return count;
  }

  resetController(): void {
    this.applied.clear();
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
): Promise<unknown> {
  const response = {
    id: routeId(endpoint, method, rule.name),
    method,
    status: rule.status,
    delay: rule.delay,
    headers: rule.headers,
    body: rule.body,
  };
  return (await driver.mock.routeFlutter(endpoint, response)) ?? { success: true };
}

function appliedKey(method: string, endpoint: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

function routeId(endpoint: string, method: string, ruleName: string): string {
  return `fliwright-vscode:${encodeURIComponent(method.toUpperCase())}:${encodeURIComponent(endpoint)}:${encodeURIComponent(ruleName)}`;
}

function resolveFlutterRoute(
  route: { id?: string; method?: string; path: string },
  discovery: MockDiscoveryResult,
): AppliedMockRule | undefined {
  const parsed = parseRouteId(route.id);
  const endpoint = parsed?.endpoint ?? route.path;
  const method = (parsed?.method ?? route.method)?.toUpperCase();
  if (!method) return undefined;

  const endpointEntry = discovery.endpoints.find((candidate) => (
    candidate.endpointFile.endpoint === endpoint &&
    candidate.endpointFile.method.toUpperCase() === method
  ));
  if (!endpointEntry) return undefined;

  const rule = parsed?.ruleName
    ? endpointEntry.endpointFile.rules.find((candidate) => candidate.name === parsed.ruleName)
    : singleRule(endpointEntry);
  if (!rule) return undefined;

  return {
    endpoint,
    method: endpointEntry.endpointFile.method,
    ruleName: rule.name,
    filePath: endpointEntry.uri.fsPath,
    appliedAt: Date.now(),
  };
}

function parseRouteId(id: string | undefined): { method: string; endpoint: string; ruleName: string } | undefined {
  if (!id?.startsWith('fliwright-vscode:')) return undefined;
  const parts = id.split(':');
  if (parts.length !== 4) return undefined;
  try {
    return {
      method: decodeURIComponent(parts[1] ?? '').toUpperCase(),
      endpoint: decodeURIComponent(parts[2] ?? ''),
      ruleName: decodeURIComponent(parts[3] ?? ''),
    };
  } catch {
    return undefined;
  }
}

function singleRule(endpoint: MockEndpointEntry): MockRule | undefined {
  return endpoint.endpointFile.rules.length === 1 ? endpoint.endpointFile.rules[0] : undefined;
}

async function findFlutterRoute(
  driver: FliwrightDriver,
  endpoint: string,
  method: string,
): Promise<{ id?: string; method?: string; path: string } | undefined> {
  try {
    const routes = await driver.mock.listFlutterRoutes();
    return routes.find((route) => (
      route.path === endpoint &&
      (!route.method || route.method.toUpperCase() === method.toUpperCase())
    ));
  } catch {
    return undefined;
  }
}

interface MockDebugState {
  mode?: string;
  serverPort?: number | null;
  interceptorInjected?: boolean;
  routes?: Array<{ method?: string; path?: string }>;
}

interface MockListRoutesResult {
  routes?: Array<{ method?: string; path?: string }>;
}

async function assertFlutterMockReady(
  driver: FliwrightDriver,
  endpoint: string,
  method: string,
  routeResult: unknown,
): Promise<void> {
  const state = unwrapExtensionPayload<MockDebugState>(
    await driver.sendRequest('ext.fliwright.mock.debugState', {}),
  );
  if (!state || typeof state !== 'object') {
    throw new Error('Flutter mock debug state is unavailable. Ensure FliwrightBridge mock extensions are initialized.');
  }

  if (state.mode === 'dio' && state.interceptorInjected !== true) {
    throw new Error(
      'Dio mock route was registered, but FliwrightDioMockInterceptor is not injected. '
      + 'Add the interceptor to the app Dio instance and call DioMockExtension.setInterceptor(interceptor).',
    );
  }

  if (state.mode === 'http' && (state.serverPort == null || !Number.isFinite(state.serverPort))) {
    throw new Error('HTTP mock route was registered, but the Flutter mock server is not running.');
  }

  const routeList = unwrapExtensionPayload<MockListRoutesResult>(
    await driver.sendRequest('ext.fliwright.mock.listRoutes', {}),
  );
  const routeRegistered = isSuccessfulRouteResult(routeResult);
  const routes = [
    ...(Array.isArray(state.routes) ? state.routes : []),
    ...(Array.isArray(routeList?.routes) ? routeList.routes : []),
  ];
  const routeSynced = routes.some((route) => (
    route.path === endpoint &&
    (!route.method || route.method.toUpperCase() === method.toUpperCase())
  ));
  if (!routeSynced && !routeRegistered) {
    const available = routes.map(formatFlutterRouteForError);
    throw new Error(
      `Flutter mock route was not registered: ${method.toUpperCase()} ${endpoint}. `
      + `Available Flutter routes: ${available.length ? available.join(', ') : '(none)'}`,
    );
  }
}

function formatFlutterRouteForError(route: { id?: string; method?: string; path?: string }): string {
  const label = `${(route.method ?? '*').toUpperCase()} ${route.path ?? '(unknown)'}`;
  const parsed = parseRouteId(route.id);
  if (parsed) return `${label} -> ${parsed.ruleName}`;
  return route.id ? `${label} id=${route.id}` : label;
}

function isSuccessfulRouteResult(value: unknown): boolean {
  const payload = unwrapExtensionPayload<Record<string, unknown>>(value);
  if (!payload || typeof payload !== 'object') return false;
  if (payload.success === true) return true;
  return typeof payload.id === 'string' && payload.id.length > 0;
}

function unwrapExtensionPayload<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'result' in value) {
    const result = (value as { result?: unknown }).result;
    if (typeof result === 'string') {
      try {
        return JSON.parse(result) as T;
      } catch {
        return value as T;
      }
    }
    if (result && typeof result === 'object') {
      return unwrapExtensionPayload<T>(result);
    }
  }
  if (value && typeof value === 'object' && 'response' in value) {
    const response = (value as { response?: unknown }).response;
    if (typeof response === 'string') {
      try {
        return JSON.parse(response) as T;
      } catch {
        return value as T;
      }
    }
    if (response && typeof response === 'object') {
      return response as T;
    }
  }
  return value as T;
}

function summarizeBody(body: unknown): string {
  if (body === undefined) return 'undefined';
  if (body === null) return 'null';
  if (Array.isArray(body)) return `array(${body.length})`;
  if (typeof body === 'object') return `object(${Object.keys(body).length})`;
  return typeof body;
}
