import { describe, expect, it } from 'vitest';
import type { AgentVisibleFailure } from '@fliwright/core';
import { formatFailurePrompt } from '../../src/webview/viewer/components/ErrorTab.js';

const failure: AgentVisibleFailure = {
  code: 'assertion_failed',
  title: 'dashboard not visible',
  message: 'Expected element to be visible',
  actionContext: { action: 'toBeVisible', target: 'text=Dashboard' },
  appState: { route: '/home', screenshotPath: 'artifacts/screenshots/assertion-1.png' },
  recoveryHints: [
    { kind: 'wait', description: 'wait for navigation' },
    { kind: 'change-selector', description: 'try role=heading' },
  ],
};

describe('formatFailurePrompt', () => {
  it('serializes the failure into a structured markdown prompt', () => {
    const out = formatFailurePrompt(failure, 'sees dashboard');
    expect(out).toContain('# Failure: sees dashboard');
    expect(out).toContain('- code: assertion_failed');
    expect(out).toContain('## Message');
    expect(out).toContain('Expected element to be visible');
    expect(out).toContain('## Action context');
    expect(out).toContain('- action: toBeVisible');
    expect(out).toContain('## App state');
    expect(out).toContain('- route: /home');
    expect(out).toContain('## Recovery hints');
    expect(out).toContain('- [wait] wait for navigation');
  });

  it('omits empty sections', () => {
    const minimal: AgentVisibleFailure = {
      code: 'unknown',
      title: 't',
      message: 'm',
      recoveryHints: [],
    };
    const out = formatFailurePrompt(minimal, 'node');
    expect(out).not.toContain('## Action context');
    expect(out).not.toContain('## App state');
    expect(out).not.toContain('## Recovery hints');
  });
});
