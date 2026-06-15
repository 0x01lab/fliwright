import { describe, it, expect, vi } from 'vitest';
import { RecordedSelectorResolver } from '../src/RecordedSelectorResolver.js';
import type { WidgetInfo } from '../src/types.js';

const op = { kind: 'tap' as const, position: { x: 10, y: 20 }, timestamp: 1000 };

function resolver(hitTestWidget: Partial<WidgetInfo> | null, resolveBySelector: (q: any) => any) {
  const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (method === 'ext.fliwright.hitTest') {
      return Promise.resolve(hitTestWidget == null ? { widget: {} } : { widget: hitTestWidget });
    }
    if (method === 'ext.fliwright.resolve') {
      const query = JSON.parse((params as { selector: string }).selector);
      return Promise.resolve(resolveBySelector(query));
    }
    return Promise.resolve({});
  });
  return new RecordedSelectorResolver(sendRequest);
}

describe('RecordedSelectorResolver', () => {
  it('returns the base selector when it is already unique', async () => {
    const r = resolver(
      { id: '1', type: 'ElevatedButton', text: 'Login', properties: {} },
      () => ({ count: 1 }),
    );
    const result = await r.resolveUniqueSelector(op);
    expect(result.query).toEqual({ match: { text: 'Login' } });
    expect(result.ambiguous).toBe(false);
  });

  it('disambiguates with within(keyed ancestor) when the base matches many', async () => {
    const widget: Partial<WidgetInfo> = {
      id: '1', type: 'GestureDetector', properties: {},
      keyedAncestors: [{ key: 'cardList', type: 'Column' }],
    };
    const r = resolver(widget, (q: any) => {
      // base and containing match many; the within-scoped query matches one
      if (q.within) return { count: 1 };
      return { count: 5 };
    });
    const result = await r.resolveUniqueSelector(op);
    expect(result.query.within).toEqual({ match: { key: 'cardList' } });
    expect(result.ambiguous).toBe(false);
  });

  it('disambiguates with containing(descendant text) when within does not help', async () => {
    const widget: Partial<WidgetInfo> = {
      id: '1', type: 'GestureDetector', descendantText: 'Login', properties: {},
    };
    const r = resolver(widget, (q: any) => {
      if (q.containing) return { count: 1 };
      return { count: 3 };
    });
    const result = await r.resolveUniqueSelector(op);
    expect(result.query.containing).toEqual({ match: { text: 'Login' } });
    expect(result.ambiguous).toBe(false);
  });

  it('falls back to nth and flags ambiguous when nothing else is unique', async () => {
    const widget: Partial<WidgetInfo> = {
      id: '7', type: 'GestureDetector', properties: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
    };
    const r = resolver(widget, (q: any) => {
      if (q.position?.nth != null) return { count: 1 };
      // For the un-scoped resolution used to compute the index, return an
      // ordered list whose second entry is our target.
      return {
        count: 2,
        matches: [
          { id: '3', type: 'GestureDetector', rect: { x: 0, y: 0, width: 5, height: 5 }, properties: {} },
          widget,
        ],
      };
    });
    const result = await r.resolveUniqueSelector(op);
    expect(result.query.position?.nth).toBe(1);
    expect(result.ambiguous).toBe(true);
    expect(result.matchCount).toBe(2);
  });

  it('returns a generic Widget selector when hitTest is empty', async () => {
    const r = resolver(null, () => ({ count: 0 }));
    const result = await r.resolveUniqueSelector(op);
    expect(result.query).toEqual({ match: { type: 'Widget' } });
    expect(result.ambiguous).toBe(true);
  });

  it('returns bare base (ambiguous) when the target is not in the matched set', async () => {
    const widget: Partial<WidgetInfo> = {
      id: '999', type: 'GestureDetector', properties: {},
    };
    const r = resolver(widget, (q: any) => {
      if (q.position?.nth != null) return { count: 1 };
      // Target id '999' is NOT in the returned matches.
      return {
        count: 2,
        matches: [
          { id: '1', type: 'GestureDetector', properties: {} },
          { id: '2', type: 'GestureDetector', properties: {} },
        ],
      };
    });
    const result = await r.resolveUniqueSelector(op);
    expect(result.query).toEqual({ match: { type: 'GestureDetector' } });
    expect(result.ambiguous).toBe(true);
    expect(result.matchCount).toBe(2);
  });

  it('survives a resolve rejection by falling back to nth/ambiguous', async () => {
    const widget: Partial<WidgetInfo> = { id: '1', type: 'GestureDetector', properties: {} };
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.hitTest') return Promise.resolve({ widget });
      if (method === 'ext.fliwright.resolve') return Promise.reject(new Error('boom'));
      return Promise.resolve({});
    });
    const r = new RecordedSelectorResolver(sendRequest);
    const result = await r.resolveUniqueSelector(op);
    expect(result.ambiguous).toBe(true);
    expect(result.query.match?.type).toBe('GestureDetector');
  });
});
