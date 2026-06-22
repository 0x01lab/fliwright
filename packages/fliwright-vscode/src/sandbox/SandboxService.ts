import { mockRuleController, type FliwrightDriver } from '@fliwright/core';
import type {
  AppliedMockRule,
  MockDiscoveryResult,
  MockEndpointEntry,
  MockRule,
  MockRuleEntry,
} from '../types.js';

export class SandboxService {
  async applyRule(driver: FliwrightDriver, entry: MockRuleEntry): Promise<AppliedMockRule> {
    const routeResult = await routeRule(driver, entry.endpoint, entry.method, entry.rule);
    await assertFlutterMockReady(driver, entry.endpoint, entry.method, routeResult);
    return {
      endpoint: entry.endpoint,
      method: entry.method,
      ruleName: entry.rule.name,
      filePath: entry.uri.fsPath,
      appliedAt: Date.now(),
    };
  }

  /**
   * Read the current active mock rules straight from the Flutter store.
   * Unified/reactive: VSCode reflects store truth rather than tracking a
   * local "applied" set. Foreign routes (no fliwright-vscode: id) are surfaced
   * with ruleName '(external)' so the tree still shows their endpoint as active.
   */
  async getActiveRules(driver: FliwrightDriver): Promise<AppliedMockRule[]> {
    const routes = await mockRuleController.listFlutterRoutes(driver.mock);
    const active: AppliedMockRule[] = [];
    for (const route of routes) {
      const parsed = parseRouteId(route.id);
      const method = (parsed?.method ?? route.method)?.toUpperCase();
      if (!method) continue;
      active.push({
        endpoint: parsed?.endpoint ?? route.path,
        method: method as AppliedMockRule['method'],
        ruleName: parsed?.ruleName ?? '(external)',
        filePath: '',
        appliedAt: 0,
      });
    }
    return active;
  }

  async stopRule(driver: FliwrightDriver, entry: MockRuleEntry): Promise<boolean> {
    const flutterRoute = await findFlutterRoute(driver, entry.endpoint, entry.method);
    if (flutterRoute) {
      const parsed = parseRouteId(flutterRoute.id);
      if (parsed && parsed.ruleName !== entry.rule.name) return false;
    } else {
      return false;
    }
    await mockRuleController.removeFlutterRule(driver.mock, entry.endpoint, entry.method);
    const stillActive = await findFlutterRoute(driver, entry.endpoint, entry.method);
    if (stillActive) {
      throw new Error(
        `Flutter mock route is still active after stop: ${entry.method.toUpperCase()} ${entry.endpoint}`,
      );
    }
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
      applied.push({
        endpoint: entry.endpoint,
        method: entry.method,
        ruleName: entry.rule.name,
        filePath: entry.uri.fsPath,
        appliedAt: Date.now(),
      });
    }

    return { applied, skipped };
  }

  /**
   * Clear all Flutter mock routes for this driver. Returns the number of
   * routes that were in the Flutter store BEFORE clearing — used by the
   * stopSandbox command's log lines (tracked=N). Reading the count via
   * listFlutterRoutes first preserves the log contract while keeping the
   * reactive/store-truth model (no local "applied" set is tracked).
   */
  async clear(driver: FliwrightDriver): Promise<number> {
    const routes = await mockRuleController.listFlutterRoutes(driver.mock);
    const count = routes.length;
    await clearFlutterMockRoutes(driver);
    return count;
  }
}

export async function clearFlutterMockRoutes(driver: FliwrightDriver): Promise<void> {
  await mockRuleController.clearFlutterRules(
    driver.mock,
    typeof driver.sendRequest === 'function' ? driver.sendRequest.bind(driver) : undefined,
  );
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
  return normalizeRouteResult(await mockRuleController.applyFlutterRule(driver.mock, endpoint, method, rule));
}

function appliedKey(method: string, endpoint: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

function parseRouteId(id: string | undefined): { method: string; endpoint: string; ruleName: string } | undefined {
  return mockRuleController.parseRouteId(id);
}

async function findFlutterRoute(
  driver: FliwrightDriver,
  endpoint: string,
  method: string,
): Promise<{ id?: string; method?: string; path: string } | undefined> {
  try {
    const routes = await mockRuleController.listFlutterRoutes(driver.mock);
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
