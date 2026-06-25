import type { ResetAdapter, ResetContext } from './BaselineManager.js';

/**
 * Built-in reset adapter for the `'storage'` category (design §6.5, Gap C).
 *
 * Calls `ext.fliwright.storage.reset` through the driver's optional `storage`
 * facade. Self-degrades to `'unsupported'` when:
 *   - the driver does not expose the `storage` facade (the bridge extension is
 *     absent), or
 *   - the bridge reports the host app did not register a storage-reset handler.
 *
 * Registered as a BaselineManager built-in (alongside navigation and mock), so
 * the unsupported case is surfaced in `ResetReport.unsupported` /
 * `RuntimeSnapshot.unsupportedState` rather than thrown. See design §11.
 */
export const StorageResetAdapter: ResetAdapter = {
  category: 'storage',
  async reset(ctx: ResetContext): Promise<'ok' | 'skipped' | 'unsupported'> {
    const storage = ctx.driver.storage;
    if (!storage) return 'unsupported';

    const seed = ctx.scenario.storageSeed;
    const outcome = await storage.reset(seed);
    return outcome.status === 'ok' ? 'ok' : 'unsupported';
  },
};
