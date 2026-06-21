import type { SelectorInput } from './types.js';
import type { Page } from './Page.js';

export interface SelectRecipeContext {
  page: Page;
  recipe: string;
}

export interface SelectRecipeUseOptions extends Record<string, unknown> {
  value?: string | number;
  values?: Array<string | number>;
  field?: SelectorInput;
  open?: SelectorInput;
  option?: SelectorInput;
  optionText?: string;
  optionSemanticsId?: string;
  search?: SelectorInput;
  searchText?: string;
  done?: SelectorInput;
  timeoutMs?: number;
  settleMs?: number;
  settleTimeoutMs?: number;
  clickWaitForAnimations?: boolean;
  scrollFallback?: boolean;
  maxScrollAttempts?: number;
}

export type SelectRecipe = (
  context: SelectRecipeContext,
  options: SelectRecipeUseOptions,
) => void | Promise<void>;

export class SelectController {
  private readonly recipes = new Map<string, SelectRecipe>();

  constructor(private readonly page: Page) {
    this.registerAll(builtInSelectRecipes);
  }

  register(name: string, recipe: SelectRecipe): void {
    if (!name.trim()) throw new Error('Select recipe name must not be empty');
    this.recipes.set(name, recipe);
  }

  registerAll(recipes: Record<string, SelectRecipe>): void {
    for (const [name, recipe] of Object.entries(recipes)) {
      this.register(name, recipe);
    }
  }

  has(name: string): boolean {
    return this.recipes.has(name);
  }

  async use(name: string, options: SelectRecipeUseOptions = {}): Promise<void> {
    const recipe = this.recipes.get(name);
    if (!recipe) {
      throw new Error(`Unknown select recipe: ${name}`);
    }
    await recipe({ page: this.page, recipe: name }, options);
  }
}

export const builtInSelectRecipes: Record<string, SelectRecipe> = {
  standardDropdown: async ({ page }, options) => {
    const target = options.field ?? options.open;
    if (!target) throw new Error('standardDropdown requires field or open');
    const value = firstValue(options);
    await page.locator(target).selectOption(value, { timeout: timeoutMs(options) });
  },

  bottomSheetOption: async ({ page }, options) => {
    const open = options.open ?? options.field;
    if (!open) throw new Error('bottomSheetOption requires open or field');
    await clickForRecipe(page, open, options);
    await settleQuietly(page, options);
    await clickOption(page, options, optionalValue(options));
  },

  bottomSheetMultiOption: async ({ page }, options) => {
    const open = options.open ?? options.field;
    if (!open) throw new Error('bottomSheetMultiOption requires open or field');
    await clickForRecipe(page, open, options);
    await settleQuietly(page, options);
    for (const value of allValues(options)) {
      await clickOption(page, options, value);
      await settleQuietly(page, options);
    }
    if (options.done) {
      await clickForRecipe(page, options.done, options);
    }
  },

  searchablePicker: async ({ page }, options) => {
    const open = options.open ?? options.field;
    if (!open) throw new Error('searchablePicker requires open or field');
    const value = firstValue(options);
    await clickForRecipe(page, open, options);
    await settleQuietly(page, options);

    if (options.search) {
      const text = template(String(options.searchText ?? value), value);
      await page.locator(options.search).fill(text, { timeout: timeoutMs(options) });
      await settleQuietly(page, options);
    }

    await clickOption(page, options, value);
  },

  countryPicker: async (context, options) => {
    await builtInSelectRecipes.searchablePicker(context, {
      ...options,
      scrollFallback: options.scrollFallback ?? true,
    });
  },
};

async function clickOption(page: Page, options: SelectRecipeUseOptions, value?: string | number): Promise<void> {
  const selector = optionSelector(options, value);
  try {
    await clickForRecipe(page, selector, options);
    return;
  } catch (error) {
    if (!options.scrollFallback) throw error;
  }

  const maxAttempts = positiveNumber(options.maxScrollAttempts) ?? 12;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (await page.locator(selector).isVisible()) {
      await clickForRecipe(page, selector, options);
      return;
    }
    await dragPickerList(page);
    await settleQuietly(page, options);
  }
  await clickForRecipe(page, selector, options);
}

function optionSelector(options: SelectRecipeUseOptions, value?: string | number): SelectorInput {
  if (options.option) return options.option;
  if (value === undefined) throw new Error('Select recipe requires value or values');
  if (options.optionSemanticsId) {
    return { semantics: { identifier: template(options.optionSemanticsId, value) } };
  }
  if (options.optionText) {
    return { text: template(options.optionText, value) };
  }
  return { text: String(value) };
}

async function dragPickerList(page: Page): Promise<void> {
  try {
    await page.getByType('ListView').last({ visible: true }).drag(0, -420, { steps: 18, timeout: 1200 });
  } catch {
    await page.dragFrom(215, 820, 0, -420, { steps: 18 });
  }
}

async function settleQuietly(page: Page, options: SelectRecipeUseOptions): Promise<void> {
  try {
    await page.settle({ timeout: settleTimeoutMs(options), stableFrames: 2, throwOnTimeout: true });
  } catch {
    const delayMs = positiveNumber(options.settleMs) ?? 150;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function clickForRecipe(page: Page, selector: SelectorInput, options: SelectRecipeUseOptions): Promise<void> {
  await page.locator(selector).click({
    timeout: timeoutMs(options),
    waitForAnimations: options.clickWaitForAnimations === true,
    settleTimeout: settleTimeoutMs(options),
  });
}

function firstValue(options: SelectRecipeUseOptions): string | number {
  const value = optionalValue(options);
  if (value === undefined) throw new Error('Select recipe requires value or values');
  return value;
}

function optionalValue(options: SelectRecipeUseOptions): string | number | undefined {
  const values = allValues(options);
  return values[0];
}

function allValues(options: SelectRecipeUseOptions): Array<string | number> {
  if (Array.isArray(options.values)) return options.values;
  if (options.value !== undefined) return [options.value];
  return [];
}

function timeoutMs(options: SelectRecipeUseOptions): number | undefined {
  return positiveNumber(options.timeoutMs);
}

function settleTimeoutMs(options: SelectRecipeUseOptions): number {
  return positiveNumber(options.settleTimeoutMs) ?? Math.min(timeoutMs(options) ?? 1000, 500);
}

function positiveNumber(value: unknown): number | undefined {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function template(input: string, value: string | number): string {
  return input.replace(/\$\{value\}/g, String(value));
}
