import type { MockManager } from '../MockManager.js';
import { FliwrightAgentError } from '../agent/FliwrightAgentError.js';
import type { MockRouteResponse } from '../types.js';
import { TimelineRecorder } from '../timeline/TimelineRecorder.js';
import type { AgentVisibleFailure } from '../timeline/types.js';
import type { MockTimelineMetadata, NormalizedRequestMatcher, WaitForMockCallOptions } from './types.js';

export class MockRuntime {
  constructor(
    private readonly manager: MockManager,
    private readonly recorder?: TimelineRecorder,
  ) {}

  async rules<T>(title: string, body: () => T | Promise<T>): Promise<T> {
    return this.run('step', title, { operation: 'loadRules' }, body);
  }

  async loadRules(mockDir?: string): Promise<void> {
    return this.record('loadRules', { mockDir }, () => this.manager.loadRules(mockDir));
  }

  async switchRule(endpoint: string, ruleName: string, method?: string): Promise<void> {
    return this.record('switchRule', { endpoint, ruleName, method }, () => this.manager.switchRule(endpoint, ruleName, method));
  }

  async route(path: string, response: MockRouteResponse & { method?: string; id?: string }): Promise<void> {
    return this.record('route', {
      endpoint: path,
      method: response.method,
      backend: 'tool-server',
    }, () => this.manager.route(path, response));
  }

  async routeFlutter(path: string, response: MockRouteResponse & { method?: string; id?: string }): Promise<unknown> {
    return this.record('routeFlutter', {
      endpoint: path,
      method: response.method,
      backend: 'flutter',
    }, () => this.manager.routeFlutter(path, response));
  }

  async removeRoute(path: string, method?: string): Promise<void> {
    return this.record('removeRoute', { endpoint: path, method }, () => this.manager.removeRoute(path, method));
  }

  async clearRoutes(): Promise<void> {
    // Preserve VSCode-applied routes (fliwright-vscode: id): only clear what a
    // test injected. VSCode "Stop All" uses the full clear via clearFlutterRoutes.
    return this.record('clearRoutes', {}, () => this.manager.clearForeignRoutes());
  }

  async clearCalls(): Promise<void> {
    return this.record('clearCalls', {}, () => this.manager.clearCalls());
  }

  async setPassthrough(enabled: boolean): Promise<void> {
    return this.record('setPassthrough', { }, () => this.manager.setPassthrough(enabled), { enabled });
  }

  async getCalls(path?: string): Promise<ReturnType<MockManager['getCalls']> extends Promise<infer T> ? T : never> {
    return this.record('getCalls', { endpoint: path }, async () => {
      const calls = await this.manager.getCalls(path);
      return calls as ReturnType<MockManager['getCalls']> extends Promise<infer T> ? T : never;
    });
  }

  async listRoutes(): Promise<Awaited<ReturnType<MockManager['listRoutes']>>> {
    return this.record('listRoutes', {}, () => this.manager.listRoutes());
  }

  listRules(): ReturnType<MockManager['listRules']> {
    const node = this.recorder?.startNode('mock', 'List mock rules', {
      metadata: { operation: 'listRules' } satisfies MockTimelineMetadata,
    });
    try {
      const rules = this.manager.listRules();
      if (node) this.recorder?.passNode(node.id, { operation: 'listRules', routeCount: rules.length });
      return rules;
    } catch (error) {
      if (node) this.recorder?.failNode(node.id, createMockFailure(error, 'List mock rules', node.id));
      throw error;
    }
  }

  async findCalls(matcher: NormalizedRequestMatcher): Promise<Awaited<ReturnType<MockManager['getCalls']>>> {
    const calls = await this.getCalls(typeof matcher.path === 'string' ? matcher.path : undefined);
    return calls.filter((call) => matchesCall(call, matcher));
  }

