/**
 * Integration test: Self-Healing Pipeline
 *
 * Exercises the full data flow:
 *   Assertion → SelfHealingEngine → SnapshotStore → MultiDimensionalHealingStrategy → Protocol
 *
 * Note: Locator._resolve() delegates selector matching to the Dart bridge, so we cannot
 * simulate "selector doesn't match" in pure TypeScript. Instead, we test healing directly
 * through SelfHealingEngine.tryHeal() with realistic snapshots.
 */
import { describe, it, expect } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { AssertionError } from '../src/Assertion.js';
import { Locator } from '../src/Locator.js';
import { SelfHealingEngine } from '../src/SelfHealingEngine.js';
import { SnapshotStore } from '../src/SnapshotStore.js';
import { MultiDimensionalHealingStrategy } from '../src/strategies/MultiDimensionalHealingStrategy.js';
import { createProtocolMock } from './helpers/mockVMService.js';
import type { WidgetInfo, WidgetSnapshot } from '../src/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Snapshots with description field (used by textScore for n-gram similarity)
const ORIGINAL_SNAPSHOT: WidgetSnapshot = {
  type: 'ElevatedButton',
  text: 'Submit',
  parentType: 'Scaffold',
  adjacentText: ['Title', 'Cancel'],
  rect: { x: 10, y: 20, width: 100, height: 40 },
  callbackNames: ['onPressed'],
  description: "text='Submit'",
};

const CHANGED_SNAPSHOT: WidgetSnapshot = {
  type: 'ElevatedButton',
  text: 'Submit Form',
  parentType: 'Scaffold',
  adjacentText: ['Title', 'Cancel'],
  rect: { x: 10, y: 20, width: 100, height: 40 },
  callbackNames: ['onPressed'],
  description: "text='Submit Form'",
};

function createTempStore(): SnapshotStore {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-heal-test-'));
  return new SnapshotStore(tmpDir);
}

describe('Self-Healing Pipeline Integration', () => {
  it('full healing cycle: record snapshot → heal with changed text → pass', async () => {
    const store = createTempStore();
    const strategy = new MultiDimensionalHealingStrategy();
    const engine = new SelfHealingEngine(store, strategy);

    const sendRequest = (_m: string, _p?: Record<string, unknown>) => Promise.resolve({});
    const locator = new Locator({ text: 'Submit' }, sendRequest);

    // Phase 1: Record success snapshot
    await engine.recordSuccess(locator, 'heal-test', async () => [ORIGINAL_SNAPSHOT]);

    // Verify snapshot was persisted
    const loaded = store.load('heal-test', 'text=Submit');
    expect(loaded).not.toBeNull();
    expect(loaded!.type).toBe('ElevatedButton');

    // Phase 2: Try to heal with changed widget
    const result = await engine.tryHeal(
      locator,
      'heal-test',
      {
        assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
        screenshot: null,
        widgetTree: {},
        source: { file: '', line: 0, snippet: '' },
        timestamp: new Date().toISOString(),
      },
      async () => [CHANGED_SNAPSHOT],
    );

    expect(result.healed).toBe(true);
    expect(result.report).toBeDefined();
    expect(result.report!.originalSelector).toBe('text=Submit');
    expect(result.report!.suggestedSelector).toBe('text=Submit Form');
    expect(result.report!.confidence).toBeGreaterThan(0.85);
    expect(result.report!.scores).toBeDefined();
    expect(result.report!.scores.position).toBeCloseTo(1.0, 1);
    expect(result.report!.scores.context).toBeCloseTo(1.0, 1);
    expect(result.report!.scores.codeBinding).toBe(1.0);
    expect(result.report!.scores.text).toBeGreaterThan(0);
    expect(result.report!.scores.weighted).toBeGreaterThan(0.85);

    // Verify report is retrievable
    const reports = engine.getReports('heal-test');
    expect(reports).toHaveLength(1);
    expect(reports[0].suggestedSelector).toBe('text=Submit Form');
  });

  it('does not attempt healing when disabled', async () => {
    const store = createTempStore();
    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    engine.setEnabled(false);

    const sendRequest = (_m: string, _p?: Record<string, unknown>) => Promise.resolve({});
    const locator = new Locator({ text: 'Missing' }, sendRequest);

    // Record a snapshot first
    await engine.recordSuccess(locator, 'disabled-test', async () => [ORIGINAL_SNAPSHOT]);

    // Try to heal — should return false immediately
    const result = await engine.tryHeal(
      locator,
      'disabled-test',
      {
        assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
        screenshot: null,
        widgetTree: {},
        source: { file: '', line: 0, snippet: '' },
        timestamp: new Date().toISOString(),
      },
      async () => [CHANGED_SNAPSHOT],
    );

    expect(result.healed).toBe(false);
    expect(result.report).toBeUndefined();

    const reports = engine.getReports('disabled-test');
    expect(reports).toHaveLength(0);
  });

  it('healing fails when no stored snapshot exists', async () => {
    const store = createTempStore();
    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());

    const sendRequest = (_m: string, _p?: Record<string, unknown>) => Promise.resolve({});
    const locator = new Locator({ text: 'NoSnapshot' }, sendRequest);

    const result = await engine.tryHeal(
      locator,
      'no-snapshot-test',
      {
        assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
        screenshot: null,
        widgetTree: {},
        source: { file: '', line: 0, snippet: '' },
        timestamp: new Date().toISOString(),
      },
      async () => [CHANGED_SNAPSHOT],
    );

    expect(result.healed).toBe(false);
  });

  it('healing report has correct structure', async () => {
    const store = createTempStore();
    const strategy = new MultiDimensionalHealingStrategy();
    const engine = new SelfHealingEngine(store, strategy);

    const sendRequest = (_m: string, _p?: Record<string, unknown>) => Promise.resolve({});
    const locator = new Locator({ text: 'Submit' }, sendRequest);

    await engine.recordSuccess(locator, 'struct-test', async () => [ORIGINAL_SNAPSHOT]);

    await engine.tryHeal(
      locator,
      'struct-test',
      {
        assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
        screenshot: null,
        widgetTree: {},
        source: { file: '', line: 0, snippet: '' },
        timestamp: new Date().toISOString(),
      },
      async () => [CHANGED_SNAPSHOT],
    );

    const reports = engine.getReports('struct-test');
    expect(reports).toHaveLength(1);

    const report = reports[0];
    expect(report.testName).toBe('struct-test');
    expect(report.originalSelector).toBe('text=Submit');
    expect(report.suggestedSelector).toBeDefined();
    expect(report.confidence).toBeGreaterThan(0);
    expect(report.scores).toHaveProperty('position');
    expect(report.scores).toHaveProperty('context');
    expect(report.scores).toHaveProperty('codeBinding');
    expect(report.scores).toHaveProperty('text');
    expect(report.scores).toHaveProperty('weighted');
    expect(report.originalSnapshot).toBeDefined();
    expect(report.matchedWidget).toBeDefined();
    expect(report.timestamp).toBeDefined();
  });
});
