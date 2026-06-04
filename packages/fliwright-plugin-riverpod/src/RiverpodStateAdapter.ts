import type { StateAdapter } from '@fliwright/core';
import type { ProviderInfo } from '@fliwright/core';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class RiverpodStateAdapter implements StateAdapter {
  private eventListeners = new Map<string, Set<(oldVal: unknown, newVal: unknown) => void>>();

  constructor(
    private sendRequest: SendRequest,
  ) {}

  async read(key: string): Promise<unknown> {
    const result = normalizeResult(await this.sendRequest('ext.fliwright.riverpod.read', { provider: key })) as { value: unknown; found?: boolean; error?: string };
    if (result.found === false) {
      throw new Error(`Riverpod provider not found: ${key}`);
    }
    if (typeof result.error === 'string' && result.error.length > 0) {
      throw new Error(result.error);
    }
    return result.value;
  }

  async write(key: string, value: unknown): Promise<void> {
    await this.overrideWithResult(key, value);
  }

  async watch(key: string, callback: (oldValue: unknown, newValue: unknown) => void): Promise<() => void> {
    const listeners = this.eventListeners.get(key) ?? new Set();
    listeners.add(callback);
    this.eventListeners.set(key, listeners);
    normalizeResult(await this.sendRequest('ext.fliwright.riverpod.watch', { provider: key }));
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.eventListeners.delete(key);
        this.sendRequest('ext.fliwright.riverpod.unwatch', { provider: key }).catch(() => {});
      }
    };
  }

  async listProviders(): Promise<ProviderInfo[]> {
    const result = normalizeResult(await this.sendRequest('ext.fliwright.riverpod.list')) as { providers: ProviderInfo[] };
    return result.providers ?? [];
  }

  async status(): Promise<unknown> {
    return normalizeResult(await this.sendRequest('ext.fliwright.riverpod.status'));
  }

  async override(key: string, value: unknown): Promise<void> {
    await this.overrideWithResult(key, value);
  }

  async overrideWithResult(key: string, value: unknown): Promise<unknown> {
    return normalizeResult(await this.sendRequest('ext.fliwright.riverpod.override', { provider: key, value: JSON.stringify(value) }));
  }

  handleEvent(providerKey: string, oldValue: unknown, newValue: unknown): void {
    const listeners = this.eventListeners.get(providerKey);
    if (listeners) { for (const cb of listeners) { cb(oldValue, newValue); } }
  }
}

function normalizeResult(result: unknown): unknown {
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === 'string' && error.length > 0) {
      throw new Error(error);
    }
  }
  return result;
}
