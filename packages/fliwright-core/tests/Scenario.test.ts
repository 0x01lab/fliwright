import { describe, expect, it, vi } from 'vitest';
import {
  ScenarioCoordinator,
  ScenarioResolutionError,
  ScenarioResolver,
  type TestScenario,
} from '../src/Scenario.js';

const scenarios: Record<string, TestScenario> = {
  base: {
    name: 'base',
    layers: [
      { kind: 'mocks', profile: 'happy', denyUnmatchedRequests: true },
      { kind: 'storage', seed: { onboardingSeen: true } },
    ],
  },
  member: {
    name: 'member',
    extends: ['base'],
    startupIsolation: 'required',
    layers: [
      { kind: 'auth', state: 'authenticated', preset: 'standard-user' },
      { kind: 'state', adapter: 'riverpod', key: 'cartProvider', value: { items: [] } },
      { kind: 'navigation', route: '/home' },
    ],
    ready: [
      { kind: 'auth', state: 'authenticated' },
      { kind: 'route', equals: '/home' },
    ],
  },
};

describe('ScenarioResolver', () => {
  it('resolves inherited layers in deterministic order', () => {
    const resolved = new ScenarioResolver(scenarios).resolve('member');

    expect(resolved.name).toBe('member');
    expect(resolved.layers.map((layer) => layer.kind)).toEqual([
      'mocks', 'storage', 'auth', 'state', 'navigation',
    ]);
  });

  it('rejects duplicate singleton resources from composed scenarios', () => {
    const resolver = new ScenarioResolver({
      first: { name: 'first', layers: [{ kind: 'auth', state: 'guest' }] },
      second: {
        name: 'second',
        extends: ['first'],
        layers: [{ kind: 'auth', state: 'authenticated' }],
      },
    });

    expect(() => resolver.resolve('second')).toThrow(ScenarioResolutionError);
  });

  it('rejects circular inheritance', () => {
    const resolver = new ScenarioResolver({
      first: { name: 'first', extends: ['second'], layers: [] },
      second: { name: 'second', extends: ['first'], layers: [] },
    });

    expect(() => resolver.resolve('first')).toThrow(/cycle/i);
  });

  it('inherits required startup isolation and readiness checks', () => {
    const resolver = new ScenarioResolver({
      isolated: {
        name: 'isolated',
        startupIsolation: 'required',
        layers: [],
        ready: [{ kind: 'auth', state: 'guest' }],
      },
      member: { name: 'member', extends: ['isolated'], layers: [] },
    });

    expect(resolver.resolve('member')).toMatchObject({
      startupIsolation: 'required',
      ready: [{ kind: 'auth', state: 'guest' }],
    });
  });
});

describe('ScenarioCoordinator', () => {
  it('applies mocks, storage, auth, state, navigation, and readiness in order', async () => {
    const calls: string[] = [];
    const state = { override: vi.fn(async () => { calls.push('state'); }) };
    const driver = {
      mock: {
        clearFlutterRoutes: vi.fn(async () => { calls.push('mock.clear'); }),
        clearCalls: vi.fn(async () => { calls.push('mock.calls'); }),
        setPassthrough: vi.fn(async (enabled: boolean) => { calls.push(`mock.passthrough:${enabled}`); }),
        loadRules: vi.fn(async () => { calls.push('mock.load'); }),
        listRules: vi.fn(() => [{ endpoint: '/api/orders', method: 'GET', rules: ['happy'], activeRule: 'happy' }]),
        switchRule: vi.fn(async () => { calls.push('mock.switch'); }),
      },
      storage: { reset: vi.fn(async () => { calls.push('storage'); return { status: 'ok' as const }; }) },
      app: {
        invoke: vi.fn(async (_capability: string, method: string) => {
          calls.push(`app.${method}`);
          return method === 'getStatus' ? { isAuthenticated: true } : { isAuthenticated: true };
        }),
      },
      getStateAdapter: vi.fn(() => state),
      page: {
        resetToHome: vi.fn(async () => { calls.push('navigation'); }),
        currentRoute: vi.fn(async () => '/home'),
      },
      sendRequest: vi.fn(async (method: string) => {
        calls.push(method);
        return method.endsWith('.status') ? { waiting: true } : { released: true };
      }),
    };

    const report = await new ScenarioCoordinator(driver).apply(
      new ScenarioResolver(scenarios).resolve('member'),
      { mode: 'managed-start' },
    );

    expect(report.ready).toBe(true);
    expect(calls).toEqual([
      'ext.fliwright.testBootstrap.status',
      'mock.clear', 'mock.calls', 'mock.passthrough:false', 'mock.load', 'mock.switch',
      'storage', 'app.seedLoggedIn', 'app.getStatus', 'state', 'navigation',
      'app.getStatus',
      'ext.fliwright.testBootstrap.release',
    ]);
  });

  it('rejects attach mode for a scenario requiring startup isolation', async () => {
    const coordinator = new ScenarioCoordinator({} as never);

    await expect(coordinator.apply(new ScenarioResolver(scenarios).resolve('member'), {
      mode: 'attach',
    })).rejects.toThrow(/startup isolation/i);
  });

  it('fails setup when the auth capability does not produce the requested state', async () => {
    const driver = {
      mock: {},
      app: {
        invoke: vi.fn(async (_capability: string, method: string) => (
          method === 'getStatus' ? { isAuthenticated: false } : undefined
        )),
      },
      page: { resetToHome: vi.fn(async () => {}), currentRoute: vi.fn(async () => '/home') },
      sendRequest: vi.fn(async () => ({ waiting: true })),
    };

    await expect(new ScenarioCoordinator(driver).apply({
      name: 'member',
      layers: [{ kind: 'auth', state: 'authenticated' }],
      ready: [{ kind: 'auth', state: 'authenticated' }],
    }, { mode: 'managed-start' })).rejects.toThrow(/authentication/i);
  });
});
