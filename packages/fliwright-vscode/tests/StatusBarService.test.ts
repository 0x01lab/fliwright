import { describe, expect, it } from 'vitest';
import { window } from 'vscode';
import { StatusBarService } from '../src/status/StatusBarService.js';

describe('StatusBarService', () => {
  it('shows the active run state before the previous run result', () => {
    const statusBar = new StatusBarService();
    try {
      statusBar.setRunResult({
        passed: true,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        duration: 10,
        results: [],
      });
      statusBar.setConnectionState({
        status: 'running',
        startedAt: Date.now(),
        label: 'tests/sample.test.ts',
      });

      const item = (window as any)._lastStatusBarItem;
      expect(item.text).toBe('$(loading~spin) Fliwright: Running tests/sample.test.ts');
    } finally {
      statusBar.dispose();
    }
  });
});
