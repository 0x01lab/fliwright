import type { FliwrightDriver } from '@fliwright/core';
import type { StateProviderEntry } from '../types.js';

export interface StateOverrideResult {
  provider: string;
  overridden: boolean;
  value?: unknown;
  message?: string;
}

export interface StateProviderStatus {
  observerInstalled: boolean;
  containerReady: boolean;
  providerCount: number;
  watching: string[];
}

interface RiverpodProviderInfo {
  key?: string;
  name?: string;
  type?: string;
  value?: unknown;
  valueType?: string;
  readable?: boolean;
  overridable?: boolean;
  watching?: boolean;
  error?: string;
}

export class StateInjectionService {
  async status(driver: FliwrightDriver): Promise<StateProviderStatus> {
    const state = driver.state as typeof driver.state & {
      status?: () => Promise<unknown>;
    };
    const result = state.status ? await state.status() : {};
    if (!isObject(result)) {
      return {
        observerInstalled: false,
        containerReady: false,
        providerCount: 0,
        watching: [],
      };
    }

    return {
      observerInstalled: result.observerInstalled === true,
      containerReady: result.containerReady === true,
      providerCount: typeof result.providerCount === 'number' ? result.providerCount : 0,
      watching: Array.isArray(result.watching) ? result.watching.map(String) : [],
    };
  }

  async listProviders(driver: FliwrightDriver): Promise<StateProviderEntry[]> {
    const providers = await driver.state.listProviders() as RiverpodProviderInfo[];
    return providers.map((provider) => ({
      kind: 'stateProvider' as const,
      key: String(provider.key ?? provider.name ?? 'unknown'),
      type: provider.type,
      value: provider.value,
      valueType: provider.valueType,
      readable: provider.readable ?? true,
      overridable: provider.overridable ?? false,
      watching: provider.watching,
      error: provider.error,
    }));
  }

  async read(driver: FliwrightDriver, key: string): Promise<unknown> {
    return driver.state.read(key);
  }

  async override(driver: FliwrightDriver, key: string, value: unknown): Promise<StateOverrideResult> {
    const state = driver.state as typeof driver.state & {
      overrideWithResult?: (key: string, value: unknown) => Promise<unknown>;
    };
    const result = state.overrideWithResult
      ? await state.overrideWithResult(key, value)
      : await state.override(key, value) as unknown;
    if (!isObject(result)) {
      return { provider: key, overridden: true, value };
    }

    return {
      provider: String(result.provider ?? key),
      overridden: result.overridden !== false,
      value: result.value ?? value,
      message: typeof result.message === 'string' ? result.message : undefined,
    };
  }

  async watch(
    driver: FliwrightDriver,
    key: string,
    onChange: (oldValue: unknown, newValue: unknown) => void,
  ): Promise<() => void> {
    return driver.state.watch(key, onChange);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
