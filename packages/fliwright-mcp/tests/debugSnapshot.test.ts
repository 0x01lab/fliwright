import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleDebugSnapshot } from '../src/tools/debugSnapshot.js';

describe('handleDebugSnapshot', () => {
  it('throws a URL discovery error when no driver or VM URL is available', async () => {
    await expect(handleDebugSnapshot({}, createServerState(), { env: {} })).rejects.toThrow('No Flutter VM Service URL found');
  });

  it('aggregates app context for coding agents', async () => {
    const state = createServerState();
    state.setLastFailures([
      {
        testName: 'loads user',
        assertion: { matcher: 'toBeVisible', expected: 'User', actual: 'not found', timeout: 5000 },
        widgetTree: {},
        source: { file: 'tests/user.test.ts', line: 12, snippet: 'expect user' },
        timestamp: '2026-07-08T00:00:00.000Z',
      },
    ]);
    state.setDriver({
      page: {
        context: vi.fn(async () => ({ route: { location: '/users/1', name: 'user' } })),
        snapshot: vi.fn(async () => ({
          snapshot: '- heading "User" [ref=e1]\n',
          groupId: 'snapshot-1',
          refs: [{ ref: 'e1', role: 'heading', label: 'User', type: 'Text' }],
          count: 1,
        })),
        screenshot: vi.fn(async () => Buffer.from('png')),
      },
      getDiagnostics: vi.fn(() => [
        { kind: 'Flutter.Error', timestamp: 1, data: { message: 'boom' } },
      ]),
      mock: {
        listRules: vi.fn(() => []),
        listRoutes: vi.fn(async () => []),
        getCalls: vi.fn(async () => []),
      },
    } as unknown as FliwrightDriver);

    const result = await handleDebugSnapshot({
      includeScreenshot: true,
      includeDiagnostics: true,
      includeMockStatus: true,
      diagnosticLimit: 3,
    }, state);

    expect(result.connected).toBe(true);
    expect(result.route).toEqual({ location: '/users/1', name: 'user' });
    expect(result.snapshot?.count).toBe(1);
    expect(result.screenshot?.base64).toBe(Buffer.from('png').toString('base64'));
    expect(result.diagnostics?.count).toBe(1);
    expect(result.mock?.connected).toBe(true);
    expect(result.lastFailures).toHaveLength(1);
  });

  it('does not include screenshot bytes by default so agent context stays compact', async () => {
    const state = createServerState();
    const screenshot = vi.fn(async () => Buffer.from('png'));
    state.setDriver({
      page: {
        snapshot: vi.fn(async () => ({
          snapshot: '- text "Ready" [ref=e1]\n',
          groupId: 'snapshot-1',
          refs: [{ ref: 'e1', role: 'text', label: 'Ready', type: 'Text' }],
          count: 1,
        })),
        screenshot,
      },
    } as unknown as FliwrightDriver);

    const result = await handleDebugSnapshot({}, state);

    expect(result.screenshot).toBeUndefined();
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('auto-connects before capturing a coding-agent runtime bundle', async () => {
    const state = createServerState();
    const connect = vi.fn(async () => undefined);
    const snapshot = vi.fn(async () => ({
      snapshot: '- text "Ready" [ref=e1]\n',
      groupId: 'snapshot-1',
      refs: [{ ref: 'e1', role: 'text', label: 'Ready', type: 'Text' }],
      count: 1,
    }));

    const result = await handleDebugSnapshot({
      includeDiagnostics: false,
      includeMockStatus: false,
    }, state, {
      env: { FLIWRIGHT_VM_SERVICE_URL: 'http://127.0.0.1:54321/debug/' },
      driverFactory: () => ({
        connect,
        page: { snapshot },
      } as unknown as FliwrightDriver),
    });

    expect(connect).toHaveBeenCalledWith('ws://127.0.0.1:54321/debug/ws');
    expect(result.snapshot?.count).toBe(1);
  });
});
