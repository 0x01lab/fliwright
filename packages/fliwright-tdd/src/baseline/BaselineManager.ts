import type { ResetAdapterResult, ResetCategory, ResetReport, Scenario } from '../types.js';
import { StorageResetAdapter } from './StorageResetAdapter.js';

export interface ResetContext {
  driver: {
    page: {
      resetToHome(options?: { homeRoute?: string }): Promise<void>;
    };
    mock: {
      clear(): Promise<void>;
      clearCalls(): Promise<void>;
    };
    /**
     * Optional bridge facade for `ext.fliwright.storage.reset`. Absent when the
     * bridge does not expose the extension; the built-in {@link StorageResetAdapter}
     * self-degrades to `'unsupported'` in that case (design §6.5 / §11).
     */
    storage?: {
      reset(seed?: Record<string, unknown>): Promise<StorageResetOutcome>;
    };
  };
  scenario: Scenario;
  full: boolean;
}

/** Result of a `ext.fliwright.storage.reset` call surfaced through the driver. */
export type StorageResetOutcome =
  | { status: 'ok'; clearedKeys?: number; seededKeys?: number }
  | { status: 'unsupported' };

export interface ResetAdapter {
  category: ResetCategory;
  reset(ctx: ResetContext): Promise<'ok' | 'skipped' | 'unsupported' | ResetAdapterResult>;
}

export class BaselineManager {
  private readonly adapters = new Map<ResetCategory, ResetAdapter>();
  private baselineVersion = 0;

  constructor(private readonly driver: ResetContext['driver']) {
    this.registerAdapter({
      category: 'navigation',
      reset: async ({ driver: runtimeDriver, scenario }) => {
        await runtimeDriver.page.resetToHome({ homeRoute: scenario.homeRoute });
        return 'ok';
      },
    });
    this.registerAdapter({
      category: 'mock',
      reset: async ({ driver: runtimeDriver }) => {
        await runtimeDriver.mock.clear();
        await runtimeDriver.mock.clearCalls();
        return 'ok';
      },
    });
    // Self-degrading built-in: returns 'unsupported' (surfaced in
    // ResetReport.unsupported) when the bridge storage.reset extension is
    // absent. Design §6.5 / §11.
    this.registerAdapter(StorageResetAdapter);
  }

  get version(): number {
    return this.baselineVersion;
  }

  registerAdapter(adapter: ResetAdapter): void {
    this.adapters.set(adapter.category, adapter);
  }

  async reset(scenario: Scenario, opts: { full?: boolean } = {}): Promise<ResetReport> {
    const full = opts.full ?? false;
    const results: ResetAdapterResult[] = [];

    for (const category of scenario.resetCategories) {
      const adapter = this.adapters.get(category);
      if (!adapter) {
        results.push({ category, status: 'unsupported', message: `No reset adapter registered for ${category}` });
        continue;
      }

      try {
        const result = await adapter.reset({ driver: this.driver, scenario, full });
        results.push(typeof result === 'string' ? { category, status: result } : result);
      } catch (error) {
        results.push({
          category,
          status: 'unsupported',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.baselineVersion += 1;
    return {
      version: this.baselineVersion,
      full,
      results,
      unsupported: results
        .filter((result) => result.status === 'unsupported')
        .map((result) => result.category),
    };
  }
}
