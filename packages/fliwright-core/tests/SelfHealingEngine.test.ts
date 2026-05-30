import { describe, it, expect, beforeEach } from 'vitest';
import { SelfHealingEngine } from '../src/SelfHealingEngine.js';
import { SnapshotStore } from '../src/SnapshotStore.js';
import { MultiDimensionalHealingStrategy } from '../src/strategies/MultiDimensionalHealingStrategy.js';
import type { WidgetSnapshot, FailureContext } from '../src/types.js';
import type { Locator } from '../src/Locator.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-healing-'));
});

function createMockLocator(selectorString: string): Locator {
  return { selectorString } as unknown as Locator;
}

const storedSnapshot: WidgetSnapshot = {
  type: 'ElevatedButton',
  parentType: 'Column',
  adjacentText: ['User', 'Pass'],
  rect: { x: 100, y: 400, width: 200, height: 48 },
  callbackNames: ['_onConfirm'],
  description: "ElevatedButton with text '确认支付', parent Column, adjacent [User, Pass]",
};

const candidateWidgets: WidgetSnapshot[] = [
  {
    type: 'ElevatedButton',
    parentType: 'Column',
    adjacentText: ['User', 'Pass'],
    rect: { x: 102, y: 401, width: 198, height: 47 },
    callbackNames: ['_onConfirm'],
    description: "ElevatedButton with text '去结算', parent Column, adjacent [User, Pass]",
  },
];

const failureContext: FailureContext = {
  assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'visible=false', timeout: 5000 },
  screenshot: null,
  widgetTree: {},
  source: { file: 'test.ts', line: 10, snippet: 'expect(locator).toBeVisible()' },
  timestamp: new Date().toISOString(),
};

describe('SelfHealingEngine', () => {
  it('setEnabled toggles healing', () => {
    const engine = new SelfHealingEngine(new SnapshotStore(tmpDir), new MultiDimensionalHealingStrategy());
    expect(engine.enabled).toBe(true);
    engine.setEnabled(false);
    expect(engine.enabled).toBe(false);
  });

  it('tryHeal returns healed=false when no stored snapshot', async () => {
    const store = new SnapshotStore(tmpDir);
    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const locator = createMockLocator('text=确认支付');
    const result = await engine.tryHeal(locator, 'test1', failureContext, async () => candidateWidgets);
    expect(result.healed).toBe(false);
  });

  it('tryHeal returns healed=true when match found', async () => {
    const store = new SnapshotStore(tmpDir);
    await store.save('test1', 'text=确认支付', storedSnapshot);

    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const locator = createMockLocator('text=确认支付');
    const result = await engine.tryHeal(locator, 'test1', failureContext, async () => candidateWidgets);
    expect(result.healed).toBe(true);
    expect(result.report).toBeDefined();
    expect(result.report!.confidence).toBeGreaterThan(0);
    expect(result.report!.suggestedSelector).toBeTruthy();
  });

  it('tryHeal returns healed=false when disabled', async () => {
    const store = new SnapshotStore(tmpDir);
    await store.save('test1', 'text=确认支付', storedSnapshot);

    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    engine.setEnabled(false);
    const locator = createMockLocator('text=确认支付');
    const result = await engine.tryHeal(locator, 'test1', failureContext, async () => candidateWidgets);
    expect(result.healed).toBe(false);
  });

  it('getReports returns accumulated reports', async () => {
    const store = new SnapshotStore(tmpDir);
    await store.save('test1', 'text=确认支付', storedSnapshot);

    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const locator = createMockLocator('text=确认支付');
    await engine.tryHeal(locator, 'test1', failureContext, async () => candidateWidgets);

    const reports = engine.getReports();
    expect(reports.length).toBe(1);
    expect(reports[0].testName).toBe('test1');
  });

  it('getReports filters by test name', async () => {
    const store = new SnapshotStore(tmpDir);
    await store.save('test1', 'text=确认支付', storedSnapshot);

    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const reports = engine.getReports('other');
    expect(reports.length).toBe(0);
  });

  it('recordSuccess saves snapshot from fetched widget data', async () => {
    const store = new SnapshotStore(tmpDir);
    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const locator = createMockLocator('text=确认支付');

    const fetchedWidget: WidgetSnapshot = {
      type: 'ElevatedButton',
      parentType: 'Column',
      adjacentText: ['User'],
      rect: { x: 50, y: 200, width: 100, height: 40 },
      callbackNames: ['_onTap'],
      description: "ElevatedButton with text '确认支付', parent Column, adjacent [User]",
    };

    await engine.recordSuccess(locator, 'test2', async () => fetchedWidget);
    const loaded = store.load('test2', 'text=确认支付');
    expect(loaded).not.toBeNull();
    expect(loaded!.type).toBe('ElevatedButton');
  });
});
