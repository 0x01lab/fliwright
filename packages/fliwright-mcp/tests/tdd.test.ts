import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServerState } from '../src/state.js';
import { handleTddCycle, handleTddFocus, handleTddPrepare, handleTddStart, handleTddStatus, handleTddStop, handleTddValidateSpec } from '../src/tools/tdd.js';

describe('TDD MCP handlers', () => {
  it('starts, focuses, cycles, and stops a lazy runtime', async () => {
    const state = createServerState();
    const runtime = {
      start: vi.fn(async () => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
      focus: vi.fn(async () => {}),
      cycle: vi.fn(async () => ({ status: 'green' as const, file: 'a.test.ts', durationMs: 1, lastSync: 'none' as const, baselineVersion: 1 })),
      stop: vi.fn(async () => {}),
      snapshot: vi.fn(() => ({ connected: false, daemonStatus: 'stopped' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 1 })),
    } as any;

    const start = await handleTddStart({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    }, state, () => runtime);
    const focus = await handleTddFocus({ file: 'a.test.ts', testName: 'alpha' }, state);
    const cycle = await handleTddCycle({ sync: 'none' }, state);
    const stop = await handleTddStop({ keepAppAlive: true }, state);

    expect(start.connected).toBe(true);
    expect(focus.connected).toBe(false);
    expect(cycle.status).toBe('green');
    expect(stop.connected).toBe(false);
    expect(state.getTddRuntime()).toBeNull();
  });

  it('passes Flutter launch options through to a daemon-started runtime', async () => {
    const state = createServerState();
    const runtime = {
      start: vi.fn(async () => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: true, launchMode: 'start' as const, restartCapable: true, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
      snapshot: vi.fn(() => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: true, launchMode: 'start' as const, restartCapable: true, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
    } as any;

    await handleTddStart({
      configRoot: '/tmp/vitest.config.ts',
      deviceId: 'device-1',
      projectId: '/app',
      target: 'lib/main_dev.dart',
      flutterArgs: ['--dart-define=FLAVOR=dev'],
      mode: 'run',
    }, state, () => runtime);

    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      app: {
        deviceId: 'device-1',
        flutterArgs: ['--dart-define=FLAVOR=dev'],
        mode: 'run',
        target: 'lib/main_dev.dart',
        projectId: '/app',
      },
    }));
  });

  it('passes runtime scenario seed fields through to TddRuntime', async () => {
    const state = createServerState();
    const runtime = {
      start: vi.fn(async () => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
      snapshot: vi.fn(),
    } as any;

    await handleTddStart({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
      scenario: {
        homeRoute: '/checkout',
        resetCategories: ['navigation', 'riverpod', 'mock', 'storage'],
        riverpodOverrides: [{ provider: 'cartProvider', value: [] }],
        mockProfile: 'checkout-empty',
        storageSeed: { draftOrderId: 'order-1' },
      },
    }, state, () => runtime);

    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      scenario: {
        homeRoute: '/checkout',
        resetCategories: ['navigation', 'riverpod', 'mock', 'storage'],
        riverpodOverrides: [{ provider: 'cartProvider', value: [] }],
        mockProfile: 'checkout-empty',
        storageSeed: { draftOrderId: 'order-1' },
      },
    }));
  });

  it('does not retain a newly-created runtime when start fails', async () => {
    const state = createServerState();
    const runtime = {
      start: vi.fn(async () => {
        throw new Error('boot failed');
      }),
      snapshot: vi.fn(),
    } as any;

    await expect(handleTddStart({
      configRoot: '/tmp/vitest.config.ts',
      vmServiceUrl: 'ws://vm/ws',
    }, state, () => runtime)).rejects.toThrow('boot failed');

    expect(state.getTddRuntime()).toBeNull();
  });

  it('clears the runtime from state even when stop fails', async () => {
    const state = createServerState();
    const runtime = {
      stop: vi.fn(async () => {
        throw new Error('stop failed');
      }),
      snapshot: vi.fn(() => ({ connected: false, daemonStatus: 'stopped' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
    } as any;
    state.setTddRuntime(runtime);

    await expect(handleTddStop({ keepAppAlive: false }, state)).rejects.toThrow('stop failed');

    expect(state.getTddRuntime()).toBeNull();
  });

  it('focuses the generated workflow test when file is omitted', async () => {
    const state = createServerState();
    const runtime = {
      focus: vi.fn(async () => {}),
      snapshot: vi.fn(() => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
    } as any;
    state.setTddRuntime(runtime);
    state.setTddWorkflowContext({
      testFile: '/tmp/generated.test.ts',
      testName: 'generated flow',
    });

    const focus = await handleTddFocus({}, state);

    expect(focus.connected).toBe(true);
    expect(runtime.focus).toHaveBeenCalledWith('/tmp/generated.test.ts', 'generated flow');
  });

  it('auto-focuses the generated workflow test before cycle when runtime is unfocused', async () => {
    const state = createServerState();
    const runtime = {
      focus: vi.fn(async () => {}),
      cycle: vi.fn(async () => ({ status: 'green' as const, file: '/tmp/generated.test.ts', durationMs: 1, lastSync: 'none' as const, baselineVersion: 1 })),
      snapshot: vi.fn(() => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
    } as any;
    state.setTddRuntime(runtime);
    state.setTddWorkflowContext({
      testFile: '/tmp/generated.test.ts',
      testName: 'generated flow',
    });

    const cycle = await handleTddCycle({ sync: 'none' }, state);

    expect(cycle.status).toBe('green');
    expect(runtime.focus).toHaveBeenCalledWith('/tmp/generated.test.ts', 'generated flow');
    expect(runtime.cycle).toHaveBeenCalledWith(undefined, {
      sync: 'none',
      fullReset: undefined,
      changes: undefined,
      autoEscalate: true,
      timeoutMs: undefined,
    });
  });

  it('prepares a red-first workflow, writes the generated test, and stores workflow context', async () => {
    const state = createServerState();
    const dir = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-prepare-'));
    const outputFile = resolve(dir, 'checkout.test.ts');

    const result = await handleTddPrepare({
      outputFile,
      spec: {
        app: { route: '/checkout' },
        elements: [
          { id: 'pay', role: 'button', name: 'Pay now', text: 'Pay now' },
          { id: 'done', role: 'text', name: 'Paid', text: 'Paid' },
        ],
        flows: [{
          id: 'pay-flow',
          name: 'customer pays',
          steps: [{ action: 'tap', target: 'pay' }],
          expectedOutcome: [{ kind: 'visible', target: 'done' }],
        }],
      },
    }, state);

    expect(result.testFile).toBe(outputFile);
    expect((result.workflow as any).status).toBe('needs-selector-review');
    expect(await readFile(outputFile, 'utf8')).toBe(result.testCode);
    expect(state.getTddWorkflowContext()).toMatchObject({
      testFile: outputFile,
      testName: 'customer pays',
      flowId: 'pay-flow',
    });
  });

  it('focuses the prepared red-first test when the runtime is already started', async () => {
    const state = createServerState();
    const runtime = {
      focus: vi.fn(async () => {}),
      snapshot: vi.fn(() => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
    } as any;
    state.setTddRuntime(runtime);
    const dir = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-prepare-focus-'));
    const outputFile = resolve(dir, 'checkout.test.ts');

    const result = await handleTddPrepare({
      outputFile,
      refs: [{ role: 'button', label: 'Pay now' }],
      spec: {
        elements: [{ id: 'pay', role: 'button', name: 'Pay now', text: 'Pay now' }],
        flows: [{ id: 'pay-flow', name: 'customer pays', steps: [{ action: 'tap', target: 'pay' }] }],
      },
    }, state);

    expect(result.focused?.connected).toBe(true);
    expect(runtime.focus).toHaveBeenCalledWith(outputFile, 'customer pays');
  });

  it('focuses the whole generated suite file when preparing all flows', async () => {
    const state = createServerState();
    const runtime = {
      focus: vi.fn(async () => {}),
      snapshot: vi.fn(() => ({ connected: true, daemonStatus: 'running' as const, supportsRestart: false, launchMode: 'attach' as const, restartCapable: false, driverConnections: 1, fixtureDriverSharing: 'vm-service-url' as const, baselineVersion: 0 })),
    } as any;
    state.setTddRuntime(runtime);
    const dir = await mkdtemp(resolve(tmpdir(), 'fliwright-tdd-prepare-suite-'));
    const outputFile = resolve(dir, 'checkout.test.ts');

    const result = await handleTddPrepare({
      outputFile,
      allFlows: true,
      testNamePrefix: 'checkout',
      spec: {
        elements: [
          { id: 'pay', role: 'button', name: 'Pay now', text: 'Pay now' },
          { id: 'cancel', role: 'button', name: 'Cancel', text: 'Cancel' },
        ],
        flows: [
          { id: 'pay-flow', name: 'pay', steps: [{ action: 'tap', target: 'pay' }] },
          { id: 'cancel-flow', name: 'cancel', steps: [{ action: 'tap', target: 'cancel' }] },
        ],
      },
    }, state);

    expect(result.tests).toHaveLength(2);
    expect(runtime.focus).toHaveBeenCalledWith(outputFile, undefined);
    expect(state.getTddWorkflowContext()).toMatchObject({
      testFile: outputFile,
    });
    expect(state.getTddWorkflowContext()?.testName).toBeUndefined();
  });

  it('returns a disconnected status before the runtime starts', () => {
    const state = createServerState();
    state.setTddWorkflowContext({
      testFile: '/tmp/generated.test.ts',
      coverage: { status: 'complete' },
    });

    const status = handleTddStatus(state);

    expect(status).toMatchObject({
      connected: false,
      daemonStatus: 'stopped',
      driverConnections: 0,
      baselineVersion: 0,
    });
    expect(status.workflowContext).toMatchObject({
      testFile: '/tmp/generated.test.ts',
      coverage: { status: 'complete' },
    });
  });

  it('validates an InteractionSpec candidate before generation', () => {
    const invalid = handleTddValidateSpec({
      spec: {
        elements: [{ id: 'save', role: 'button', name: 'Save' }],
        flows: [{ id: 'save-flow', name: 'save', steps: [{ action: 'tap', target: 'missing' }] }],
      },
    });

    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.issues).toEqual([expect.objectContaining({
        path: '$.flows[0].steps[0].target',
      })]);
    }

    const valid = handleTddValidateSpec({
      spec: {
        elements: [
          { id: 'save', role: 'button', name: 'Save', text: 'Save' },
          { id: 'done', role: 'text', name: 'Saved', text: 'Saved', importance: 'required' },
        ],
        flows: [{
          id: 'save-flow',
          name: 'save',
          steps: [{ action: 'tap', target: 'save' }],
          expectedOutcome: [{ kind: 'visible', target: 'done' }],
        }],
      },
    });

    expect(valid).toMatchObject({
      valid: true,
      coverage: { status: 'complete' },
    });
  });
});
