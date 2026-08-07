import { describe, expect, it, vi } from 'vitest';
import { TddRuntime } from '../../src/runtime/TddRuntime.js';

describe('TddRuntime', () => {
  it('returns the focused run timeline for a green cycle', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({
        status: 'green' as const,
        testName: 'opens Markets',
        timelinePath: '/tmp/runs/run-2/timeline.json',
      })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'opens Markets');

    const result = await runtime.cycle();

    expect(result).toMatchObject({
      status: 'green',
      timelinePath: '/tmp/runs/run-2/timeline.json',
    });
  });

  it('runs a navigation-only baseline without mutating mock state and returns timeline artifacts', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({
        status: 'green' as const,
        testName: 'Exio shell navigates to markets and trading tabs',
        timelinePath: '/tmp/runs/exio-navigation/timeline.json',
        timelineNodeId: 'assertion-3',
      })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({
      configRoot: '/tmp/exio/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
      scenario: { homeRoute: '/home', resetCategories: ['navigation'] },
    });
    await runtime.focus('/tmp/exio/.fliwright/tests/exio-navigation.test.ts', 'Exio shell navigates to markets and trading tabs');

    const result = await runtime.cycle(undefined, { sync: 'none', autoEscalate: false });

    expect(driver.page.resetToHome).toHaveBeenCalledWith({ homeRoute: '/home' });
    expect(driver.mock.clear).not.toHaveBeenCalled();
    expect(driver.mock.clearCalls).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'green',
      lastSync: 'none',
      timelinePath: '/tmp/runs/exio-navigation/timeline.json',
      timelineNodeId: 'assertion-3',
    });
  });

  it('marks a single reload-to-restart escalation in the cycle result', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const daemon = {
      start: vi.fn(async () => {}),
      startApp: vi.fn(async () => ({ appId: 'app-1', wsUri: 'ws://vm/ws', supportsRestart: true })),
      reload: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn()
        .mockResolvedValueOnce({ status: 'red', failure: { message: 'No widget found matching selector' } })
        .mockResolvedValueOnce({ status: 'green' }),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });
    await runtime.focus('/tmp/sample.test.ts', 'opens Markets');

    const result = await runtime.cycle(undefined, { sync: 'auto', changes: ['lib/home.dart'] });

    expect(result).toMatchObject({ status: 'green', lastSync: 'restart', syncEscalated: true });
    expect(daemon.reload).toHaveBeenCalledTimes(1);
    expect(daemon.restart).toHaveBeenCalledTimes(1);
  });

  it('starts in attach mode, focuses, resets baseline, and reruns the focused test', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      reloadSources: vi.fn(async () => ({})),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const, testName: 'alpha passes' })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      driverFactory: () => driver,
      executor,
    });

    const snapshot = await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');
    const result = await runtime.cycle();

    expect(snapshot.connected).toBe(true);
    expect(snapshot.launchMode).toBe('attach');
    expect(snapshot.fixtureDriverSharing).toBe('vm-service-url');
    expect(driver.connect).toHaveBeenCalledWith('ws://vm/ws');
    expect(executor.boot).toHaveBeenCalledWith(expect.objectContaining({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    }));
    expect(driver.page.resetToHome).toHaveBeenCalledWith({ homeRoute: '/' });
    expect(executor.rerun).toHaveBeenCalledWith('/tmp/sample.test.ts', 'alpha passes');
    expect(result.status).toBe('green');
    expect(result.baselineVersion).toBe(1);
  });

  it('updates the scenario used by later cycles', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const, testName: 'alpha passes' })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.setScenario({ homeRoute: '/dashboard', resetCategories: ['navigation'] });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');

    const result = await runtime.cycle();

    expect(result.status).toBe('green');
    expect(driver.page.resetToHome).toHaveBeenCalledWith({ homeRoute: '/dashboard' });
    expect(driver.mock.clear).not.toHaveBeenCalled();
  });

  it('reports attach mode as not supporting hot restart', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });

    const snapshot = await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    });

    expect(snapshot.supportsRestart).toBe(false);
    expect(snapshot.restartCapable).toBe(false);
  });

  it('adds structured failure context when the focused test is red', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({
        status: 'red' as const,
        testName: 'missing button',
        failure: { message: 'No widget found matching selector' },
        failureDetails: {
          source: { file: '/app/lib/login.dart', line: 42, snippet: 'missing button' },
          assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'missing', timeout: 5000 },
          artifacts: {
            failureContextPath: '/app/.fliwright/tdd/failures.json',
            widgetTree: { type: 'Root' },
          },
        },
      })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      driverFactory: () => driver,
      executor,
    });

    await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    });
    await runtime.focus('/tmp/sample.test.ts', 'missing button');
    const result = await runtime.cycle();

    expect(result.status).toBe('red');
    expect(result.failureContext).toMatchObject({
      kind: 'missing-element',
      testFile: '/tmp/sample.test.ts',
      testName: 'missing button',
      source: { file: '/app/lib/login.dart', line: 42 },
      assertion: { matcher: 'toBeVisible' },
    });
    expect(result.failureContext?.artifacts?.failureContextPath).toBe('/app/.fliwright/tdd/failures.json');
    expect(result).not.toHaveProperty('repair');
    expect(result.failureContext).toMatchObject({
      message: 'No widget found matching selector',
      artifacts: { widgetTree: { type: 'Root' } },
    });
  });

  it('returns the existing snapshot when started again with the same options', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      driverFactory: () => driver,
      executor,
    });
    const opts = {
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    };

    const first = await runtime.start(opts);
    const second = await runtime.start(opts);

    expect(second).toEqual(first);
    expect(driver.connect).toHaveBeenCalledTimes(1);
    expect(executor.boot).toHaveBeenCalledTimes(1);
  });

  it('timestamps snapshots only when runtime state changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    try {
      const driver = {
        connect: vi.fn(async () => {}),
        dispose: vi.fn(async () => {}),
        page: { resetToHome: vi.fn(async () => {}) },
        mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
      };
      const executor = {
        boot: vi.fn(async () => {}),
        rerun: vi.fn(async () => ({ status: 'green' as const })),
        dispose: vi.fn(async () => {}),
      };
      const runtime = new TddRuntime({
        driverFactory: () => driver,
        executor,
      });
      const opts = {
        configRoot: '/tmp/vitest.config.ts',
        vmServiceUrl: 'ws://vm/ws',
      };

      const started = await runtime.start(opts);
      vi.setSystemTime(1_800_000_001_000);
      const repeatedStart = await runtime.start(opts);
      vi.setSystemTime(1_800_000_002_000);
      await runtime.focus('/tmp/sample.test.ts', 'alpha passes');
      const focused = runtime.snapshot();

      expect(started.updatedAtMs).toBe(1_800_000_000_000);
      expect(repeatedStart.updatedAtMs).toBe(started.updatedAtMs);
      expect(focused.updatedAtMs).toBe(1_800_000_002_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects start reconfiguration while the runtime is already connected', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      driverFactory: () => driver,
      executor,
    });

    await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    });

    await expect(runtime.start({
      configRoot: '/tmp/other.vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    })).rejects.toThrow(/already started with different options/i);
  });

  it('treats changed Flutter app launch options as a runtime reconfiguration', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const daemon = {
      start: vi.fn(async () => {}),
      startApp: vi.fn(async () => ({
        appId: 'app-1',
        wsUri: 'ws://vm/ws',
        supportsRestart: true,
      })),
      reload: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      daemon,
      driverFactory: () => driver,
      executor,
    });

    await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      app: {
        deviceId: 'device-1',
        mode: 'run',
        flutterArgs: ['--dart-define=FLAVOR=dev'],
      },
    });

    await expect(runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      app: {
        deviceId: 'device-1',
        mode: 'drive',
        flutterArgs: ['--dart-define=FLAVOR=dev'],
      },
    })).rejects.toThrow(/already started with different options/i);
    expect(daemon.startApp).toHaveBeenCalledTimes(1);
  });

  it('treats the implicit Flutter target as lib/main.dart for start idempotency', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const daemon = {
      start: vi.fn(async () => {}),
      startApp: vi.fn(async () => ({
        appId: 'app-1',
        wsUri: 'ws://vm/ws',
        supportsRestart: true,
      })),
      reload: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      daemon,
      driverFactory: () => driver,
      executor,
    });

    await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      app: { deviceId: 'device-1' },
    });
    await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      app: { deviceId: 'device-1', target: 'lib/main.dart' },
    });

    expect(daemon.startApp).toHaveBeenCalledTimes(1);
  });

  it('clears session state after stop', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const, testName: 'alpha passes' })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      driverFactory: () => driver,
      executor,
    });

    await runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');
    await runtime.cycle();
    await runtime.stop();

    expect(runtime.snapshot()).toMatchObject({
      connected: false,
      daemonStatus: 'stopped',
      launchMode: 'attach',
      baselineVersion: 0,
      unsupportedState: undefined,
      focusedTest: undefined,
      lastResult: undefined,
    });
  });

  it('serializes overlapping cycle() calls so rerun never runs concurrently', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      reloadSources: vi.fn(async () => ({})),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };

    let active = 0;
    let peak = 0;
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        // Yield a few microtasks so a non-serialized second call could overlap.
        await Promise.resolve();
        await Promise.resolve();
        const status = active as 1 | 2;
        active -= 1;
        return { status: 'green' as const, testName: 'alpha passes', run: status };
      }),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');

    const [a, b, c] = await Promise.all([runtime.cycle(), runtime.cycle(), runtime.cycle()]);

    expect(peak).toBe(1); // never more than one rerun in flight
    expect(executor.rerun).toHaveBeenCalledTimes(3);
    expect([a.status, b.status, c.status]).toEqual(['green', 'green', 'green']);
  });

  it('serializes manual sync behind an in-flight cycle', async () => {
    const driver = daemonDriver();
    const daemon = makeDaemon();
    const events: string[] = [];
    let releaseRerun!: () => void;
    const rerunCanFinish = new Promise<void>((resolve) => {
      releaseRerun = resolve;
    });
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => {
        events.push('rerun:start');
        await rerunCanFinish;
        events.push('rerun:end');
        return { status: 'green' as const, testName: 'alpha passes' };
      }),
      dispose: vi.fn(async () => {}),
    };
    daemon.reload.mockImplementation(async () => {
      events.push('reload');
    });
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');

    const cyclePromise = runtime.cycle(undefined, { sync: 'none' });
    await waitUntil(() => events.includes('rerun:start'));
    const syncPromise = runtime.syncApp('reload');
    await Promise.resolve();

    expect(events).toEqual(['rerun:start']);
    releaseRerun();
    await cyclePromise;
    await syncPromise;

    expect(events).toEqual(['rerun:start', 'rerun:end', 'reload']);
  });

  it('serializes scenario updates behind an in-flight cycle', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    let releaseRerun!: () => void;
    const rerunCanFinish = new Promise<void>((resolve) => {
      releaseRerun = resolve;
    });
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => {
        await rerunCanFinish;
        return { status: 'green' as const, testName: 'alpha passes' };
      }),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');

    const cyclePromise = runtime.cycle();
    await waitUntil(() => executor.rerun.mock.calls.length === 1);
    const scenarioPromise = runtime.setScenario({ homeRoute: '/dashboard', resetCategories: ['navigation'] });
    await Promise.resolve();

    expect(driver.page.resetToHome).toHaveBeenCalledWith({ homeRoute: '/' });
    releaseRerun();
    await cyclePromise;
    await scenarioPromise;

    await runtime.cycle();
    expect(driver.page.resetToHome).toHaveBeenLastCalledWith({ homeRoute: '/dashboard' });
  });

  it('propagates a failing cycle to its caller without wedging the mutex', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    let calls = 0;
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('rerun blew up');
        return { status: 'green' as const };
      }),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');

    await expect(runtime.cycle()).rejects.toThrow('rerun blew up');
    // A subsequent cycle still works — the rejection did not wedge the chain.
    const ok = await runtime.cycle();
    expect(ok.status).toBe('green');
  });

  function daemonDriver() {
    return {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
  }

  function makeDaemon() {
    return {
      start: vi.fn(async () => {}),
      startApp: vi.fn(async () => ({
        appId: 'app-1',
        wsUri: 'ws://vm/ws',
        supportsRestart: true,
      })),
      reload: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    };
  }

  it('escalates a structural reload failure to a hot restart', async () => {
    const driver = daemonDriver();
    const daemon = makeDaemon();
    let calls = 0;
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => {
        calls += 1;
        // First pass (reload) still red with a structural failure; restart pass goes green.
        if (calls === 1) {
          return {
            status: 'red' as const,
            testName: 'sees the wallet',
            failure: { message: 'No widget found matching selector' },
            failureDetails: undefined,
          };
        }
        return { status: 'green' as const, testName: 'sees the wallet' };
      }),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });
    await runtime.focus('/tmp/sample.test.ts', 'sees the wallet');

    const result = await runtime.cycle(undefined, { sync: 'reload' });

    expect(daemon.reload).toHaveBeenCalledTimes(1);
    expect(daemon.restart).toHaveBeenCalledTimes(1);
    expect(executor.rerun).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('green');
    expect(result.lastSync).toBe('restart');
  });

  it('does not escalate when the reload failure is non-structural', async () => {
    const driver = daemonDriver();
    const daemon = makeDaemon();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({
        status: 'red' as const,
        testName: 'shows balance',
        failure: { message: 'expected to have text "100" received "50"' },
      })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });
    await runtime.focus('/tmp/sample.test.ts', 'shows balance');

    const result = await runtime.cycle(undefined, { sync: 'reload' });

    expect(daemon.restart).not.toHaveBeenCalled();
    expect(result.lastSync).toBe('reload');
  });

  it('does not escalate in attach mode (no daemon restart available)', async () => {
    const driver = daemonDriver();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({
        status: 'red' as const,
        testName: 'sees the wallet',
        failure: { message: 'No widget found matching selector' },
      })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'sees the wallet');

    const result = await runtime.cycle(undefined, { sync: 'reload' });

    expect(result.lastSync).toBe('reload');
    expect(result.status).toBe('red');
  });

  it('returns a structured red result when app sync fails', async () => {
    const driver = daemonDriver();
    const daemon = makeDaemon();
    daemon.reload.mockRejectedValueOnce(new Error('Dart compile failed: missing semicolon'));
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });
    await runtime.focus('/tmp/sample.test.ts', 'compile failure');

    const result = await runtime.cycle(undefined, { sync: 'reload' });

    expect(result.status).toBe('red');
    expect(result.lastSync).toBe('none');
    expect(result.failure?.message).toContain('Dart compile failed');
    expect(result.failureContext).toMatchObject({
      kind: 'test-error',
      message: 'Dart compile failed: missing semicolon',
      testFile: '/tmp/sample.test.ts',
      testName: 'compile failure',
    });
    expect(executor.rerun).not.toHaveBeenCalled();
  });

  it('auto sync resolves restart from generated-code changes', async () => {
    const driver = daemonDriver();
    const daemon = makeDaemon();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });
    await runtime.focus('/tmp/sample.test.ts', 'wallet');

    const result = await runtime.cycle(undefined, { sync: 'auto', changes: ['lib/api/client.g.dart'] });

    expect(daemon.restart).toHaveBeenCalledTimes(1);
    expect(daemon.reload).not.toHaveBeenCalled();
    expect(result.lastSync).toBe('restart');
  });

  it('auto sync resolves reload for plain dart changes', async () => {
    const driver = daemonDriver();
    const daemon = makeDaemon();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });
    await runtime.focus('/tmp/sample.test.ts', 'wallet');

    const result = await runtime.cycle(undefined, { sync: 'auto', changes: ['lib/login_page.dart'] });

    expect(daemon.reload).toHaveBeenCalledTimes(1);
    expect(daemon.restart).not.toHaveBeenCalled();
    expect(result.lastSync).toBe('reload');
  });

  it('manual syncApp performs daemon reload and restart', async () => {
    const driver = daemonDriver();
    const daemon = makeDaemon();
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });

    const reload = await runtime.syncApp('reload');
    const restart = await runtime.syncApp('restart');

    expect(reload.lastSync).toBe('reload');
    expect(restart.lastSync).toBe('restart');
    expect(daemon.reload).toHaveBeenCalledWith('app-1');
    expect(daemon.restart).toHaveBeenCalledWith('app-1');
  });

  it('reconnects in attach mode by retrying the same VM service URL', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    expect(driver.connect).toHaveBeenCalledTimes(1);

    await runtime.reconnect();

    // Same URL → executor is NOT rebooted, but the driver reconnected.
    expect(driver.connect).toHaveBeenCalledTimes(2);
    expect(driver.dispose).toHaveBeenCalledTimes(1);
    expect(executor.boot).toHaveBeenCalledTimes(1);
  });

  it('reconnects in daemon-start mode by relaunching the app and rebooting the executor on a new URL', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    let launches = 0;
    const daemon = {
      start: vi.fn(async () => {}),
      startApp: vi.fn(async () => {
        launches += 1;
        return {
          appId: `app-${launches}`,
          wsUri: launches === 1 ? 'ws://old/ws' : 'ws://new/ws',
          supportsRestart: true,
        };
      }),
      reload: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ daemon, driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', app: { deviceId: 'device-1' } });

    await runtime.reconnect();

    // URL changed → executor rebooted with the new URL; driver reconnected; app relaunched twice.
    expect(daemon.startApp).toHaveBeenCalledTimes(2);
    expect(executor.dispose).toHaveBeenCalledTimes(1);
    expect(executor.boot).toHaveBeenCalledTimes(2);
    expect(executor.boot).toHaveBeenLastCalledWith(expect.objectContaining({ vmServiceUrl: 'ws://new/ws' }));
    expect(driver.connect).toHaveBeenLastCalledWith('ws://new/ws');
  });

  it('returns a red timeout result without wedging the mutex', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    // rerun never resolves → forces the timeout path.
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => new Promise(() => {})),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });
    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws' });
    await runtime.focus('/tmp/sample.test.ts', 'slow');

    const result = await runtime.cycle(undefined, { sync: 'none', timeoutMs: 20 });

    expect(result.status).toBe('red');
    expect(result.durationMs).toBe(20);
    expect(result.failure?.message).toContain('20ms');
    expect(result.failureContext?.kind).toBe('timeout');
    expect(result.failureContext?.message).toContain('20ms');
    // The runtime is still usable afterwards (snapshot reports lastResult, not wedged).
    expect(runtime.snapshot().lastResult?.status).toBe('red');
  });

  it('cleans up partial resources when start fails', async () => {
    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {
        throw new Error('vitest boot failed');
      }),
      rerun: vi.fn(async () => ({ status: 'green' as const })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({
      driverFactory: () => driver,
      executor,
    });

    await expect(runtime.start({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    })).rejects.toThrow('vitest boot failed');

    expect(executor.dispose).toHaveBeenCalledTimes(1);
    expect(driver.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      connected: false,
      daemonStatus: 'stopped',
      baselineVersion: 0,
      focusedTest: undefined,
      lastResult: undefined,
    });
  });

  it('writes the RuntimeSnapshot to statusFilePath after state changes', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'tdd-status-'));
    const statusFilePath = join(dir, '.fliwright', 'tdd-status.json');

    const driver = {
      connect: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      page: { resetToHome: vi.fn(async () => {}) },
      mock: { clear: vi.fn(async () => {}), clearCalls: vi.fn(async () => {}) },
    };
    const executor = {
      boot: vi.fn(async () => {}),
      rerun: vi.fn(async () => ({ status: 'green' as const, testName: 'alpha passes' })),
      dispose: vi.fn(async () => {}),
    };
    const runtime = new TddRuntime({ driverFactory: () => driver, executor });

    await runtime.start({ configRoot: '/tmp/vitest.config.ts', vmServiceUrl: 'ws://vm/ws', statusFilePath });
    await runtime.focus('/tmp/sample.test.ts', 'alpha passes');
    await runtime.cycle();
    await runtime.stop();

    const { readFile } = await import('node:fs/promises');
    // stop() awaits the status write chain, so the final (stopped) snapshot is flushed to disk.
    const written = JSON.parse(await readFile(statusFilePath, 'utf8')) as { connected: boolean; baselineVersion: number };
    expect(written.connected).toBe(false);
    expect(typeof written.baselineVersion).toBe('number');
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for condition.');
}
