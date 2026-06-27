import { describe, expect, it, vi } from 'vitest';
import { tddCycleCommand, tddStatusCommand, tddSyncCommand } from '../src/commands/tdd.js';
import type { RuntimeSnapshot, TddCycleResult } from '@fliwright/tdd';

function snapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    connected: true,
    daemonStatus: 'running',
    supportsRestart: false,
    launchMode: 'attach',
    restartCapable: false,
    driverConnections: 1,
    fixtureDriverSharing: 'vm-service-url',
    baselineVersion: 0,
    ...overrides,
  };
}

describe('tddCycleCommand', () => {
  it('requires either vmUrl or deviceId', async () => {
    await expect(tddCycleCommand({
      configRoot: '/tmp/vitest.config.ts',
      file: '/tmp/sample.test.ts',
      print: false,
    })).rejects.toThrow(/vm-url or --device-id/i);
  });

  it('starts, focuses, cycles, and stops a temporary runtime', async () => {
    const start = vi.fn(async () => snapshot());
    const focus = vi.fn(async () => {});
    const result: TddCycleResult = {
      status: 'green',
      file: '/tmp/sample.test.ts',
      testName: 'passes',
      durationMs: 12,
      lastSync: 'reload',
      baselineVersion: 1,
    };
    const cycle = vi.fn(async () => result);
    const stop = vi.fn(async () => {});
    const runtime = {
      start,
      focus,
      cycle,
      stop,
      snapshot: vi.fn(() => snapshot({ connected: false, daemonStatus: 'stopped', driverConnections: 1, baselineVersion: 1 })),
    } as any;

    const output = await tddCycleCommand({
      configRoot: '/repo/vitest.config.ts',
      vmUrl: 'ws://vm/ws',
      file: '/tmp/sample.test.ts',
      testName: 'passes',
      sync: 'reload',
      changes: ['lib/page.dart'],
      homeRoute: '/dashboard',
      resetCategories: ['navigation', 'riverpod', 'mock', 'storage', 'authTokens'],
      riverpodOverrideJson: [
        '{"provider":"cartProvider","value":[]}',
        '{"key":"authStateProvider","value":{"signedIn":false}}',
      ],
      mockProfile: 'empty',
      mockDir: '/repo/.fliwright/mocks',
      storageSeedJson: '{"draftOrderId":"order-1"}',
      print: false,
    }, {
      createRuntime: () => runtime,
    });

    expect(output.result).toBe(result);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      configRoot: '/repo/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
      launchMode: 'attach',
      scenario: {
        homeRoute: '/dashboard',
        resetCategories: ['navigation', 'riverpod', 'mock', 'storage', 'authTokens'],
        riverpodOverrides: [
          { provider: 'cartProvider', value: [] },
          { key: 'authStateProvider', value: { signedIn: false } },
        ],
        mockProfile: 'empty',
        mockDir: '/repo/.fliwright/mocks',
        storageSeed: { draftOrderId: 'order-1' },
      },
    }));
    expect(focus).toHaveBeenCalledWith('/tmp/sample.test.ts', 'passes');
    expect(cycle).toHaveBeenCalledWith('passes', expect.objectContaining({
      sync: 'reload',
      changes: ['lib/page.dart'],
      autoEscalate: true,
    }));
    expect(stop).toHaveBeenCalledWith({ keepAppAlive: true });
  });

  it('stops the temporary runtime when a cycle fails', async () => {
    const stop = vi.fn(async () => {});
    const runtime = {
      start: vi.fn(async () => snapshot()),
      focus: vi.fn(async () => {}),
      cycle: vi.fn(async () => {
        throw new Error('rerun failed');
      }),
      stop,
      snapshot: vi.fn(() => snapshot({ connected: false, daemonStatus: 'stopped' })),
    } as any;

    await expect(tddCycleCommand({
      configRoot: '/repo/vitest.config.ts',
      vmUrl: 'ws://vm/ws',
      file: '/tmp/sample.test.ts',
      print: false,
    }, {
      createRuntime: () => runtime,
    })).rejects.toThrow('rerun failed');

    expect(stop).toHaveBeenCalledWith({ keepAppAlive: true });
  });

  it('rejects non-object storage seed JSON before starting the runtime', async () => {
    const start = vi.fn(async () => snapshot());

    await expect(tddCycleCommand({
      configRoot: '/repo/vitest.config.ts',
      vmUrl: 'ws://vm/ws',
      file: '/tmp/sample.test.ts',
      storageSeedJson: '[]',
      print: false,
    }, {
      createRuntime: () => ({ start }) as any,
    })).rejects.toThrow(/storage-seed-json must be a JSON object/i);

    expect(start).not.toHaveBeenCalled();
  });

  it('rejects invalid riverpod override JSON before starting the runtime', async () => {
    const start = vi.fn(async () => snapshot());

    await expect(tddCycleCommand({
      configRoot: '/repo/vitest.config.ts',
      vmUrl: 'ws://vm/ws',
      file: '/tmp/sample.test.ts',
      riverpodOverrideJson: ['{"provider":"cartProvider"}'],
      print: false,
    }, {
      createRuntime: () => ({ start }) as any,
    })).rejects.toThrow(/riverpod-override-json.*provider \| key, value/i);

    expect(start).not.toHaveBeenCalled();
  });
});

