import type { SelectorQuery, WidgetInfo } from './types.js';

const ROLE_MAP: Record<string, string> = {
  ElevatedButton: 'button',
  TextButton: 'button',
  OutlinedButton: 'button',
  IconButton: 'button',
  FloatingActionButton: 'button',
  TextField: 'textbox',
  TextFormField: 'textbox',
  CupertinoTextField: 'textbox',
  Checkbox: 'checkbox',
  CheckboxListTile: 'checkbox',
  Switch: 'switch',
  SwitchListTile: 'switch',
  Slider: 'slider',
  DropdownButton: 'combobox',
  DropdownButtonFormField: 'combobox',
  NavigationRail: 'navigation',
  BottomNavigationBar: 'navigation',
  TabBar: 'tablist',
};

export class SelectorResolver {
  resolve(widget: Partial<WidgetInfo>): SelectorQuery {
    return buildBaseSelector(widget);
  }
}

function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/**
 * Build the most specific base SelectorQuery for a hit-tested widget.
 * Priority: text → key → tooltip → semanticsLabel → role → name →
 * semanticsHint → ancestorKey → type (→ generic Widget).
 *
 * Returns a structured SelectorQuery (not a string) so downstream steps can
 * attach within / containing / position for disambiguation.
 */
export function buildBaseSelector(widget: Partial<WidgetInfo>): SelectorQuery {
  const text = trimmed(widget.text);
  if (text) return { match: { text } };

  const key = trimmed(widget.key);
  if (key) return { match: { key } };

  const tooltip = trimmed(widget.tooltip);
  if (tooltip) return { match: { tooltip } };

  const semanticsLabel = trimmed(widget.semanticsLabel);
  if (semanticsLabel) return { match: { semanticsLabel } };

  const role = trimmed(widget.role) ?? ROLE_MAP[widget.type ?? ''];
  if (role) return { match: { role } };

  const name = trimmed(widget.name);
  if (name) return { match: { name } };

  const semanticsHint = trimmed(widget.semanticsHint);
  if (semanticsHint) return { match: { semanticsHint } };

  const ancestorKey = trimmed(widget.ancestorKey);
  if (ancestorKey) return { match: { ancestorKey } };

  const type = trimmed(widget.type);
  return { match: { type: type ?? 'Widget' } };
}
