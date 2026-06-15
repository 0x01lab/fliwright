import { describe, it, expect } from 'vitest';
import { SelectorResolver, resolveSelector, buildBaseSelector } from '../src/SelectorResolver.js';
import type { WidgetInfo } from '../src/types.js';

describe('SelectorResolver', () => {
  it('prefers text selector when widget has text', () => {
    const widget: Partial<WidgetInfo> = { type: 'ElevatedButton', text: 'Login' };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ text: 'Login' }");
  });

  it('uses role selector for known widget types without text', () => {
    const widget: Partial<WidgetInfo> = { type: 'ElevatedButton' };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ role: 'button' }");
  });

  it('uses key selector when widget has a key', () => {
    const widget: Partial<WidgetInfo> = { type: 'Widget', key: 'loginButton' };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ key: 'loginButton' }");
  });

  it('uses type selector as fallback', () => {
    const widget: Partial<WidgetInfo> = { type: 'CustomCard' };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ type: 'CustomCard' }");
  });

  it('prefers text over role', () => {
    const widget: Partial<WidgetInfo> = { type: 'ElevatedButton', text: 'Submit' };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ text: 'Submit' }");
  });

  it('escapes single quotes in text values', () => {
    const widget: Partial<WidgetInfo> = { type: 'Text', text: "user's name" };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ text: 'user\\'s name' }");
  });

  it('escapes backslashes in text values', () => {
    const widget: Partial<WidgetInfo> = { type: 'Text', text: 'path\\to\\file' };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ text: 'path\\\\to\\\\file' }");
  });

  it('returns generic fallback for empty widget', () => {
    const selector = resolveSelector({});
    expect(selector).toBe("{ type: 'Widget' }");
  });

  it('maps TextField to textbox role', () => {
    const widget: Partial<WidgetInfo> = { type: 'TextField' };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ role: 'textbox' }");
  });

  it('maps Checkbox to checkbox role', () => {
    const widget: Partial<WidgetInfo> = { type: 'Checkbox' };
    const selector = resolveSelector(widget);
    expect(selector).toBe("{ role: 'checkbox' }");
  });
});

describe('buildBaseSelector priority cascade', () => {
  it('prefers text', () => {
    const widget: Partial<WidgetInfo> = { type: 'ElevatedButton', text: 'Login' };
    expect(buildBaseSelector(widget)).toEqual({ match: { text: 'Login' } });
  });

  it('uses key when no text', () => {
    const widget: Partial<WidgetInfo> = { type: 'Widget', key: 'loginButton' };
    expect(buildBaseSelector(widget)).toEqual({ match: { key: 'loginButton' } });
  });

  it('uses tooltip before semanticsLabel', () => {
    const widget: Partial<WidgetInfo> = { type: 'IconButton', tooltip: 'Add' };
    expect(buildBaseSelector(widget)).toEqual({ match: { tooltip: 'Add' } });
  });

  it('uses semanticsLabel when no tooltip', () => {
    const widget: Partial<WidgetInfo> = { type: 'GestureDetector', semanticsLabel: 'Open drawer' };
    expect(buildBaseSelector(widget)).toEqual({ match: { semanticsLabel: 'Open drawer' } });
  });

  it('maps known type to role when nothing more specific', () => {
    const widget: Partial<WidgetInfo> = { type: 'ElevatedButton' };
    expect(buildBaseSelector(widget)).toEqual({ match: { role: 'button' } });
  });

  it('uses widget.role over ROLE_MAP', () => {
    const widget: Partial<WidgetInfo> = { type: 'Semantics', role: 'link' };
    expect(buildBaseSelector(widget)).toEqual({ match: { role: 'link' } });
  });

  it('uses name when no role', () => {
    const widget: Partial<WidgetInfo> = { type: 'Custom', name: 'emailField' };
    expect(buildBaseSelector(widget)).toEqual({ match: { name: 'emailField' } });
  });

  it('uses ancestorKey as a base criterion when nothing else', () => {
    const widget: Partial<WidgetInfo> = { type: 'Card', ancestorKey: 'form' };
    expect(buildBaseSelector(widget)).toEqual({ match: { ancestorKey: 'form' } });
  });

  it('falls back to type', () => {
    const widget: Partial<WidgetInfo> = { type: 'GestureDetector' };
    expect(buildBaseSelector(widget)).toEqual({ match: { type: 'GestureDetector' } });
  });

  it('falls back to generic Widget for empty widget', () => {
    expect(buildBaseSelector({})).toEqual({ match: { type: 'Widget' } });
  });

  it('trims whitespace in field values', () => {
    const widget: Partial<WidgetInfo> = { type: 'Text', text: '  Login  ' };
    expect(buildBaseSelector(widget)).toEqual({ match: { text: 'Login' } });
  });
});
