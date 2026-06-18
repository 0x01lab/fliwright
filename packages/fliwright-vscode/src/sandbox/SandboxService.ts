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
      suppressedEndpoints?: Array<{ endpoint: string; method: string }>;
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
    pruned: number;
  }> {
    let sync = await this.syncFromFlutter(driver, discovery);
    let rebuilt = false;
    const suppressedKeys = new Set(
      (options.suppressedEndpoints ?? []).map((entry) => appliedKey(entry.method, entry.endpoint)),
    );
    const suppressedRoutes = sync.routes.filter((route) => isSuppressedFlutterRoute(route, suppressedKeys));
    if (suppressedRoutes.length > 0) {
      for (const route of suppressedRoutes) {
        await driver.mock.removeFlutterRoute(route.path, route.method);
        const method = routeMethod(route);
        if (method) this.applied.delete(appliedKey(method, route.path));
      }
      sync = await this.syncFromFlutter(driver, discovery);
    }
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
    // Desired state = endpoints that SHOULD have an active route: restored selections
    // plus (when applyDefaultRules) endpoints that resolve to a default rule. Routes
    // merely observed in Flutter are not desired on their own — only what VSCode
    // selects is. This set drives the prune pass below.
    const desiredActiveKeys = new Set<string>();
    for (const entry of options.selectedEntries ?? []) {
      desiredActiveKeys.add(appliedKey(entry.method, entry.endpoint));
    }
    if (options.applyDefaultRules) {
      for (const endpoint of discovery.endpoints) {
        if (selectDefaultRule(endpoint)) {
          desiredActiveKeys.add(appliedKey(endpoint.endpointFile.method, endpoint.endpointFile.endpoint));
        }
      }
    }
    const reconciled: AppliedMockRule[] = [];
    let skipped = 0;

    for (const endpoint of discovery.endpoints) {
      const key = appliedKey(endpoint.endpointFile.method, endpoint.endpointFile.endpoint);
      if (activeKeys.has(key)) continue;
      if (suppressedKeys.has(key)) {
        skipped++;
        continue;
      }

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

    // Prune to desired state: remove every Flutter route whose endpoint is NOT
    // in the desired active set. This is desired-state driven (not id-prefix
    // driven), so when VSCode has no selected/default rules the Flutter store is
    // fully cleared — including stale or non-prefixed routes — which is what
    // makes "no active rule in VSCode" actually mean "nothing is mocked".
    // Suppressed endpoints are not exempt: suppression only prevents re-applying
    // a route, it must not spare a route from being cleared. Removal flows
    // through removeFlutterRoute -> Hive save(), so cold starts no longer
    // resurrect pruned routes.
    let pruned = 0;
    const prunedKeys = new Set<string>();
    for (const route of sync.routes) {
      const parsed = parseRouteId(route.id);
      const method = (parsed?.method ?? route.method)?.toUpperCase();
      if (!method) continue;
      const endpoint = parsed?.endpoint ?? route.path;
      const key = appliedKey(method, endpoint);
      if (desiredActiveKeys.has(key)) continue;
      await driver.mock.removeFlutterRoute(route.path, method);
      this.applied.delete(key);
      prunedKeys.add(key);
      pruned += 1;
    }

    // Reflect prune in the returned applied set. sync.applied is a pre-prune
    // snapshot; returning it verbatim would let callers re-save pruned routes
    // into the selection store, which then resurrects them on the next reconnect.
    const finalApplied = sync.applied.filter(
      (rule) => !prunedKeys.has(appliedKey(rule.method, rule.endpoint)),
    );

    return {
      ...sync,
      applied: finalApplied,
      rebuilt,
      reconciled,
      skipped,
      pruned,
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
    const stillActive = await findFlutterRoute(driver, entry.endpoint, entry.method);
    if (stillActive) {
      throw new Error(
        `Flutter mock route is still active after stop: ${entry.method.toUpperCase()} ${entry.endpoint}`,
      );
    }
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
  return normalizeRouteResult(await driver.mock.routeFlutter(endpoint, response));
}

function appliedKey(method: string, endpoint: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

function routeMethod(route: { id?: string; method?: string }): string | undefined {
  return (parseRouteId(route.id)?.method ?? route.method)?.toUpperCase();
}

function isSuppressedFlutterRoute(
  route: { id?: string; method?: string; path: string },
  suppressedKeys: Set<string>,
): boolean {
  if (suppressedKeys.size === 0) return false;
  const method = routeMethod(route);
  if (method) return suppressedKeys.has(appliedKey(method, route.path));
  for (const key of suppressedKeys) {
    if (key.endsWith(` ${route.path}`)) return true;
  }
  return false;
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
  const routeRegistered = isCompletedRouteResult(routeResult);
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

function isCompletedRouteResult(value: unknown): boolean {
  // routeFlutter is strict and throws for extension errors; route lists can lag behind a completed addRoute call.
  const payload = unwrapExtensionPayload<Record<string, unknown>>(value);
  if (payload == null) return true;
  if (typeof payload !== 'object') return false;
  if (Object.keys(payload).length === 0) return true;
  if (typeof payload.error === 'string') return false;
  if (payload.success === false) return false;
  if (payload.success === true) return true;
  if (typeof payload.id === 'string' && payload.id.length > 0) return true;
  if (payload.type === 'Success') return true;
  return true;
}

function normalizeRouteResult(value: unknown): unknown {
  const payload = unwrapExtensionPayload<Record<string, unknown>>(value);
  if (payload == null) return { success: true };
  if (typeof payload === 'object' && Object.keys(payload).length === 0) {
    return { success: true };
  }
  return payload;
}

function unwrapExtensionPayload<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'result' in value) {
    const result = (value as { result?: unknown }).result;
    if (typeof result === 'string') {
      try {
        return unwrapExtensionPayload<T>(JSON.parse(result));
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
        return unwrapExtensionPayload<T>(JSON.parse(response));
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
