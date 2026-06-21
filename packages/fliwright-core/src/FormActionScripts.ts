import type {
  FormActionScript,
  FormActionScriptContext,
  SelectorInput,
  SelectorQuery,
} from './types.js';
import { Selector } from './Selector.js';
import { SelectController, type SelectRecipeUseOptions } from './SelectRecipes.js';
import { Page } from './Page.js';

type ScriptArgs = Record<string, unknown>;
const DEFAULT_ACTION_TIMEOUT_MS = 1500;

export const builtInFormActionScripts: Record<string, FormActionScript> = {
  'tap.bySelector': async (context) => {
    const args = context.action.args ?? {};
    const target = selectorArg(args, 'target', context) ?? context.fieldSelector;
    await click(context, target);
  },
  'tap.byText': async (context) => {
    await click(context, optionTextSelector(context));
  },
  'checkbox.ensure': async (context) => {
    const desired = parseBooleanValue(context.value) ?? true;
    const current = parseBooleanValue(context.field.value);
    if (current === desired) return;
    if (current === undefined && desired === false) return;
    const target = selectorArg(context.action.args ?? {}, 'target', context) ?? context.fieldSelector;
    await click(context, target);
  },
  'select.byOptionSemantics': async (context) => {
    const args = context.action.args ?? {};
    const open = selectorArg(args, 'open', context) ?? context.fieldSelector;
    await select(context, 'bottomSheetOption', {
      open,
      option: optionSemanticsSelector(context),
      timeoutMs: actionTimeout(context),
    });
  },
  'select.byText': async (context) => {
    const args = context.action.args ?? {};
    const open = selectorArg(args, 'open', context) ?? context.fieldSelector;
    await select(context, 'bottomSheetOption', {
      open,
      option: optionTextSelector(context),
      timeoutMs: actionTimeout(context),
    });
  },
  'select.searchAndPick': async (context) => {
    const args = context.action.args ?? {};
    const open = selectorArg(args, 'open', context) ?? context.fieldSelector;
    await select(context, stringArg(args, 'recipe') ?? 'searchablePicker', {
      open,
      search: selectorArg(args, 'search', context),
      searchText: stringArg(args, 'searchText'),
      option: optionSelector(context),
      value: context.value,
      timeoutMs: actionTimeout(context),
      scrollFallback: booleanArg(args, 'scrollFallback'),
      maxScrollAttempts: positiveNumber(args.maxScrollAttempts),
    });
  },
  'select.recipe': async (context) => {
    const args = context.action.args ?? {};
    const recipe = stringArg(args, 'recipe');
    if (!recipe) throw new Error('select.recipe requires args.recipe');
    await select(context, recipe, recipeOptions(context, args));
  },
  'multiSelect.byOptionSemantics': async (context) => {
    const args = context.action.args ?? {};
    const open = selectorArg(args, 'open', context) ?? context.fieldSelector;
    await select(context, 'bottomSheetMultiOption', {
      open,
      values: splitValues(context.value),
      optionSemanticsId: stringArg(args, 'optionSemanticId') ?? context.option?.semanticsId ?? '${value}',
      done: selectorArg(args, 'done', context),
      timeoutMs: actionTimeout(context),
    });
  },
  'multiSelect.byText': async (context) => {
    const args = context.action.args ?? {};
    const open = selectorArg(args, 'open', context) ?? context.fieldSelector;
    await select(context, 'bottomSheetMultiOption', {
      open,
      values: splitValues(context.value),
      optionText: stringArg(args, 'optionText') ?? '${value}',
      done: selectorArg(args, 'done', context),
      timeoutMs: actionTimeout(context),
    });
  },
};

async function click(context: FormActionScriptContext, selector: SelectorInput): Promise<void> {
  await context.locator(selector).click({ timeout: actionTimeout(context) });
}

function actionTimeout(context: FormActionScriptContext): number {
  const args = context.action.args ?? {};
  return positiveNumber(args.timeoutMs) ?? positiveNumber(args.timeout) ?? DEFAULT_ACTION_TIMEOUT_MS;
}

