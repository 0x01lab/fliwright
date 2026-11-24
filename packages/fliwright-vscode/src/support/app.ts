import type { SupportSettingField, SupportSettingValue } from '@fliwright/core';
import type { SupportSettingsHostMessage, SupportSettingsViewState } from './messages.js';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { project?: string; support?: string } | undefined;
  setState(state: { project?: string; support?: string }): void;
};

const vscode = acquireVsCodeApi();
const project = document.querySelector<HTMLSelectElement>('#project')!;
const support = document.querySelector<HTMLSelectElement>('#support')!;
const notice = document.querySelector<HTMLParagraphElement>('#notice')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const form = document.querySelector<HTMLFormElement>('#settings')!;
const fields = document.querySelector<HTMLDivElement>('#fields')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
const changes = new Map<string, SupportSettingValue | null>();
const invalid = new Set<string>();
const controlUpdates: Array<() => void> = [];
let state: SupportSettingsViewState = { projects: [], supports: [] };
let busy = false;
let changed = false;
let saveFieldError: { key: string; message: string } | undefined;

function dirty(): boolean {
  return changes.size > 0 || invalid.size > 0;
}

function updateActions(): void {
  project.disabled = support.disabled = refresh.disabled = busy;
  save.hidden = !state.form;
  save.disabled = busy || changes.size === 0 || invalid.size > 0;
  for (const update of controlUpdates) update();
}

function showMessage(element: HTMLElement, message?: string): void {
  const text = message ?? '';
  if (element.textContent !== text) element.textContent = text;
  element.hidden = !text;
}

function load(options: { project?: string; support?: string; refresh?: boolean; discard?: boolean } = {}): void {
  busy = true;
  changed = false;
  updateActions();
  vscode.postMessage({ type: 'load', ...options });
}

function choose(select: HTMLSelectElement, entries: Array<[string, string]>, selected?: string): void {
  select.replaceChildren(...entries.map(([value, label]) => optionElement(label, value)));
  select.value = selected ?? '';
}

