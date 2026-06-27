import { describe, expect, it } from 'vitest';
import { buildTddFailureContext, classifyFailure } from '../../src/index.js';

describe('TDD failure context diagnostics', () => {
  it('classifies common failure messages', () => {
    expect(classifyFailure('No widget found matching selector')).toBe('missing-element');
    expect(classifyFailure('strict mode violation: multiple widgets matched')).toBe('ambiguous-element');
    expect(classifyFailure('expected Dashboard received Login')).toBe('wrong-text');
    expect(classifyFailure('Timed out waiting for POST /auth/login; Recorded calls: (none)')).toBe('mock-not-called');
    expect(classifyFailure('currentRoute expected /home')).toBe('navigation-failed');
    expect(classifyFailure('currentRoute expected /home received /settings')).toBe('navigation-failed');
  });

  it('builds structured failure evidence for missing elements', () => {
    const context = buildTddFailureContext({
      file: '/tmp/login.test.ts',
      testName: 'login flow',
      message: 'No widget found matching selector',
      lastSync: 'reload',
      baselineVersion: 2,
    });

    expect(context).toMatchObject({
      kind: 'missing-element',
      testFile: '/tmp/login.test.ts',
      testName: 'login flow',
      lastSync: 'reload',
      baselineVersion: 2,
    });
    expect(context.source).toBeUndefined();
    expect(context.assertion).toBeUndefined();
    expect(context.artifacts).toBeUndefined();
    expect(context.recoveryHints?.map((hint) => hint.kind)).toEqual(
      expect.arrayContaining(['refine-selector', 'sync-app']),
    );
    expect(context.recoveryHints?.find((hint) => hint.kind === 'refine-selector')).toMatchObject({
      priority: 'high',
    });
  });

  it('adds agent-actionable hints for unsupported reset state and artifacts', () => {
    const context = buildTddFailureContext({
      file: '/tmp/checkout.test.ts',
      testName: 'checkout flow',
      message: 'Timed out waiting for POST /orders; Recorded calls: (none)',
      unsupportedState: ['storage', 'permissions'],
      source: {
        file: '/tmp/checkout.test.ts',
        line: 42,
        snippet: 'await mock.waitForCall("/orders")',
      },
      artifacts: {
        screenshotPath: '/tmp/failure.png',
        timelinePath: '/tmp/timeline.json',
      },
    });

    expect(context.kind).toBe('mock-not-called');
    expect(context.recoveryHints?.map((hint) => hint.kind)).toEqual(expect.arrayContaining([
      'configure-reset-adapter',
      'inspect-source',
      'inspect-snapshot',
      'configure-mock',
    ]));
    expect(context.recoveryHints?.[0]).toMatchObject({
      kind: 'configure-reset-adapter',
      priority: 'high',
    });
  });

  it('suggests reconnect for disconnected failures and no stale sync after restart', () => {
    const disconnected = buildTddFailureContext({
      file: '/tmp/app.test.ts',
      message: 'VM service closed',
      kind: 'disconnected',
    });
    expect(disconnected.recoveryHints?.map((hint) => hint.kind)).toContain('reconnect');

    const restartedMissing = buildTddFailureContext({
      file: '/tmp/app.test.ts',
      message: 'No widget found',
      lastSync: 'restart',
    });
    expect(restartedMissing.recoveryHints?.map((hint) => hint.kind)).toContain('refine-selector');
    expect(restartedMissing.recoveryHints?.map((hint) => hint.kind)).not.toContain('sync-app');
  });
});