function optionSelector(context: FormActionScriptContext): SelectorInput {
  const args = context.action.args ?? {};
  return selectorArg(args, 'option', context)
    ?? (hasString(args, 'optionSemanticId') ? optionSemanticsSelector(context) : optionTextSelector(context));
}

function optionSemanticsSelector(context: FormActionScriptContext): SelectorQuery {
  const args = context.action.args ?? {};
  const semanticsId = templateString(
    stringArg(args, 'optionSemanticId')
      ?? context.option?.semanticsId
      ?? '${value}',
    context,
  );
  return scopedSelector({ match: { semanticIdentifier: semanticsId } }, args, context);
}

function optionTextSelector(context: FormActionScriptContext): SelectorQuery {
  const args = context.action.args ?? {};
  const text = templateString(stringArg(args, 'optionText') ?? context.option?.label ?? context.value, context);
  return scopedSelector({ match: { text } }, args, context);
}

function selectorArg(args: ScriptArgs, key: string, context: FormActionScriptContext): SelectorInput | undefined {
  const value = args[key];
  if (typeof value === 'string') return templateString(value, context);
  if (isSelectorInput(value)) return value;
  return undefined;
}

function selectorQueryArg(args: ScriptArgs, key: string, context: FormActionScriptContext): SelectorQuery | undefined {
  const value = selectorArg(args, key, context);
  if (!value) return undefined;
  return new Selector(value).toQuery();
}

function scopedSelector(
  selector: SelectorQuery,
  args: ScriptArgs,
  context: FormActionScriptContext,
): SelectorQuery {
  const within = selectorQueryArg(args, 'within', context);
  return within ? { ...selector, within } : selector;
}

function stringArg(args: ScriptArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function hasString(args: ScriptArgs, key: string): boolean {
  return typeof args[key] === 'string';
}

function booleanArg(args: ScriptArgs, key: string): boolean | undefined {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return parseBooleanValue(value);
  return undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function splitValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  }
  if (value && typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    if (entry.value !== undefined) return splitValues(entry.value);
    if (entry.fixed !== undefined) return splitValues(entry.fixed);
  }
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', '是'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', '否'].includes(normalized)) return false;
  return undefined;
}

function templateString(template: string, context: FormActionScriptContext): string {
  return template
    .replace(/\$\{value\}/g, String(context.value))
    .replace(/\$\{option.value\}/g, context.option?.value ?? String(context.value))
    .replace(/\$\{option.label\}/g, context.option?.label ?? String(context.value))
    .replace(/\$\{field.name\}/g, context.field.name ?? '')
    .replace(/\$\{field.id\}/g, context.field.id);
}

function recipeOptions(context: FormActionScriptContext, args: ScriptArgs): SelectRecipeUseOptions {
  return {
    field: context.fieldSelector,
    open: selectorArg(args, 'open', context) ?? context.fieldSelector,
    search: selectorArg(args, 'search', context),
    searchText: stringArg(args, 'searchText'),
    option: selectorArg(args, 'option', context),
    optionText: stringArg(args, 'optionText'),
    optionSemanticsId: stringArg(args, 'optionSemanticsId') ?? stringArg(args, 'optionSemanticId'),
    done: selectorArg(args, 'done', context),
    value: context.value,
    values: splitValues(context.value),
    timeoutMs: actionTimeout(context),
    settleMs: positiveNumber(args.settleMs),
    settleTimeoutMs: positiveNumber(args.settleTimeoutMs),
    clickWaitForAnimations: booleanArg(args, 'clickWaitForAnimations'),
    scrollFallback: booleanArg(args, 'scrollFallback'),
    maxScrollAttempts: positiveNumber(args.maxScrollAttempts),
  };
}

async function select(
  context: FormActionScriptContext,
  recipe: string,
  options: SelectRecipeUseOptions,
): Promise<void> {
  const page = new Page(context.sendRequest);
  const controller = new SelectController(page);
  await controller.use(recipe, options);
}

function isSelectorInput(value: unknown): value is SelectorInput {
  if (typeof value === 'string' || value instanceof RegExp) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return true;
}
