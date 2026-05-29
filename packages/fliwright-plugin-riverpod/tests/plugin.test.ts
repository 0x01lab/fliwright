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
    };
    await plugin.onInit!(mockContext);
    expect(registeredAdapters).toHaveLength(1);
    expect(registeredAdapters[0].name).toBe('riverpod');
    expect(registeredAdapters[0].adapter).toBeDefined();
  });
});
