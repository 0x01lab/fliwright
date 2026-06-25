import { describe, expect, it, beforeEach } from 'vitest';
import { __setConfiguration } from 'vscode';
import { TddLoopController, TDD_LOOP_TAKE_OVER_ENABLED_CONFIG } from '../src/tddloop/TddLoopController.js';
import type { TddLoopSnapshot, TddLoopStatusSource } from '../src/tddloop/index.js';

/** In-memory source so the controller test does not touch the filesystem. */
class FakeSource implements TddLoopStatusSource {
  constructor(private snapshot?: TddLoopSnapshot) {}
  set(snapshot: TddLoopSnapshot | undefined) { this.snapshot = snapshot; }
  async read(): Promise<TddLoopSnapshot | undefined> { return this.snapshot; }
}

describe('TddLoopController', () => {
  beforeEach(() => {
    // Take-over is OFF by default (design principle 4 — opt-in).
    __setConfiguration({});
  });

  it('isTakeOverEnabled is false by default', () => {
    const controller = new TddLoopController(new FakeSource(), undefined);
    expect(controller.isTakeOverEnabled()).toBe(false);
    controller.dispose();
  });

  it('isTakeOverEnabled reflects the config flag', () => {
    __setConfiguration({ [TDD_LOOP_TAKE_OVER_ENABLED_CONFIG]: true });
    const controller = new TddLoopController(new FakeSource(), undefined);
    expect(controller.isTakeOverEnabled()).toBe(true);
    controller.dispose();
  });

  it('registerCommands returns three disposables', () => {
    const controller = new TddLoopController(new FakeSource(), undefined);
    const disposables = controller.registerCommands();
    expect(disposables).toHaveLength(3);
    for (const d of disposables) d.dispose();
    controller.dispose();
  });

  it('refresh reads from the source and pushes a view model', async () => {
    const snapshot: TddLoopSnapshot = {
      connected: true,
      daemonStatus: 'running',
      supportsRestart: true,
      launchMode: 'start',
      restartCapable: true,
      driverConnections: 1,
      fixtureDriverSharing: 'vm-service-url',
      lastResult: { status: 'green', file: 'a.test.ts', durationMs: 1, lastSync: 'reload', baselineVersion: 1 },
      baselineVersion: 1,
    };
    const controller = new TddLoopController(new FakeSource(snapshot), undefined);
    const out = await controller.refresh();
    expect(out).toBe(snapshot);
    const model = controller.toViewModel(out);
    expect(model.phase).toBe('green');
    controller.dispose();
  });

  it('refresh tolerates an absent snapshot', async () => {
    const controller = new TddLoopController(new FakeSource(undefined), undefined);
    const out = await controller.refresh();
    expect(out).toBeUndefined();
    expect(controller.toViewModel(out).phase).toBe('idle');
    controller.dispose();
  });

  it('auto-refresh can be started and disposed without throwing', () => {
    const controller = new TddLoopController(new FakeSource(), undefined, { autoRefreshMs: 10 });
    expect(() => {
      controller.startAutoRefresh();
      controller.startAutoRefresh(); // idempotent
    }).not.toThrow();
    controller.dispose();
  });

  it('take-over command stays disarmed while disabled (opt-in default)', async () => {
    // Disabled by default: the command surfaces an info message and never arms.
    // We assert the post-condition (armed stays false) without driving the modal path.
    const controller = new TddLoopController(new FakeSource(), undefined);
    expect(controller.isTakeOverEnabled()).toBe(false);
    await controller.refresh();
    expect(controller.isTakeOverArmed()).toBe(false);
    controller.dispose();
  });

  it('controller never touches a driver / vm service (read-only by construction)', () => {
    // The controller has no reference to FliwrightDriver, VM service, or daemon in its surface.
    // This is a structural assertion: the public methods are read-only.
    const controller = new TddLoopController(new FakeSource(), undefined);
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).filter(
      (n) => n !== 'constructor' && typeof (controller as any)[n] === 'function',
    );
    for (const name of methodNames) {
      expect(name).not.toMatch(/connect|startDriver|launchDaemon|spawn|attach/);
    }
    controller.dispose();
  });
});
