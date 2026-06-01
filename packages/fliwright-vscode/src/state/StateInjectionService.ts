import type { FliwrightDriver } from '@fliwright/core';
import type { StateProviderEntry } from '../types.js';

export class StateInjectionService {
  async listProviders(driver: FliwrightDriver): Promise<StateProviderEntry[]> {
    const result = await driver.sendRequest('ext.fliwright.riverpod.list', {}) as {
      providers?: Array<{ key?: string; name?: string; type?: string; value?: unknown }>;
    };
    return (result.providers ?? []).map((provider) => ({
      kind: 'stateProvider' as const,
      key: String(provider.key ?? provider.name ?? 'unknown'),
      type: provider.type,
      value: provider.value,
    }));
  }

  async read(driver: FliwrightDriver, key: string): Promise<unknown> {
    const result = await driver.sendRequest('ext.fliwright.riverpod.read', { provider: key }) as { value?: unknown };
    return result.value;
  }

  async override(driver: FliwrightDriver, key: string, value: unknown): Promise<void> {
    await driver.sendRequest('ext.fliwright.riverpod.override', {
      provider: key,
      value: JSON.stringify(value),
    });
  }
}
