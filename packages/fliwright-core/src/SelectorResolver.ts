import type { WidgetInfo } from './types.js';

const ROLE_MAP: Record<string, string> = {
  ElevatedButton: 'button',
  TextButton: 'button',
  OutlinedButton: 'button',
  IconButton: 'button',
  FloatingActionbutton: 'button',
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

function escapeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function resolveSelector(widget: Partial<WidgetInfo>): string {
  const text = widget.text?.trim();
  if (text) return `{ text: '${escapeSelectorValue(text)}' }`;

  const key = widget.key?.trim();
  if (key) return `{ key: '${escapeSelectorValue(key)}' }`;

  const type = widget.type?.trim();
  if (!type) return "{ type: 'Widget' }";

  const role = ROLE_MAP[type];
  if (role) return `{ role: '${role}' }`;

  return `{ type: '${escapeSelectorValue(type)}' }`;
}

export class SelectorResolver {
  resolve(widget: Partial<WidgetInfo>): string {
    return resolveSelector(widget);
  }
}
