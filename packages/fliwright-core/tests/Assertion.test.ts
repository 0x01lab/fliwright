import { describe, it, expect, vi } from 'vitest';
import { Assertion, AssertionError, createExpect } from '../src/Assertion.js';
import { FliwrightAgentError } from '../src/agent/FliwrightAgentError.js';
import { SelfHealingEngine } from '../src/SelfHealingEngine.js';
import { SnapshotStore } from '../src/SnapshotStore.js';
import { MultiDimensionalHealingStrategy } from '../src/strategies/MultiDimensionalHealingStrategy.js';
import { TimelineRecorder } from '../src/timeline/TimelineRecorder.js';
import type { Locator } from '../src/Locator.js';
import type { WidgetInfo, WidgetSnapshot } from '../src/types.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const testWidget: WidgetInfo = {
  id: '42',
  type: 'ElevatedButton',
  text: 'Hello World',
  key: 'btn',
  rect: { x: 0, y: 0, width: 100, height: 40 },
  properties: { enabled: true },
};

function createMockLocator(
  visible: boolean,
  text?: string,
  enabled?: boolean,
  properties?: Record<string, unknown>,
): Locator {
  const widget: WidgetInfo = {
    ...testWidget,
    text: text ?? testWidget.text,
    properties: { enabled: enabled ?? true, ...properties },
  };
  // If not visible, resolve no widget.
  const widgets = visible ? [widget] : [];

  return {
    isVisible: vi.fn().mockResolvedValue(visible),
    selectorString: 'text=Test',
    resolve: vi.fn().mockResolvedValue(widgets[0]),
    _resolve: vi.fn().mockResolvedValue(widgets),
  } as unknown as Locator;
}

describe('AssertionError', () => {
  it('formats message correctly', () => {
    const err = new AssertionError('toBeVisible', 'visible', 'visible=false', 'text=Btn');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AssertionError');
    expect(err.message).toBe('toBeVisible failed for "text=Btn": expected visible, got visible=false');
    expect(err.matcher).toBe('toBeVisible');
    expect(err.expected).toBe('visible');
    expect(err.actual).toBe('visible=false');
    expect(err.selector).toBe('text=Btn');
  });
});

describe('createExpect', () => {
  it('returns an Assertion instance', () => {
    const locator = createMockLocator(true);
    const assertion = createExpect(locator);
    expect(assertion).toBeInstanceOf(Assertion);
  });
});

describe('timeline-aware expect', () => {
  it('records passing locator assertions as timeline assertion nodes', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'timeline expect' });
    const locator = createMockLocator(true);

    await createExpect(locator, undefined, {
      title: 'Submit button is visible',
      recorder,
    }).toBeVisible();

    expect(recorder.toJSON().nodes).toContainEqual(expect.objectContaining({
      kind: 'assertion',
      title: 'Submit button is visible',
      status: 'passed',
      metadata: expect.objectContaining({
        matcher: 'toBeVisible',
        target: 'text=Test',
      }),
    }));
  });

  it('wraps failed timeline locator assertions in FliwrightAgentError', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'timeline expect failure' });
    const locator = createMockLocator(false);

    await expect(createExpect(locator, undefined, {
      title: 'Missing button is visible',
      recorder,
    }).toBeVisible({ timeout: 100 })).rejects.toBeInstanceOf(FliwrightAgentError);

    expect(recorder.toJSON().nodes[0]).toMatchObject({
      kind: 'assertion',
      title: 'Missing button is visible',
      status: 'failed',
      error: { code: 'assertion_failed' },
    });
  });
});

