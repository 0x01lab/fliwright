import { describe, it, expect } from 'vitest';
import { SelectorResolver, resolveSelector } from '../src/SelectorResolver.js';
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
