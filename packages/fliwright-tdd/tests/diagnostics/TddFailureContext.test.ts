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
  });
});
