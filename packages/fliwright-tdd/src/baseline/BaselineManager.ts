import type { ResetAdapterResult, ResetCategory, ResetReport, Scenario } from '../types.js';
import { AppCapabilityResetAdapters } from './AppCapabilityResetAdapter.js';
import { StorageBackedResetAdapters } from './StorageResetAdapter.js';

export interface ResetContext {
  driver: {
    page: {
      resetToHome(options?: { homeRoute?: string }): Promise<void>;
    };
    mock: {
      clear(): Promise<void>;
      clearCalls(): Promise<void>;
      loadRules?(mockDir?: string): Promise<void>;
      listRules?(): Array<{
        endpoint: string;
        method: string;
        rules: string[];
        activeRule: string;
      }>;
      switchRule?(endpoint: string, ruleName: string, method?: string): Promise<void>;
    };
    state?: {
      override(key: string, value: unknown): Promise<void>;
    };
    /**
     * Optional bridge facade for `ext.fliwright.storage.reset`. Absent when the
     * bridge does not expose the extension; the built-in {@link StorageResetAdapter}
     * self-degrades to `'unsupported'` in that case (design §6.5 / §11).
     */
    storage?: {
      reset(seed?: Record<string, unknown>): Promise<StorageResetOutcome>;
    };
    app?: {
      hasCapability?(name: string): Promise<boolean>;
      listCapabilities?(): Promise<Array<{ name: string; methods: string[] }>>;
      invoke(capability: string, method: string, input?: unknown): Promise<unknown>;
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
      reset: async ({ driver: runtimeDriver, scenario }) => {
        await runtimeDriver.mock.clear();
        await runtimeDriver.mock.clearCalls();
        if (scenario.mockProfile) {
          const profileResult = await applyMockProfile(runtimeDriver.mock, scenario.mockProfile, scenario.mockDir);
          if (profileResult) return profileResult;
        }
        return 'ok';
      },
    });
    this.registerAdapter({
      category: 'riverpod',
      reset: async ({ driver: runtimeDriver, scenario }) => {
        const overrides = scenario.riverpodOverrides ?? [];
        if (overrides.length === 0) return 'skipped';
        if (!runtimeDriver.state) {
          return {
            category: 'riverpod',
            status: 'unsupported',
            message: 'Driver exposes no Riverpod state adapter.',
          };
        }

        for (const [index, override] of overrides.entries()) {
          const normalized = normalizeRiverpodOverride(override);
          if (!normalized) {
            return {
              category: 'riverpod',
              status: 'unsupported',
              message: `Invalid riverpodOverrides[${index}]; expected { provider | key, value }.`,
            };
          }
          await runtimeDriver.state.override(normalized.key, normalized.value);
        }
        return 'ok';
      },
    });
    // Self-degrading built-ins: return 'unsupported' (surfaced in ResetReport.unsupported) when the
    // bridge storage.reset extension is absent. Design §6.5 / §11.
    for (const adapter of StorageBackedResetAdapters) {
      this.registerAdapter(adapter);
    }
    for (const adapter of AppCapabilityResetAdapters) {
      this.registerAdapter(adapter);
    }
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

function normalizeRiverpodOverride(value: unknown): { key: string; value: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const key = typeof record.provider === 'string'
    ? record.provider
    : typeof record.key === 'string'
      ? record.key
      : undefined;
  if (!key) return null;
  if (!Object.prototype.hasOwnProperty.call(record, 'value')) return null;
  return { key, value: record.value };
}

async function applyMockProfile(
  mock: ResetContext['driver']['mock'],
  profile: string,
  mockDir: string | undefined,
): Promise<ResetAdapterResult | null> {
  if (!mock.loadRules || !mock.listRules || !mock.switchRule) {
    return {
      category: 'mock',
      status: 'unsupported',
      message: 'Driver mock adapter does not support rule profiles.',
    };
  }

  await mock.loadRules(mockDir);
  const endpoints = mock.listRules();
  const matching = endpoints.filter((endpoint) => endpoint.rules.includes(profile));
  if (matching.length === 0) {
    return {
      category: 'mock',
      status: 'unsupported',
      message: `Mock profile '${profile}' was not found in loaded mock rules.`,
    };
  }

  for (const endpoint of matching) {
    await mock.switchRule(endpoint.endpoint, profile, endpoint.method);
  }
  return null;
}