function optionElement(label: string, value: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function render(): void {
  choose(project, state.projects.map(item => [item.id, item.name]), state.project);
  choose(support, state.supports.map(item => [item.id, item.title]), state.support);
  document.querySelector<HTMLElement>('#project-entry')!.hidden = state.projects.length <= 1;
  document.querySelector<HTMLElement>('#support-entry')!.hidden = state.supports.length === 0;
  controlUpdates.length = 0;
  const current = state.form;
  fields.replaceChildren(...Object.entries(current?.definition.fields ?? {}).map(([key, field], index) => {
    const value = current && Object.hasOwn(current.values, key) ? current.values[key] : undefined;
    const issue = current && Object.hasOwn(current.issues, key) ? current.issues[key] : undefined;
    return renderField(key, field, index, value, issue);
  }));
  updateActions();
}

function renderField(key: string, field: SupportSettingField, index: number, saved?: SupportSettingValue, issue?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field';
  const labelRow = document.createElement('div');
  labelRow.className = 'label-row';
  const id = `field-${index}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = field.label;
  const reset = document.createElement('button');
  reset.className = 'reset';
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.title = `Clear the local value for ${field.label}`;
  reset.setAttribute('aria-label', reset.title);
  labelRow.append(label, reset);
  const input = createControl(field);
  input.id = id;
  input.setAttribute('aria-describedby', `${id}-hint ${id}-error`);
  const hint = document.createElement('p');
  hint.id = `${id}-hint`;
  hint.className = 'muted';
  const problem = document.createElement('p');
  problem.id = `${id}-error`;
  problem.className = 'error';
  problem.setAttribute('role', 'status');
  row.append(labelRow, input, hint, problem);

  function localValue(): SupportSettingValue | undefined {
    return changes.has(key) ? changes.get(key) ?? undefined : saved;
  }
  function updateControl(): void {
    const value = localValue();
    const fieldError = invalid.has(key) ? 'Enter a finite number.'
      : saveFieldError?.key === key ? saveFieldError.message : !changes.has(key) ? issue : undefined;
    reset.disabled = busy || (value === undefined && !invalid.has(key));
    input.disabled = busy;
    if (fieldError) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    const missing = field.required && value === undefined && field.default === undefined;
    const guidance = [field.description,
      value === undefined && field.default !== undefined ? `Default · ${displayValue(field, field.default)}` : '',
      missing ? 'Required at runtime' : '', field.env ? `Environment override · ${field.env}` : ''].filter(Boolean);
    showMessage(hint, guidance.join(' · '));
    showMessage(problem, fieldError);
  }
  function edit(value: SupportSettingValue | null): void {
    if (saveFieldError?.key === key) saveFieldError = undefined;
    if (value === (saved ?? null)) changes.delete(key);
    else changes.set(key, value);
  }
  reset.addEventListener('click', () => {
    invalid.delete(key);
    edit(null);
    setControlValue(input, field, localValue());
    input.focus();
    updateActions();
  });
  input.addEventListener('input', () => {
    const value = getControlValue(input, field);
    if (typeof value === 'number' && !Number.isFinite(value)) invalid.add(key);
    else {
      invalid.delete(key);
      edit(value);
    }
    updateActions();
  });
  setControlValue(input, field, saved);
  controlUpdates.push(updateControl);
  return row;
}

function createControl(field: SupportSettingField): HTMLInputElement | HTMLSelectElement {
  if (field.type === 'select') {
    const select = document.createElement('select');
    select.append(optionElement(field.default === undefined ? 'Select an option' : 'Use default', ''),
      ...field.options.map((option, index) => optionElement(option.label, String(index))));
    return select;
  }
  const input = document.createElement('input');
  input.type = field.type === 'boolean' ? 'checkbox' : field.type === 'string' ? 'text' : 'number';
  if (field.type === 'number') input.step = field.integer ? '1' : 'any';
  if (field.type !== 'boolean' && field.default !== undefined) input.placeholder = String(field.default);
  return input;
}

function setControlValue(input: HTMLInputElement | HTMLSelectElement, field: SupportSettingField, value?: SupportSettingValue): void {
  if (input instanceof HTMLSelectElement && field.type === 'select') {
    const index = field.options.findIndex(option => option.value === value);
    input.value = index < 0 ? '' : String(index);
  } else if (input instanceof HTMLInputElement) {
    if (field.type === 'boolean') {
      input.checked = typeof value === 'boolean' ? value : field.default ?? false;
      input.indeterminate = value === undefined && field.default === undefined;
    } else {
      input.value = typeof value === field.type ? String(value) : '';
    }
  }
}

function getControlValue(input: HTMLInputElement | HTMLSelectElement, field: SupportSettingField): SupportSettingValue | null {
  if (input instanceof HTMLSelectElement && field.type === 'select') {
    return input.value === '' ? null : field.options[Number(input.value)].value;
  }
  if (input instanceof HTMLInputElement) {
    if (field.type === 'boolean') return input.checked;
    if (field.type === 'number') return input.value === '' && !input.validity.badInput ? null : input.valueAsNumber;
  }
  return input.value;
}

function displayValue(field: SupportSettingField, value: SupportSettingValue): string {
  if (field.type === 'select') return field.options.find(option => option.value === value)?.label ?? String(value);
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  return value === '' ? '(empty)' : String(value);
}

project.addEventListener('change', () => {
  const selected = project.value;
  project.value = state.project ?? '';
  load({ project: selected, support: '', discard: dirty() });
});
support.addEventListener('change', () => {
  const selected = support.value;
  support.value = state.support ?? '';
  load({ support: selected, discard: dirty() });
});
refresh.addEventListener('click', () => load({ refresh: true, discard: dirty() }));
form.addEventListener('submit', event => {
  event.preventDefault();
  if (save.disabled || !state.form) return;
  busy = true;
  saveFieldError = undefined;
  showMessage(notice, 'Saving...');
  showMessage(error);
  updateActions();
  vscode.postMessage({ type: 'save', token: state.form.token, changes: Object.fromEntries(changes) });
});

window.addEventListener('message', ({ data }: MessageEvent<SupportSettingsHostMessage>) => {
  if (data.type === 'changed') {
    changed = true;
    if (dirty()) showMessage(notice, 'Project settings changed. Refresh to load the latest declaration.');
  } else {
    busy = false;
  }
  if (data.type === 'state') {
    state = data.state;
    saveFieldError = undefined;
    changes.clear();
    invalid.clear();
    vscode.setState({ project: state.project, support: state.support });
    showMessage(notice, state.notice ?? (data.saved && !state.error ? 'Saved.' : undefined));
    showMessage(error, state.error);
    render();
  } else if (data.type === 'error') {
    if (notice.textContent === 'Saving...') showMessage(notice);
    if (data.field && state.form) {
      saveFieldError = { key: data.field, message: data.message };
      const index = Object.keys(state.form.definition.fields).indexOf(data.field);
      updateActions();
      document.getElementById(`field-${index}`)?.focus();
    } else showMessage(error, data.message);
  }
  updateActions();
  if (changed && !busy && !dirty()) {
    changed = false;
    load();
  }
});

load(vscode.getState());
