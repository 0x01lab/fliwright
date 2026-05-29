import type { ProviderInfo } from '../types.js';

export interface StateAdapter {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  watch(key: string, callback: (oldValue: unknown, newValue: unknown) => void): Promise<() => void>;
  listProviders(): Promise<ProviderInfo[]>;
  override(key: string, value: unknown): Promise<void>;
}
