import { SnapshotStore } from './SnapshotStore.js';
import type { HealingStrategy } from './interfaces/HealingStrategy.js';
import type { WidgetSnapshot, HealingReport, FailureContext } from './types.js';
import type { Locator } from './Locator.js';

type FetchSnapshot = () => Promise<WidgetSnapshot | WidgetSnapshot[]>;

export class SelfHealingEngine {
  private store: SnapshotStore;
  private strategy: HealingStrategy;
  private _enabled = true;
  private reports: HealingReport[] = [];

  constructor(store: SnapshotStore, strategy: HealingStrategy) {
    this.store = store;
    this.strategy = strategy;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  async recordSuccess(
    locator: Locator,
    testName: string,
    fetchSnapshot: FetchSnapshot,
  ): Promise<void> {
    const snapshot = await fetchSnapshot();
    const widgetSnapshot: WidgetSnapshot = Array.isArray(snapshot)
      ? snapshot[0]
      : snapshot;
    if (!widgetSnapshot) return;
    await this.store.save(testName, locator.selectorString, widgetSnapshot);
  }

  async tryHeal(
    locator: Locator,
    testName: string,
    failure: FailureContext,
    fetchCandidates: () => Promise<WidgetSnapshot[]>,
  ): Promise<{ healed: boolean; report?: HealingReport }> {
    if (!this._enabled) return { healed: false };

    const stored = this.store.load(testName, locator.selectorString);
    if (!stored) return { healed: false };

    const candidates = await fetchCandidates();
    if (candidates.length === 0) return { healed: false };

    const result = this.strategy.heal(stored, candidates);
    if (!result) return { healed: false };

    const report: HealingReport = {
      testName,
      originalSelector: locator.selectorString,
      suggestedSelector: result.suggestedSelector,
      confidence: result.confidence,
      scores: {
        position: 0,
        context: 0,
        codeBinding: 0,
        text: 0,
        weighted: result.confidence,
      },
      originalSnapshot: stored,
      matchedWidget: result.matchedWidget,
      timestamp: new Date().toISOString(),
    };

    this.reports.push(report);
    return { healed: true, report };
  }

  getReports(testName?: string): HealingReport[] {
    if (!testName) return [...this.reports];
    return this.reports.filter((r) => r.testName === testName);
  }
}
