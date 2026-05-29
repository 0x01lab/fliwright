import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry } from '../src/PluginRegistry.js';
import type { FliwrightPlugin, PluginContext } from '../src/interfaces/Plugin.js';
import type { StateAdapter } from '../src/interfaces/StateAdapter.js';

function createMockPlugin(name: string, hooks?: Partial<FliwrightPlugin>): FliwrightPlugin {
  return {
    name,
    onInit: hooks?.onInit,
    onTestStart: hooks?.onTestStart,
    onTestEnd: hooks?.onTestEnd,
    onDispose: hooks?.onDispose,
  };
}

describe('PluginRegistry', () => {
  it('registers and resolves a plugin by name', () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin('test-plugin');
    registry.register(plugin);
    expect(registry.resolve('test-plugin')).toBe(plugin);
  });

  it('throws when resolving an unregistered plugin', () => {
    const registry = new PluginRegistry();
    expect(() => registry.resolve('nonexistent')).toThrow("Plugin 'nonexistent' is not registered");
  });

  it('throws when registering a plugin with a duplicate name', () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin('dup'));
    expect(() => registry.register(createMockPlugin('dup'))).toThrow("Plugin 'dup' is already registered");
  });

  it('calls onInit for all plugins with a context', async () => {
    const registry = new PluginRegistry();
    const onInit = vi.fn();
    registry.register(createMockPlugin('a', { onInit }));
    registry.register(createMockPlugin('b', { onInit }));

    const mockSendRequest = vi.fn().mockResolvedValue({});
    await registry.initAll(mockSendRequest);

    expect(onInit).toHaveBeenCalledTimes(2);
    const ctx = onInit.mock.calls[0][0] as PluginContext;
    expect(ctx.sendRequest).toBe(mockSendRequest);
    expect(typeof ctx.registerStateAdapter).toBe('function');
  });

  it('stores state adapters registered during init', async () => {
    const registry = new PluginRegistry();
    const fakeAdapter: StateAdapter = {
      read: vi.fn(), write: vi.fn(), watch: vi.fn(), listProviders: vi.fn(), override: vi.fn(),
    };

    const plugin: FliwrightPlugin = {
      name: 'riverpod',
      async onInit(ctx: PluginContext) { ctx.registerStateAdapter('riverpod', fakeAdapter); },
    };

    registry.register(plugin);
    await registry.initAll(vi.fn().mockResolvedValue({}));
    expect(registry.getStateAdapter('riverpod')).toBe(fakeAdapter);
  });

  it('throws when getting an unregistered state adapter', () => {
    const registry = new PluginRegistry();
    expect(() => registry.getStateAdapter('none')).toThrow("StateAdapter 'none' is not registered");
  });

  it('stores mock adapters registered during init', async () => {
    const registry = new PluginRegistry();
    const fakeMockAdapter = { addRoute: vi.fn(), removeRoute: vi.fn(), clear: vi.fn() };

    const plugin: FliwrightPlugin = {
      name: 'http-mock',
      async onInit(ctx: PluginContext) { ctx.registerMockAdapter('http', fakeMockAdapter); },
    };

    registry.register(plugin);
    await registry.initAll(vi.fn().mockResolvedValue({}));
    expect(registry.getMockAdapter('http')).toBe(fakeMockAdapter);
  });

  it('calls onTestStart and onTestEnd for all plugins', async () => {
    const registry = new PluginRegistry();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    registry.register(createMockPlugin('a', { onTestStart: onStart, onTestEnd: onEnd }));
    await registry.initAll(vi.fn().mockResolvedValue({}));

    await registry.notifyTestStart('my-test');
    expect(onStart).toHaveBeenCalledWith('my-test');

    await registry.notifyTestEnd('my-test', { name: 'my-test', passed: true, duration: 100 });
    expect(onEnd).toHaveBeenCalledWith('my-test', { name: 'my-test', passed: true, duration: 100 });
  });

  it('calls onDispose for all plugins', async () => {
    const registry = new PluginRegistry();
    const onDispose = vi.fn();
    registry.register(createMockPlugin('a', { onDispose }));
    await registry.initAll(vi.fn().mockResolvedValue({}));

    await registry.disposeAll();
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it('lists all registered plugin names', () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin('alpha'));
    registry.register(createMockPlugin('beta'));
    expect(registry.pluginNames).toEqual(['alpha', 'beta']);
  });
});