  async waitForCall(
    matcher: NormalizedRequestMatcher | string,
    options: WaitForMockCallOptions = {},
  ): Promise<Awaited<ReturnType<MockManager['getCalls']>>> {
    const normalized = typeof matcher === 'string' ? { path: matcher } : matcher;
    const expectedCount = Math.max(1, options.count ?? 1);
    const timeout = Math.max(0, options.timeout ?? 5_000);
    const interval = Math.max(25, options.interval ?? 100);
    const startedAt = Date.now();
    let matchedCalls: Awaited<ReturnType<MockManager['getCalls']>> = [];
    let lastCalls: Awaited<ReturnType<MockManager['getCalls']>> = [];

    return this.record('waitForCall', {
      endpoint: typeof normalized.path === 'string' ? normalized.path : undefined,
      method: normalized.method,
    }, async () => {
      while (true) {
        lastCalls = await this.manager.getCalls() as typeof lastCalls;
        matchedCalls = lastCalls.filter((call) => matchesCall(call, normalized)) as typeof matchedCalls;
        if (matchedCalls.length >= expectedCount) {
          return matchedCalls;
        }

        if (Date.now() - startedAt >= timeout) {
          throw new Error(
            `Timed out after ${timeout}ms waiting for ${describeMatcher(normalized)} `
            + `to be called at least ${expectedCount} time(s); matched ${matchedCalls.length}. `
            + `Recorded calls: ${summarizeCalls(lastCalls)}.`,
          );
        }
        await delay(interval);
      }
    }, {
      callCount: expectedCount,
      timeout,
      interval,
    });
  }

  private async record<T>(
    operation: MockTimelineMetadata['operation'],
    metadata: Omit<MockTimelineMetadata, 'operation'>,
    body: () => T | Promise<T>,
    extraMetadata?: Record<string, unknown>,
  ): Promise<T> {
    const title = mockTitle(operation, metadata.endpoint);
    return this.run('mock', title, { operation, ...metadata, ...extraMetadata }, body);
  }

  private async run<T>(
    kind: 'mock' | 'step',
    title: string,
    metadata: MockTimelineMetadata & Record<string, unknown>,
    body: () => T | Promise<T>,
  ): Promise<T> {
    const node = this.recorder?.startNode(kind, title, { metadata });
    try {
      const value = await body();
      if (node) this.recorder?.passNode(node.id);
      return value;
    } catch (error) {
      const failure = createMockFailure(error, title, node?.id);
      if (node) this.recorder?.failNode(node.id, failure);
      throw new FliwrightAgentError(failure, { cause: error });
    }
  }
}

export function matchesCall(call: { method?: string; path?: string; url?: string; headers?: Record<string, string>; body?: unknown }, matcher: NormalizedRequestMatcher): boolean {
  if (matcher.method && call.method?.toUpperCase() !== matcher.method.toUpperCase()) return false;
  if (matcher.path && !matchesValue(call.path ?? '', matcher.path)) return false;
  if (matcher.url && !matchesValue(call.url ?? '', matcher.url)) return false;
  if (matcher.headers) {
    for (const [key, expected] of Object.entries(matcher.headers)) {
      const actual = call.headers?.[key] ?? call.headers?.[key.toLowerCase()];
      if (actual == null || !matchesValue(actual, expected)) return false;
    }
  }
  if (matcher.body !== undefined && !bodyMatches(call.body, matcher.body)) return false;
  return true;
}

function bodyMatches(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  const actualValue = typeof actual === 'string' ? parseJsonOrString(actual) : actual;
  return JSON.stringify(actualValue) === JSON.stringify(expected);
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function matchesValue(actual: string, expected: string | RegExp): boolean {
  return expected instanceof RegExp ? expected.test(actual) : actual === expected;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeMatcher(matcher: NormalizedRequestMatcher): string {
  const parts = [
    matcher.method?.toUpperCase(),
    matcher.path instanceof RegExp ? matcher.path.toString() : matcher.path,
    matcher.url instanceof RegExp ? matcher.url.toString() : matcher.url,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'mock request';
}

function summarizeCalls(calls: Array<{ method?: string; path?: string; url?: string; backend?: string }>): string {
  if (calls.length === 0) return '(none)';
  return calls
    .slice(-5)
    .map((call) => `${call.method ?? '?'} ${call.path ?? call.url ?? '?'}${call.backend ? ` [${call.backend}]` : ''}`)
    .join(', ');
}

function mockTitle(operation: MockTimelineMetadata['operation'], endpoint?: string): string {
  const label = operation.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
  return endpoint ? `Mock ${label}: ${endpoint}` : `Mock ${label}`;
}

function createMockFailure(error: unknown, title: string, timelineNodeId?: string): AgentVisibleFailure {
  return {
    code: 'step_failed',
    title,
    message: error instanceof Error ? error.message : String(error),
    timelineNodeId,
    recoveryHints: [
      { kind: 'observe', description: 'Inspect loaded mock routes and recorded calls.' },
      { kind: 'manual', description: 'Verify mock rule files and endpoint matcher configuration.' },
    ],
  };
}
