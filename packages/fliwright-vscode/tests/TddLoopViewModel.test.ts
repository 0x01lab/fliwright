import { describe, expect, it } from 'vitest';
import { toTddLoopViewModel } from '../src/tddloop/TddLoopViewModel.js';
import type { TddLoopSnapshot } from '../src/tddloop/TddLoopViewModel.js';

describe('toTddLoopViewModel', () => {
  it('returns an idle placeholder when no snapshot is available', () => {
    const model = toTddLoopViewModel(undefined);
    expect(model.phase).toBe('idle');
    expect(model.phaseLabel).toBe('Idle');
    expect(model.connected).toBe(false);
    expect(model.baselineVersion).toBe(0);
    expect(model.focusedTestLabel).toBeUndefined();
  });

  it('treats null the same as undefined', () => {
    expect(toTddLoopViewModel(null)).toMatchObject({ phase: 'idle' });
  });

  it('maps a green snapshot with a focused test', () => {
    const snapshot: TddLoopSnapshot = {
      connected: true,
      daemonStatus: 'running',
      appId: 'com.example.app',
      supportsRestart: true,
      launchMode: 'start',
      restartCapable: true,
      driverConnections: 1,
      fixtureDriverSharing: 'vm-service-url',
      focusedTest: { file: 'src/login.test.ts', testName: 'logs in' },
      lastResult: {
        status: 'green',
        file: 'src/login.test.ts',
        durationMs: 412,
        lastSync: 'reload',
        baselineVersion: 3,
      },
      baselineVersion: 3,
      updatedAtMs: 1_700_000_000_000,
    };
    const model = toTddLoopViewModel(snapshot);
    expect(model).toMatchObject({
      phase: 'green',
      phaseLabel: 'GREEN',
      connected: true,
      daemonStatus: 'running',
      appId: 'com.example.app',
      launchMode: 'start',
      restartCapable: true,
      driverConnections: 1,
      fixtureDriverSharing: 'vm-service-url',
      focusedTestLabel: 'logs in (src/login.test.ts)',
      focusedTestFile: 'src/login.test.ts',
      focusedTestName: 'logs in',
      lastResultStatus: 'green',
      lastResultDurationMs: 412,
      lastResultSync: 'reload',
      baselineVersion: 3,
      updatedAtMs: 1_700_000_000_000,
    });
  });

  it('maps a red snapshot with a failure message', () => {
    const snapshot: TddLoopSnapshot = {
      connected: true,
      daemonStatus: 'running',
      supportsRestart: true,
      launchMode: 'start',
      restartCapable: true,
      driverConnections: 1,
      fixtureDriverSharing: 'vm-service-url',
      lastResult: {
        status: 'red',
        file: 'src/cart.test.ts',
        durationMs: 100,
        lastSync: 'restart',
        baselineVersion: 1,
        failure: { message: 'expected 1 to be 2' },
      },
      baselineVersion: 1,
      unsupportedState: ['webview', 'localDb'],
      notes: ['fixture uses its own WS (2.1.9)'],
    };
    const model = toTddLoopViewModel(snapshot);
    expect(model.phase).toBe('red');
    expect(model.phaseLabel).toBe('RED');
    expect(model.lastResultStatus).toBe('red');
    expect(model.lastResultFailureMessage).toBe('expected 1 to be 2');
    expect(model.unsupportedState).toEqual(['webview', 'localDb']);
    expect(model.notes).toEqual(['fixture uses its own WS (2.1.9)']);
    expect(model.focusedTestLabel).toBeUndefined();
  });

  it('is idle when lastResult is absent even if connected', () => {
    const model = toTddLoopViewModel({
      connected: true,
      daemonStatus: 'running',
      supportsRestart: true,
      launchMode: 'start',
      restartCapable: true,
      driverConnections: 0,
      fixtureDriverSharing: 'vm-service-url',
      baselineVersion: 0,
    });
    expect(model.phase).toBe('idle');
  });

  it('falls back to attach launchMode label note for degraded attach', () => {
    const model = toTddLoopViewModel({
      connected: false,
      daemonStatus: 'stopped',
      supportsRestart: false,
      launchMode: 'attach',
      restartCapable: false,
      driverConnections: 0,
      fixtureDriverSharing: 'vm-service-url',
      baselineVersion: 0,
    });
    expect(model.launchMode).toBe('attach');
    expect(model.restartCapable).toBe(false);
  });

  it('labels a focused test with only a file', () => {
    const model = toTddLoopViewModel({
      connected: true,
      daemonStatus: 'running',
      supportsRestart: true,
      launchMode: 'start',
      restartCapable: true,
      driverConnections: 1,
      fixtureDriverSharing: 'vm-service-url',
      focusedTest: { file: 'src/no_name.test.ts' },
      baselineVersion: 0,
    });
    expect(model.focusedTestLabel).toBe('src/no_name.test.ts');
    expect(model.focusedTestName).toBeUndefined();
  });
});
