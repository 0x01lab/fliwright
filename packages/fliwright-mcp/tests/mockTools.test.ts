import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleMockStatus, handleMockSwitch } from '../src/tools/mockTools.js';

describe('mock MCP handlers', () => {
  it('switches the active rule and applies it to the connected driver mock manager', async () => {
    const state = createServerState();
    const loadRules = vi.fn(async () => {});
    const switchRule = vi.fn(async () => {});
    const listRules = vi.fn(() => [
      {
        endpoint: '/api/user',
        method: 'GET',
        rules: ['success', 'empty'],
        activeRule: 'empty',
      },
    ]);
    state.getRuleStore().loadFromDirectory = vi.fn(async () => {
      state.getRuleStore().switchRule = vi.fn();
      state.getRuleStore().listEndpoints = vi.fn(() => [
        {
          endpoint: '/api/user',
          method: 'GET',
          rules: ['success', 'empty'],
          activeRule: 'empty',
        },
      ]);
    });
    state.setDriver({
      mock: { loadRules, switchRule, listRules },
      page: {},
    } as unknown as FliwrightDriver);

    const result = await handleMockSwitch({
      mockDir: '/repo/.fliwright/mocks',
      endpoint: '/api/user',
      method: 'GET',
      ruleName: 'empty',
    }, state);

    expect(loadRules).toHaveBeenCalledWith('/repo/.fliwright/mocks');
    expect(switchRule).toHaveBeenCalledWith('/api/user', 'empty', 'GET');
    expect(result.appliedToDriver).toBe(true);
    expect(result.active).toMatchObject({
      endpoint: '/api/user',
      method: 'GET',
      activeRule: 'empty',
    });
  });

  it('returns loaded rules, active routes, and recent calls for agent debugging', async () => {
    const state = createServerState();
    state.getRuleStore().listEndpoints = vi.fn(() => [
      {
        endpoint: '/api/user',
        method: 'GET',
        rules: ['success', 'empty'],
        activeRule: 'success',
      },
    ]);
    state.setDriver({
      mock: {
        listRules: vi.fn(() => [
          {
            endpoint: '/api/user',
            method: 'GET',
            rules: ['success', 'empty'],
            activeRule: 'success',
          },
        ]),
        listRoutes: vi.fn(async () => [
          { id: 'fliwright-mock:GET:/api/user:success', method: 'GET', path: '/api/user' },
        ]),
        getCalls: vi.fn(async () => [
          {
            method: 'GET',
            path: '/api/user',
            headers: {},
            timestamp: '2026-07-08T00:00:00.000Z',
            backend: 'flutter',
          },
        ]),
      },
      page: {},
    } as unknown as FliwrightDriver);

    const result = await handleMockStatus({ recentCallsLimit: 5 }, state);

    expect(result.connected).toBe(true);
    expect(result.rules).toHaveLength(1);
    expect(result.routes).toEqual([
      { id: 'fliwright-mock:GET:/api/user:success', method: 'GET', path: '/api/user' },
    ]);
    expect(result.recentCalls).toHaveLength(1);
  });
});
