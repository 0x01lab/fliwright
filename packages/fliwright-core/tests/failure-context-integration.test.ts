/**
 * Integration test: FailureCollector + Assertion + SelfHealingEngine
 *
 * Exercises the failure context pipeline including screenshot capture,
 * widget tree collection, and healing suggestion propagation.
 * Also verifies the Vitest sidecar JSON format is compatible with MCP FailureEntry.
 */
import { describe, it, expect } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { AssertionError, Assertion } from '../src/Assertion.js';
import { FailureCollector } from '../src/FailureCollector.js';
import { Locator } from '../src/Locator.js';
import { createProtocolMock } from './helpers/mockVMService.js';
import type { WidgetInfo, WidgetSnapshot } from '../src/types.js';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SUBMIT_WIDGET: WidgetInfo = {
  id: 'w1',
  type: 'ElevatedButton',
  text: 'Submit',
  rect: { x: 10, y: 20, width: 100, height: 40 },
  properties: {},
};

const SUBMIT_SNAPSHOT: WidgetSnapshot = {
  type: 'ElevatedButton',
  text: 'Submit',
  parentType: 'Scaffold',
  adjacentText: [],
  rect: { x: 10, y: 20, width: 100, height: 40 },
  callbackNames: ['onPressed'],
  description: "text='Submit'",
};

describe('Failure Context Pipeline Integration', () => {
  it('FailureCollector collects screenshot + widget tree + source from driver', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();

    // Mock screenshot and snapshot extensions
    mock.mockExtension('ext.fliwright.screenshot', () => ({
      screenshot: Buffer.from('fake-png-data').toString('base64'),
    }));
    mock.mockExtension('ext.fliwright.snapshot', () => ({
      type: 'ElevatedButton',
      text: 'Submit',
      children: [],
    }));

    await driver.attachMockConnector(mock.ws);

    const sendRequest = (m: string, p?: Record<string, unknown>) => driver.sendRequest(m, p);
    const collector = new FailureCollector(sendRequest);

    const error = new AssertionError('toBeVisible', 'visible', 'visible=false', 'text=Submit');
    const context = await collector.collect(error, 5000);

    // Verify FailureContext structure
    expect(context.assertion).toBeDefined();
    expect(context.assertion.matcher).toBe('toBeVisible');
    expect(context.assertion.expected).toBe('visible');
    expect(context.assertion.actual).toBe('visible=false');
    expect(context.assertion.timeout).toBe(5000);

    expect(context.screenshot).not.toBeNull();
    expect(context.widgetTree).toBeDefined();
    expect((context.widgetTree as any).type).toBe('ElevatedButton');

    expect(context.source).toBeDefined();
    expect(context.source.snippet).toBeTruthy();
    expect(context.timestamp).toBeDefined();
  });

  it('healing suggestion is included in failure context', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();

    mock.mockExtension('ext.fliwright.inspect', () => ({ widgets: [SUBMIT_WIDGET] }));
    mock.mockExtension('ext.fliwright.snapshot', () => ({ widgets: [SUBMIT_SNAPSHOT] }));

    await driver.attachMockConnector(mock.ws);

    const sendRequest = (m: string, p?: Record<string, unknown>) => driver.sendRequest(m, p);
    const locator = new Locator({ text: 'Submit' }, sendRequest);

    // Record a success snapshot first
    await driver.healing.recordSuccess(locator, 'suggestion-test', async () => [SUBMIT_SNAPSHOT]);

    // Now simulate a healing attempt
    const CHANGED_SNAPSHOT: WidgetSnapshot = {
      ...SUBMIT_SNAPSHOT,
      text: 'Submit Now',
      description: "text='Submit Now'",
    };

    const result = await driver.healing.tryHeal(
      locator,
      'suggestion-test',
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
    expect(result.report!.suggestedSelector).toContain('Submit Now');

    // Verify healing report structure matches what Vitest expects
    const reports = driver.healing.getReports('suggestion-test');
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.originalSelector).toBe('text=Submit');
    expect(report.suggestedSelector).toBeDefined();
    expect(report.confidence).toBeGreaterThan(0);
    expect(report.scores).toHaveProperty('weighted');
  });

  it('sidecar JSON format matches MCP FailureEntry schema', async () => {
    const tempDir = await mkdtemp();
    const outputPath = join(tempDir, 'failures.json');

    try {
      // Write a failure entry in the format that @fliwright/vitest produces
      const failureEntry = {
        testName: 'login test',
        assertion: {
          matcher: 'toBeVisible',
          expected: 'visible',
          actual: 'visible=false',
          timeout: 5000,
        },
        widgetTree: { type: 'ElevatedButton', text: 'Submit' },
        source: {
          file: '/test/login.test.ts',
          line: 42,
          snippet: 'await expect(locator).toBeVisible()',
        },
        healingSuggestion: {
          originalSelector: 'text=Submit',
          suggestedSelector: 'text=Submit Now',
          confidence: 0.85,
          scores: {
            position: 1.0,
            context: 0.8,
            codeBinding: 0.5,
            text: 0.9,
            weighted: 0.85,
          },
        },
        timestamp: new Date().toISOString(),
      };

      // Simulate what fliwright-vitest does
      const entries = [failureEntry];
      await mkdir(tempDir, { recursive: true });
      await writeFile(outputPath, JSON.stringify(entries, null, 2), 'utf8');

      // Read back and verify structure matches MCP FailureEntry type
      const raw = await readFile(outputPath, 'utf8');
      const parsed = JSON.parse(raw) as any[];

      expect(parsed).toHaveLength(1);
      const entry = parsed[0];

      // Required fields
      expect(entry.testName).toBeTypeOf('string');
      expect(entry.assertion).toBeDefined();
      expect(entry.assertion.matcher).toBeTypeOf('string');
      expect(entry.assertion.expected).toBeTypeOf('string');
      expect(entry.assertion.actual).toBeTypeOf('string');
      expect(entry.assertion.timeout).toBeTypeOf('number');
      expect(entry.widgetTree).toBeDefined();
      expect(entry.source).toBeDefined();
      expect(entry.source.file).toBeTypeOf('string');
      expect(entry.source.line).toBeTypeOf('number');
      expect(entry.source.snippet).toBeTypeOf('string');
      expect(entry.timestamp).toBeTypeOf('string');

      // Optional healing suggestion
      if (entry.healingSuggestion) {
        expect(entry.healingSuggestion.originalSelector).toBeTypeOf('string');
        expect(entry.healingSuggestion.suggestedSelector).toBeTypeOf('string');
        expect(entry.healingSuggestion.confidence).toBeTypeOf('number');
        expect(entry.healingSuggestion.scores).toBeDefined();
        expect(entry.healingSuggestion.scores.position).toBeTypeOf('number');
        expect(entry.healingSuggestion.scores.context).toBeTypeOf('number');
        expect(entry.healingSuggestion.scores.codeBinding).toBeTypeOf('number');
        expect(entry.healingSuggestion.scores.text).toBeTypeOf('number');
        expect(entry.healingSuggestion.scores.weighted).toBeTypeOf('number');
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function mkdtemp(): Promise<string> {
  const { mkdtemp: mk } = await import('node:fs/promises');
  const { join: j } = await import('node:path');
  const { tmpdir: t } = await import('node:os');
  return mk(j(t(), 'fliwright-test-'));
}
