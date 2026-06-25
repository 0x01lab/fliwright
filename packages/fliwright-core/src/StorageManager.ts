import type { SendRequest } from './types.js';

/** Outcome of a storage reset via `ext.fliwright.storage.reset`. */
export interface StorageResetResult {
  status: 'ok' | 'unsupported';
  clearedKeys?: number;
  seededKeys?: number;
  message?: string;
}

/**
 * Drives the optional `ext.fliwright.storage.reset` bridge extension
 * (determinism Gap C). Calls degrade to `status: 'unsupported'` when the bridge
 * reports the host app did not register a storage-reset handler, or when the
 * extension itself is absent (sendRequest rejects / returns no `success` field).
 */
export class StorageManager {
  constructor(private sendRequest: SendRequest) {}

  /**
   * Clear app storage and optionally seed it.
   *
   * @param seed key/value map written into storage after the clear.
   */
  async reset(seed: Record<string, unknown> = {}): Promise<StorageResetResult> {
    let result: Record<string, unknown>;
    try {
      result = (await this.sendRequest('ext.fliwright.storage.reset', {
        seed: JSON.stringify(seed),
      })) as Record<string, unknown>;
    } catch {
      // Extension absent (older bridge) — degrade gracefully.
      return { status: 'unsupported', message: 'storage.reset extension not available' };
    }

    if (result.success !== true) {
      return {
        status: 'unsupported',
        message: typeof result.message === 'string' ? result.message : 'storage.reset reported failure',
      };
    }

    return {
      status: 'ok',
      clearedKeys: typeof result.clearedKeys === 'number' ? result.clearedKeys : undefined,
      seededKeys: typeof result.seededKeys === 'number' ? result.seededKeys : undefined,
    };
  }
}
