import type { MockRouteResponse, MockRule, SendRequest } from '../types.js';

export interface ParsedMockRuleRouteId {
  method: string;
  endpoint: string;
  ruleName: string;
}

export interface MockRuleRouteResponse extends MockRouteResponse {
  id: string;
  method: string;
}

export interface FlutterMockRouteSummary {
  id?: string;
  method?: string;
  path: string;
}

export interface FlutterMockRouteTarget {
  routeFlutter?: (path: string, response: MockRouteResponse & { method?: string; id?: string }) => Promise<unknown>;
  removeFlutterRoute?: (path: string, method?: string) => Promise<void>;
  clearFlutterRoutes?: () => Promise<void>;
  clear?: () => Promise<void>;
  listFlutterRoutes?: () => Promise<FlutterMockRouteSummary[]>;
}

export class MockRuleController {
  static readonly instance = new MockRuleController();

  private constructor() {}

  createRouteId(endpoint: string, method: string, ruleName: string): string {
    return `fliwright-vscode:${encodeURIComponent(method.toUpperCase())}:${encodeURIComponent(endpoint)}:${encodeURIComponent(ruleName)}`;
  }

  parseRouteId(id: string | undefined): ParsedMockRuleRouteId | undefined {
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

  routeResponse(endpoint: string, method: string, rule: MockRule): MockRuleRouteResponse {
    return {
      id: this.createRouteId(endpoint, method, rule.name),
      method,
      status: rule.status,
      delay: rule.delay,
      headers: rule.headers,
      body: rule.body,
    };
  }

  async applyFlutterRule(
    target: FlutterMockRouteTarget,
    endpoint: string,
    method: string,
    rule: MockRule,
  ): Promise<unknown> {
    if (typeof target.routeFlutter !== 'function') {
      throw new Error('Connected Fliwright driver does not support applying Flutter mock rules. Update @fliwright/core.');
    }
    return target.routeFlutter(endpoint, this.routeResponse(endpoint, method, rule));
  }

  async removeFlutterRule(
    target: FlutterMockRouteTarget,
    endpoint: string,
    method?: string,
  ): Promise<void> {
    if (typeof target.removeFlutterRoute !== 'function') {
      throw new Error('Connected Fliwright driver does not support removing Flutter mock rules. Update @fliwright/core.');
    }
    await target.removeFlutterRoute(endpoint, method);
  }

  async clearFlutterRules(
    target: FlutterMockRouteTarget,
    fallbackSendRequest?: SendRequest,
  ): Promise<void> {
    if (typeof target.clearFlutterRoutes === 'function') {
      await target.clearFlutterRoutes();
      return;
    }

    if (fallbackSendRequest) {
      await fallbackSendRequest('ext.fliwright.mock.clearRoutes');
      return;
    }

    if (typeof target.clear === 'function') {
      await target.clear();
      return;
    }

    throw new Error('Connected Fliwright driver does not support clearing Flutter mock routes. Update @fliwright/core.');
  }

  async listFlutterRoutes(target: FlutterMockRouteTarget): Promise<FlutterMockRouteSummary[]> {
    if (typeof target.listFlutterRoutes !== 'function') {
      throw new Error('Connected Fliwright driver does not support listing Flutter mock routes. Update @fliwright/core.');
    }
    return target.listFlutterRoutes();
  }
}

export const mockRuleController = MockRuleController.instance;

export function mockRuleRouteId(endpoint: string, method: string, ruleName: string): string {
  return mockRuleController.createRouteId(endpoint, method, ruleName);
}
