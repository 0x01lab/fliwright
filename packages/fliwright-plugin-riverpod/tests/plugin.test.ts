import { describe, it, expect, vi } from 'vitest';
import { riverpodPlugin } from '../src/plugin.js';
import type { PluginContext } from '@fliwright/core';

describe('riverpodPlugin', () => {
  it('has the correct plugin name', () => {
    const plugin = riverpodPlugin();
    expect(plugin.name).toBe('riverpod');
  });

  it('registers a StateAdapter on init', async () => {
    const plugin = riverpodPlugin();
    const registeredAdapters: Array<{ name: string; adapter: unknown }> = [];
    const mockContext: PluginContext = {
      sendRequest: vi.fn().mockResolvedValue({}),
      registerStateAdapter: (name, adapter) => { registeredAdapters.push({ name, adapter }); },
      registerMockAdapter: vi.fn(),
      registerFinderStrategy: vi.fn(),
      registerHealingStrategy: vi.fn(),
      onEvent: vi.fn().mockReturnValue(() => {}),
    };
    await plugin.onInit!(mockContext);
    expect(registeredAdapters).toHaveLength(1);
    expect(registeredAdapters[0].name).toBe('riverpod');
    expect(registeredAdapters[0].adapter).toBeDefined();
  });

  it('subscribes to riverpod.stateChanged events on init', async () => {
    const plugin = riverpodPlugin();
    let capturedEventHandler: ((event: { kind: string; data: Record<string, unknown> }) => void) | null = null;
    const registeredAdapters: Array<{ name: string; adapter: unknown }> = [];
    const mockContext: PluginContext = {
      sendRequest: vi.fn().mockResolvedValue({}),
      registerStateAdapter: (name, adapter) => { registeredAdapters.push({ name, adapter }); },
      registerMockAdapter: vi.fn(),
      registerFinderStrategy: vi.fn(),
      registerHealingStrategy: vi.fn(),
      onEvent: (cb) => { capturedEventHandler = cb as typeof capturedEventHandler; return () => {}; },
    };
    await plugin.onInit!(mockContext);
    expect(capturedEventHandler).not.toBeNull();

    const adapter = registeredAdapters[0].adapter as { handleEvent: (key: string, oldVal: unknown, newVal: unknown) => void };
    const handleEventSpy = vi.spyOn(adapter, 'handleEvent');

    capturedEventHandler!({ kind: 'riverpod.stateChanged', data: { providerKey: 'counter', oldValue: 0, newValue: 1 } });
    expect(handleEventSpy).toHaveBeenCalledWith('counter', 0, 1);

    // Non-riverpod events should not trigger handleEvent
    handleEventSpy.mockClear();
    capturedEventHandler!({ kind: 'other.event', data: {} });
    expect(handleEventSpy).not.toHaveBeenCalled();
  });
});
