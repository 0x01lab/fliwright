import type { RunResult, FailureEntry } from './types.js';
import { MockRuleStore, type FliwrightDriver } from '@fliwright/core';

export interface ServerState {
  getLastRunResult(): RunResult | null;
  setLastRunResult(result: RunResult): void;
  getLastFailures(): FailureEntry[];
  setLastFailures(failures: FailureEntry[]): void;
  getFailuresByTestName(testName?: string): FailureEntry[];
  getVmServiceUrl(): string | null;
  setVmServiceUrl(url: string): void;
  getRuleStore(): MockRuleStore;
  // ── Persistent Driver for MCP interaction tools ──
  getDriver(): FliwrightDriver | null;
  setDriver(driver: FliwrightDriver | null): void;
}

export function createServerState(): ServerState {
  let lastRunResult: RunResult | null = null;
  let lastFailures: FailureEntry[] = [];
  let vmServiceUrl: string | null = null;
  const ruleStore = new MockRuleStore();
  let driver: FliwrightDriver | null = null;

  return {
    getLastRunResult() { return lastRunResult; },
    setLastRunResult(result: RunResult) { lastRunResult = result; },
    getLastFailures() { return lastFailures; },
    setLastFailures(failures: FailureEntry[]) { lastFailures = failures; },
    getFailuresByTestName(testName?: string): FailureEntry[] {
      if (!testName) return lastFailures;
      return lastFailures.filter((f) => f.testName === testName);
    },
    getVmServiceUrl() { return vmServiceUrl; },
    setVmServiceUrl(url: string) { vmServiceUrl = url; },
    getRuleStore(): MockRuleStore { return ruleStore; },
    getDriver(): FliwrightDriver | null { return driver; },
    setDriver(d: FliwrightDriver | null) { driver = d; },
  };
}