describe('tddStatusCommand', () => {
  it('returns null when the status file is missing', async () => {
    const log = vi.fn();
    const status = await tddStatusCommand({
      configRoot: '/repo/vitest.config.ts',
      print: true,
    }, {
      readFile: vi.fn(async () => {
        throw new Error('missing');
      }) as any,
      log,
    });

    expect(status).toBeNull();
    expect(log.mock.calls[0][0]).toContain('No TDD runtime status found');
  });

  it('reads a RuntimeSnapshot from the status file', async () => {
    const expected = snapshot({
      focusedTest: { file: '/tmp/sample.test.ts', testName: 'passes' },
      lastResult: {
        status: 'green',
        file: '/tmp/sample.test.ts',
        testName: 'passes',
        durationMs: 9,
        lastSync: 'none',
        baselineVersion: 2,
      },
      baselineVersion: 2,
    });
    const log = vi.fn();

    const status = await tddStatusCommand({
      configRoot: '/repo/vitest.config.ts',
      statusFile: '/repo/.fliwright/tdd-status.json',
    }, {
      readFile: vi.fn(async () => JSON.stringify(expected)) as any,
      log,
    });

    expect(status).toEqual(expected);
    expect(log.mock.calls[0][0]).toContain('TDD runtime: connected');
    expect(log.mock.calls[0][0]).toContain('focused: passes /tmp/sample.test.ts');
  });
});

describe('tddSyncCommand', () => {
  it('requires either vmUrl or deviceId', async () => {
    await expect(tddSyncCommand({
      configRoot: '/tmp/vitest.config.ts',
      sync: 'reload',
      print: false,
    })).rejects.toThrow(/vm-url or --device-id/i);
  });

  it('starts, syncs, and stops a temporary runtime', async () => {
    const startSnapshot = snapshot({ launchMode: 'start', restartCapable: true, supportsRestart: true });
    const syncedSnapshot = snapshot({ launchMode: 'start', restartCapable: true, supportsRestart: true, baselineVersion: 1 });
    const start = vi.fn(async () => startSnapshot);
    const syncApp = vi.fn(async () => ({ lastSync: 'restart' as const, snapshot: syncedSnapshot }));
    const stop = vi.fn(async () => {});
    const runtime = {
      start,
      syncApp,
      stop,
      snapshot: vi.fn(() => snapshot({ connected: false, daemonStatus: 'stopped', driverConnections: 1, baselineVersion: 1 })),
    } as any;

    const output = await tddSyncCommand({
      configRoot: '/repo/vitest.config.ts',
      deviceId: 'device-1',
      projectId: '/repo/app',
      target: 'lib/main_dev.dart',
      flutterArgs: ['--dart-define=FLAVOR=dev'],
      mode: 'run',
      sync: 'restart',
      keepAppAlive: true,
      print: false,
    }, {
      createRuntime: () => runtime,
    });

    expect(output.lastSync).toBe('restart');
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      configRoot: '/repo/vitest.config.ts',
      app: {
        deviceId: 'device-1',
        projectId: '/repo/app',
        target: 'lib/main_dev.dart',
        flutterArgs: ['--dart-define=FLAVOR=dev'],
        mode: 'run',
      },
      launchMode: 'start',
    }));
    expect(syncApp).toHaveBeenCalledWith('restart');
    expect(stop).toHaveBeenCalledWith({ keepAppAlive: true });
  });

  it('stops the temporary runtime when sync fails', async () => {
    const stop = vi.fn(async () => {});
    const runtime = {
      start: vi.fn(async () => snapshot()),
      syncApp: vi.fn(async () => {
        throw new Error('reload failed');
      }),
      stop,
      snapshot: vi.fn(() => snapshot({ connected: false, daemonStatus: 'stopped' })),
    } as any;

    await expect(tddSyncCommand({
      configRoot: '/repo/vitest.config.ts',
      vmUrl: 'ws://vm/ws',
      sync: 'reload',
      print: false,
    }, {
      createRuntime: () => runtime,
    })).rejects.toThrow('reload failed');

    expect(stop).toHaveBeenCalledWith({ keepAppAlive: true });
  });
});
