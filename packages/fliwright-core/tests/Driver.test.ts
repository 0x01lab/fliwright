import { describe, it, expect, vi } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import type { FliwrightPlugin, PluginContext } from '../src/interfaces/Plugin.js';
import type { StateAdapter } from '../src/interfaces/StateAdapter.js';

function createMockWSForDriver() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    on(event: string, fn: (...args: any[]) => void) { (listeners[event] ??= []).push(fn); },
    send(data: string) {},
    close() {},
    emit(event: string, ...args: unknown[]) { (listeners[event] ?? []).forEach((fn) => fn(...args)); },
  };
}

describe('FliwrightDriver', () => {
  it('initializes plugins on connect', async () => {
    const onInit = vi.fn();
    const plugin: FliwrightPlugin = { name: 'test', onInit };
    const driver = new FliwrightDriver({ plugins: [plugin] });
    await driver.attachMockConnector(createMockWSForDriver());
    expect(onInit).toHaveBeenCalledOnce();
  });

  it('provides access to state adapters after init', async () => {
    const fakeAdapter: StateAdapter = {
      read: vi.fn().mockResolvedValue(42), write: vi.fn(), watch: vi.fn(), listProviders: vi.fn(), override: vi.fn(),
    };
    const plugin: FliwrightPlugin = {
      name: 'riverpod',
      async onInit(ctx: PluginContext) { ctx.registerStateAdapter('riverpod', fakeAdapter); },
    };
    const driver = new FliwrightDriver({ plugins: [plugin] });
    await driver.attachMockConnector(createMockWSForDriver());
    const adapter = driver.getStateAdapter('riverpod');
    const value = await adapter.read('counter');
    expect(value).toBe(42);
  });

  it('notifies plugins on test lifecycle', async () => {
    const onTestStart = vi.fn();
    const onTestEnd = vi.fn();
    const plugin: FliwrightPlugin = { name: 'lifecycle', onTestStart, onTestEnd };
    const driver = new FliwrightDriver({ plugins: [plugin] });
    await driver.attachMockConnector(createMockWSForDriver());
    await driver.notifyTestStart('test-1');
    expect(onTestStart).toHaveBeenCalledWith('test-1');
    await driver.notifyTestEnd('test-1', { name: 'test-1', passed: true, duration: 50 });
    expect(onTestEnd).toHaveBeenCalledWith('test-1', { name: 'test-1', passed: true, duration: 50 });
  });

  it('disposes plugins on disconnect', async () => {
    const onDispose = vi.fn();
    const plugin: FliwrightPlugin = { name: 'cleanup', onDispose };
    const driver = new FliwrightDriver({ plugins: [plugin] });
    await driver.attachMockConnector(createMockWSForDriver());
    await driver.dispose();
    expect(onDispose).toHaveBeenCalledOnce();
  });
});
