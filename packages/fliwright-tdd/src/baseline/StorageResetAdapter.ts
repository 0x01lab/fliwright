import type { ResetAdapter, ResetContext } from './BaselineManager.js';
import type { ResetCategory } from '../types.js';

/**
 * Built-in reset adapters for storage-backed categories (design §6.5, Gap C).
 *
 * Calls `ext.fliwright.storage.reset` through the driver's optional `storage`
 * facade. Self-degrades to `'unsupported'` when:
 *   - the driver does not expose the `storage` facade (the bridge extension is
 *     absent), or
 *   - the bridge reports the host app did not register a storage-reset handler.
 *
 * Registered as BaselineManager built-ins (alongside navigation and mock), so the unsupported case
 * is surfaced in `ResetReport.unsupported` / `RuntimeSnapshot.unsupportedState` rather than thrown.
 * See design §11.
 */
export const StorageResetAdapter = createStorageBackedResetAdapter('storage');
export const AuthTokensResetAdapter = createStorageBackedResetAdapter('authTokens');
export const SecureStorageResetAdapter = createStorageBackedResetAdapter('secureStorage');
export const LocalDbResetAdapter = createStorageBackedResetAdapter('localDb');

function createStorageBackedResetAdapter(category: StorageBackedResetCategory): ResetAdapter {
  return {
    category,
    async reset(ctx: ResetContext): Promise<'ok' | 'skipped' | 'unsupported'> {
      const storage = ctx.driver.storage;
      if (!storage) return 'unsupported';

      const outcome = await storage.reset(seedForCategory(category, ctx.scenario.storageSeed));
      return outcome.status === 'ok' ? 'ok' : 'unsupported';
    },
  };
}

type StorageBackedResetCategory = Extract<ResetCategory, 'storage' | 'authTokens' | 'secureStorage' | 'localDb'>;

function seedForCategory(
  category: StorageBackedResetCategory,
  storageSeed: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (category === 'storage') return storageSeed;
  return {
    __fliwrightResetCategory: category,
    ...(storageSeed ? { seed: storageSeed } : {}),
  };
}

export const StorageBackedResetAdapters: ResetAdapter[] = [
  StorageResetAdapter,
  AuthTokensResetAdapter,
  SecureStorageResetAdapter,
  LocalDbResetAdapter,
];