describe('toBeVisible', () => {
  it('passes when element is visible', async () => {
    const locator = createMockLocator(true);
    await expect(createExpect(locator).toBeVisible()).resolves.toBeUndefined();
  });

  it('fails when element is not visible', async () => {
    const locator = createMockLocator(false);
    await expect(createExpect(locator).toBeVisible({ timeout: 200 })).rejects.toThrow(AssertionError);
  });

  it('throws with correct matcher info on failure', async () => {
    const locator = createMockLocator(false);
    try {
      await createExpect(locator).toBeVisible({ timeout: 200 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AssertionError);
      const ae = err as AssertionError;
      expect(ae.matcher).toBe('toBeVisible');
      expect(ae.expected).toBe('visible');
      expect(ae.selector).toBe('text=Test');
    }
  });
});

describe('self-healing integration', () => {
  const originalSnapshot: WidgetSnapshot = {
    type: 'ElevatedButton',
    text: 'Confirm',
    parentType: 'Column',
    adjacentText: ['Cart'],
    rect: { x: 100, y: 400, width: 200, height: 48 },
    callbackNames: ['onPressed'],
    description: "ElevatedButton with text 'Confirm', parent Column, adjacent [Cart]",
  };

  const healedSnapshot: WidgetSnapshot = {
    type: 'ElevatedButton',
    text: 'Checkout',
    parentType: 'Column',
    adjacentText: ['Cart'],
    rect: { x: 102, y: 401, width: 198, height: 47 },
    callbackNames: ['onPressed'],
    description: "ElevatedButton with text 'Checkout', parent Column, adjacent [Cart]",
  };

  it('records a baseline on passing visibility assertion and heals a later selector miss', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-assertion-healing-'));
    try {
      const healing = new SelfHealingEngine(
        new SnapshotStore(tmpDir),
        new MultiDimensionalHealingStrategy(),
      );
      const sendRequest = vi.fn()
        .mockResolvedValueOnce({ widgets: [originalSnapshot] })
        .mockResolvedValueOnce({ widgets: [healedSnapshot] })
        .mockResolvedValueOnce({ widgets: [{ ...testWidget, text: 'Checkout' }] });

      await new Assertion(
        createMockLocator(true),
        false,
        undefined,
        healing,
        'checkout flow',
        sendRequest,
      ).toBeVisible({ timeout: 200 });

      const missingLocator = createMockLocator(false);
      await expect(new Assertion(
        missingLocator,
        false,
        undefined,
        healing,
        'checkout flow',
        sendRequest,
      ).toBeVisible({ timeout: 200 })).resolves.toBeUndefined();

      const reports = healing.getReports('checkout flow');
      expect(reports).toHaveLength(1);
      expect(reports[0].originalSelector).toBe('text=Test');
      expect(reports[0].suggestedSelector).toBe('text=Checkout');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not fail a passing assertion when snapshot capture fails', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-assertion-healing-'));
    try {
      const healing = new SelfHealingEngine(
        new SnapshotStore(tmpDir),
        new MultiDimensionalHealingStrategy(),
      );
      const sendRequest = vi.fn().mockRejectedValue(new Error('snapshot unavailable'));

      await expect(new Assertion(
        createMockLocator(true),
        false,
        undefined,
        healing,
        'flaky snapshot',
        sendRequest,
      ).toBeVisible({ timeout: 200 })).resolves.toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('not.toBeVisible', () => {
  it('passes when element is not visible', async () => {
    const locator = createMockLocator(false);
    await expect(createExpect(locator).not.toBeVisible()).resolves.toBeUndefined();
  });

  it('fails when element is visible', async () => {
    const locator = createMockLocator(true);
    await expect(createExpect(locator).not.toBeVisible({ timeout: 200 })).rejects.toThrow(AssertionError);
  });

  it('throws with negated info on failure', async () => {
    const locator = createMockLocator(true);
    try {
      await createExpect(locator).not.toBeVisible({ timeout: 200 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AssertionError);
      const ae = err as AssertionError;
      expect(ae.matcher).toBe('toBeVisible');
      expect(ae.expected).toBe('not visible');
    }
  });
});

describe('toHaveText', () => {
  it('passes with exact text match', async () => {
    const locator = createMockLocator(true, 'Hello');
    await expect(createExpect(locator).toHaveText('Hello')).resolves.toBeUndefined();
  });

  it('fails with wrong text', async () => {
    const locator = createMockLocator(true, 'Hello');
    await expect(createExpect(locator).toHaveText('World', { timeout: 200 })).rejects.toThrow(AssertionError);
  });

  it('includes expected/actual in error', async () => {
    const locator = createMockLocator(true, 'Hello');
    try {
      await createExpect(locator).toHaveText('World', { timeout: 200 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AssertionError);
      const ae = err as AssertionError;
      expect(ae.matcher).toBe('toHaveText');
      expect(ae.expected).toBe('"World"');
      expect(ae.actual).toBe('"Hello"');
    }
  });
});

describe('toContainText', () => {
  it('passes with substring match', async () => {
    const locator = createMockLocator(true, 'Hello World');
    await expect(createExpect(locator).toContainText('World')).resolves.toBeUndefined();
  });

  it('fails when substring not found', async () => {
    const locator = createMockLocator(true, 'Hello');
    await expect(createExpect(locator).toContainText('World', { timeout: 200 })).rejects.toThrow(AssertionError);
  });

  it('includes substring info in error', async () => {
    const locator = createMockLocator(true, 'Hello');
    try {
      await createExpect(locator).toContainText('World', { timeout: 200 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AssertionError);
      const ae = err as AssertionError;
      expect(ae.matcher).toBe('toContainText');
      expect(ae.expected).toBe('containing "World"');
    }
  });
});

describe('toBeEnabled', () => {
  it('passes when enabled', async () => {
    const locator = createMockLocator(true, 'Btn', true);
    await expect(createExpect(locator).toBeEnabled()).resolves.toBeUndefined();
  });

  it('fails when disabled', async () => {
    const locator = createMockLocator(true, 'Btn', false);
    await expect(createExpect(locator).toBeEnabled({ timeout: 200 })).rejects.toThrow(AssertionError);
  });

  it('includes enabled info in error', async () => {
    const locator = createMockLocator(true, 'Btn', false);
    try {
      await createExpect(locator).toBeEnabled({ timeout: 200 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AssertionError);
      const ae = err as AssertionError;
      expect(ae.matcher).toBe('toBeEnabled');
      expect(ae.expected).toBe('enabled');
      expect(ae.actual).toBe('enabled=false');
    }
  });
});

describe('toBeDisabled', () => {
  it('passes when disabled', async () => {
    const locator = createMockLocator(true, 'Btn', false);
    await expect(createExpect(locator).toBeDisabled()).resolves.toBeUndefined();
  });

  it('fails when enabled', async () => {
    const locator = createMockLocator(true, 'Btn', true);
    await expect(createExpect(locator).toBeDisabled({ timeout: 200 })).rejects.toThrow(AssertionError);
  });
});

describe('toBeChecked', () => {
  it('passes when checked', async () => {
    const locator = createMockLocator(true, 'Accept', true, { checked: true });
    await expect(createExpect(locator).toBeChecked()).resolves.toBeUndefined();
  });

  it('passes for selected semantic state', async () => {
    const locator = createMockLocator(true, 'Male', true, { selected: true });
    await expect(createExpect(locator).toBeChecked()).resolves.toBeUndefined();
  });

  it('fails when unchecked', async () => {
    const locator = createMockLocator(true, 'Accept', true, { checked: false });
    await expect(createExpect(locator).toBeChecked({ timeout: 200 })).rejects.toThrow(AssertionError);
  });

  it('supports negation', async () => {
    const locator = createMockLocator(true, 'Accept', true, { checked: false });
    await expect(createExpect(locator).not.toBeChecked()).resolves.toBeUndefined();
  });
});

describe('polling behavior', () => {
  it('retries until condition is met', async () => {
    const locator = createMockLocator(true, 'Loading...');
    const assertion = createExpect(locator);

    // Simulate isVisible returning false first, then true
    let callCount = 0;
    (locator.isVisible as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return callCount >= 2; // false on first call, true on second
    });

    // Should succeed after retry within timeout
    await assertion.toBeVisible({ timeout: 200 });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('times out when condition is never met', async () => {
    const locator = createMockLocator(false);
    const start = Date.now();
    await expect(createExpect(locator).toBeVisible({ timeout: 200 })).rejects.toThrow(AssertionError);
    const elapsed = Date.now() - start;
    // Should have waited at least ~200ms (allowing some margin)
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  it('toHaveText retries until text matches', async () => {
    const locator = createMockLocator(true, 'Initial');
    let callCount = 0;

    // Simulate text changing after first poll
    (locator.resolve as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return { ...testWidget, text: 'Loading...' };
      }
      return { ...testWidget, text: 'Done' };
    });

    await createExpect(locator).toHaveText('Done', { timeout: 200 });
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});

describe('not (negation)', () => {
  it('not.toHaveText passes when text does not match', async () => {
    const locator = createMockLocator(true, 'Hello');
    await expect(createExpect(locator).not.toHaveText('World')).resolves.toBeUndefined();
  });

  it('not.toContainText passes when substring not found', async () => {
    const locator = createMockLocator(true, 'Hello');
    await expect(createExpect(locator).not.toContainText('World')).resolves.toBeUndefined();
  });

  it('not.toBeEnabled passes when disabled', async () => {
    const locator = createMockLocator(true, 'Btn', false);
    await expect(createExpect(locator).not.toBeEnabled()).resolves.toBeUndefined();
  });

  it('not.toBeDisabled passes when enabled', async () => {
    const locator = createMockLocator(true, 'Btn', true);
    await expect(createExpect(locator).not.toBeDisabled()).resolves.toBeUndefined();
  });
});
