import type { StateAdapter } from '@fliwright/core';
import type { ProviderInfo } from '@fliwright/core';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class RiverpodStateAdapter implements StateAdapter {
  private eventListeners = new Map<string, Set<(oldVal: unknown, newVal: unknown) => void>>();

  constructor(
    private sendRequest: SendRequest,
  ) {}

  async read(key: string): Promise<unknown> {
    const result = (await this.sendRequest('ext.fliwright.riverpod.read', { provider: key })) as { value: unknown };
    return result.value;
  }

  async write(key: string, value: unknown): Promise<void> {
    await this.sendRequest('ext.fliwright.riverpod.override', { provider: key, value: JSON.stringify(value) });
  }

  async watch(key: string, callback: (oldValue: unknown, newValue: unknown) => void): Promise<() => void> {
    const listeners = this.eventListeners.get(key) ?? new Set();
    listeners.add(callback);
    this.eventListeners.set(key, listeners);
    await this.sendRequest('ext.fliwright.riverpod.watch', { provider: key });
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.eventListeners.delete(key);
        this.sendRequest('ext.fliwright.riverpod.unwatch', { provider: key }).catch(() => {});
      }
    };
  }

  async listProviders(): Promise<ProviderInfo[]> {
    const result = (await this.sendRequest('ext.fliwright.riverpod.list')) as { providers: ProviderInfo[] };
    return result.providers ?? [];
  }

  async override(key: string, value: unknown): Promise<void> {
    await this.sendRequest('ext.fliwright.riverpod.override', { provider: key, value: JSON.stringify(value) });
  }

  handleEvent(providerKey: string, oldValue: unknown, newValue: unknown): void {
    const listeners = this.eventListeners.get(providerKey);
    if (listeners) { for (const cb of listeners) { cb(oldValue, newValue); } }
  }
}
