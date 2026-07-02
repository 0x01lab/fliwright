import type {
  FilterCriteria,
  RefTarget,
  SelectorAst,
  SelectorInput,
  SelectorQuery,
  SendRequest,
  WidgetInfo,
} from './types.js';
import { Selector } from './Selector.js';
import type { AssertionTimelineOptions } from './Assertion.js';

type ActionResponse = {
  success?: boolean;
  error?: string;
  debug?: unknown;
  /** Diagnostic context dump when no widget was found (P1 optimization). */
  contextDump?: Array<{
    type: string;
    text?: string;
    key?: string;
    role?: string;
    semanticsLabel?: string;
  }>;
};

type ResolveResponse = {
  widgets?: WidgetInfo[];
  matches?: WidgetInfo[];
  count?: number;
};

export class Locator {
  private readonly target: LocatorTarget;

  constructor(
    input: SelectorInput | SelectorAst | Selector | RefTarget,
    private sendRequest: SendRequest,
    readonly assertionTimeline?: AssertionTimelineOptions,
  ) {
    if (isRefTarget(input)) {
      this.target = { kind: 'ref', ref: normalizeRef(input.ref) };
    } else {
      this.target = {
        kind: 'selector',
        selector: input instanceof Selector ? input : new Selector(input),
      };
    }
  }

  get selectorString(): string {
    if (this.target.kind === 'ref') return `ref=${this.target.ref}`;
    return selectorDisplay(this.target.selector.toQuery());
  }

  get selectorAst(): SelectorAst {
    return this.requireSelector('selectorAst').toJSON();
  }

  locator(selector: SelectorInput): Locator {
    return new Locator(this.requireSelector('locator').descendant(selector), this.sendRequest, this.assertionTimeline);
  }

  getByText(
    text: string | RegExp,
    options?: { exact?: boolean; match?: 'exact' | 'contains' | 'regex'; caseSensitive?: boolean },
  ): Locator {
    return this.locator({ text, ...options });
  }

  getByKey(key: string): Locator {
    return this.locator({ key });
  }

  getByType(type: string): Locator {
    return this.locator({ type });
  }

  getBySubtype(subtype: string): Locator {
    return this.locator({ subtype });
  }

  getBySemantics(semantics: {
    identifier?: string;
    label?: string;
    hint?: string;
    role?: string;
    match?: 'exact' | 'contains' | 'regex';
    caseSensitive?: boolean;
  }): Locator {
    return this.locator({ semantics });
  }

  ancestor(selector: SelectorInput): Locator {
    return new Locator(this.requireSelector('ancestor').ancestor(selector), this.sendRequest, this.assertionTimeline);
  }

  and(...selectors: SelectorInput[]): Locator {
    return new Locator(this.requireSelector('and').and(...selectors), this.sendRequest, this.assertionTimeline);
  }

  or(...selectors: SelectorInput[]): Locator {
    return new Locator(this.requireSelector('or').or(...selectors), this.sendRequest, this.assertionTimeline);
  }

  nth(index: number, options?: { visible?: boolean }): Locator {
    const base = this.requireSelector('nth').nth(index);
    if (options?.visible) {
      return new Locator(base.filter({ visible: true }), this.sendRequest, this.assertionTimeline);
    }
    return new Locator(base, this.sendRequest, this.assertionTimeline);
  }

  first(options?: { visible?: boolean }): Locator {
    return this.nth(0, options);
  }

  last(options?: { visible?: boolean }): Locator {
    const base = this.requireSelector('last').last();
    if (options?.visible) {
      return new Locator(base.filter({ visible: true }), this.sendRequest, this.assertionTimeline);
    }
    return new Locator(base, this.sendRequest, this.assertionTimeline);
  }

  filter(criteria: FilterCriteria): Locator {
    return new Locator(this.requireSelector('filter').filter(criteria), this.sendRequest, this.assertionTimeline);
  }

  containing(descendant: SelectorInput): Locator {
    return new Locator(this.requireSelector('containing').containing(descendant), this.sendRequest, this.assertionTimeline);
  }

  getByTooltip(tooltip: string): Locator {
    return this.locator({ tooltip });
  }

  async click(options?: {
    alignment?: AlignmentOption;
    timeout?: number;
    /** Wait for Flutter animations to settle after the click (e.g. page transitions). */
    waitForAnimations?: boolean;
    /** Timeout in ms for the animation settle step (default: 2000). */
    settleTimeout?: number;
  }): Promise<void> {
    const response = await this.sendAction('tap', {
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
      waitForAnimations: options?.waitForAnimations ? 'true' : undefined,
      settleTimeout: options?.settleTimeout?.toString(),
    });
    this.assertSuccessResponse(response, 'click');
  }

  async clickIfVisible(options?: {
    alignment?: AlignmentOption;
    timeout?: number;
    waitForAnimations?: boolean;
    settleTimeout?: number;
  }): Promise<boolean> {
    if (!(await this.isVisible())) return false;
    await this.click(options);
    return true;
  }

  async doubleClick(options?: { alignment?: AlignmentOption; timeout?: number }): Promise<void> {
    const response = await this.sendAction('doubleClick', {
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'doubleClick');
  }

  async tripleClick(options?: { alignment?: AlignmentOption; timeout?: number }): Promise<void> {
    const response = await this.sendAction('tripleClick', {
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'tripleClick');
  }

  async rightClick(options?: { alignment?: AlignmentOption; timeout?: number }): Promise<void> {
    const response = await this.sendAction('rightClick', {
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'rightClick');
  }

  async hover(options?: { alignment?: AlignmentOption; timeout?: number }): Promise<void> {
    const response = await this.sendAction('hover', {
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'hover');
  }

  async focus(options?: { alignment?: AlignmentOption; timeout?: number }): Promise<void> {
    const response = await this.sendAction('focus', {
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'focus');
  }

  async blur(options?: { timeout?: number }): Promise<void> {
    const response = await this.sendAction('blur', {
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'blur');
  }

  async longPress(options?: {
    duration?: number;
    alignment?: AlignmentOption;
    timeout?: number;
  }): Promise<void> {
    const response = await this.sendAction('longPress', {
      duration: options?.duration,
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'longPress');
  }

  async drag(deltaX: number, deltaY: number, options?: {
    steps?: number;
    alignment?: AlignmentOption;
    timeout?: number;
  }): Promise<void> {
    const response = await this.sendAction('drag', {
      deltaX,
      deltaY,
      steps: options?.steps,
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'drag');
  }

  /**
   * Drag this element in a semantic direction by a given distance.
   * The start position is the center of the resolved widget.
   *
   * @param direction - 'left' | 'right' | 'up' | 'down'
   * @param distance - Logical pixels to drag (default: 50% of widget width/height)
   */
  async dragTo(direction: 'left' | 'right' | 'up' | 'down', distance?: number, options?: {
    steps?: number;
    alignment?: AlignmentOption;
    timeout?: number;
  }): Promise<void> {
    const response = await this.sendAction('semanticDrag', {
      direction,
      distance,
      steps: options?.steps ?? 20,
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'dragTo');
  }

  /**
   * Slide this element to a target X position (e.g. a slider knob).
   * Useful for slider captcha scenarios.
   *
   * @param targetX - Absolute logical X coordinate to slide to.
   */
  async slideTo(targetX: number, options?: {
    steps?: number;
    alignment?: AlignmentOption;
    timeout?: number;
  }): Promise<void> {
    const response = await this.sendAction('slideTo', {
      targetX,
      steps: options?.steps ?? 25,
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'slideTo');
  }

  async pinch(scale: number, options?: {
    steps?: number;
    alignment?: AlignmentOption;
    timeout?: number;
  }): Promise<void> {
    const response = await this.sendAction('pinch', {
      scale,
      steps: options?.steps,
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'pinch');
  }

  async type(text: string, options?: { delay?: number; charDelay?: number; timeout?: number }): Promise<void> {
    const response = await this.sendAction('type', {
      text,
      charDelay: options?.charDelay ?? options?.delay,
      replaceAll: false,
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'type');
  }

  async fill(text: string, options?: {
    delay?: number;
    charDelay?: number;
    timeout?: number;
    checkStable?: boolean;
  }): Promise<void> {
    const response = await this.sendAction('fill', {
      text,
      charDelay: options?.charDelay ?? options?.delay,
      replaceAll: true,
      timeout: options?.timeout,
      checkStable: options?.checkStable,
    });
    this.assertSuccessResponse(response, 'fill');
  }

  async clear(options?: { timeout?: number }): Promise<void> {
    const response = await this.sendAction('clear', {
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'clear');
  }

  async pressKey(key: string, options?: { timeout?: number }): Promise<void> {
    const response = await this.sendAction('pressKey', {
      key,
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'pressKey');
  }

  async setCheckbox(checked: boolean, options?: { timeout?: number }): Promise<void> {
    const response = await this.sendAction('setCheckbox', {
      checked,
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'setCheckbox');
  }

  async check(options?: { timeout?: number }): Promise<void> {
    await this.setCheckbox(true, options);
  }

  async uncheck(options?: { timeout?: number }): Promise<void> {
    await this.setCheckbox(false, options);
  }

  async isChecked(): Promise<boolean> {
    const widget = await this.resolve();
    return widgetCheckedState(widget) === true;
  }

  async selectOption(
    value: string | number,
    options?: { timeout?: number },
  ): Promise<void> {
    const response = await this.sendAction('selectOption', {
      value,
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'selectOption');
  }

  async scrollIntoView(options?: { alignment?: number; duration?: number; timeout?: number }): Promise<void> {
    const response = await this.sendAction('scrollIntoView', {
      alignment: options?.alignment ?? 0.5,
      duration: options?.duration ?? 300,
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'scrollIntoView');
  }

  async scrollIntoViewAndClick(options?: {
    scroll?: { alignment?: number; duration?: number; timeout?: number };
    click?: {
      alignment?: AlignmentOption;
      timeout?: number;
      waitForAnimations?: boolean;
      settleTimeout?: number;
    };
  }): Promise<void> {
    await this.scrollIntoView(options?.scroll);
    await this.click(options?.click);
  }

  async count(): Promise<number> {
    const result = await this.resolveAll({ visible: 'any', strict: false });
    return result.length;
  }

  async isVisible(): Promise<boolean> {
    const result = await this.resolveAll({ visible: 'hitTestable', strict: false, limit: 1 });
    return result.length > 0;
  }

  /** Resolve the first matching widget without performing any action. */
  async resolve(): Promise<WidgetInfo | undefined> {
    const widgets = await this.resolveAll({ visible: 'any', strict: false, limit: 1 });
    return widgets[0];
  }

  async resolveAll(options?: {
    visible?: 'any' | 'hitTestable';
    strict?: boolean;
    limit?: number;
  }): Promise<WidgetInfo[]> {
    const result = (await this.sendRequest('ext.fliwright.resolve', {
      ...this.requireSelector('resolveAll').toWireParams({
        limit: options?.limit,
        strict: options?.strict ?? false,
        visible: options?.visible ?? 'any',
      }),
    })) as ResolveResponse;
    return result.matches ?? result.widgets ?? [];
  }

  /** Fill text using a pre-resolved widget. Kept for internal form helper fast paths. */
  async fillWithResolved(
    text: string,
    resolved: WidgetInfo,
    options?: { charDelay?: number },
  ): Promise<void> {
    const response = await this.sendAction('fill', {
      text,
      charDelay: options?.charDelay,
      replaceAll: true,
      targetId: resolved.id,
      targetRect: resolved.rect ? JSON.stringify(resolved.rect) : undefined,
    });
    this.assertSuccessResponse(response, 'fill');
  }

  /** Click using a pre-resolved widget. */
  async clickResolved(resolved: WidgetInfo): Promise<void> {
    const response = await this.sendAction('tap', {
      targetId: resolved.id,
      targetRect: resolved.rect ? JSON.stringify(resolved.rect) : undefined,
    });
    this.assertSuccessResponse(response, 'click');
  }

  private async sendAction(action: string, params: Record<string, unknown>): Promise<ActionResponse> {
    return (await this.sendRequest('ext.fliwright.action', {
      action,
      ...this.targetWireParams(),
      ...stringifyDefined(params),
    })) as ActionResponse;
  }

  private targetWireParams(): Record<string, unknown> {
    if (this.target.kind === 'ref') return { ref: this.target.ref };
    return {
      strict: 'true',
      visible: 'hitTestable',
      ...this.target.selector.toWireParams(),
    };
  }

  private requireSelector(operation: string): Selector {
    if (this.target.kind === 'selector') return this.target.selector;
    throw new Error(`${operation} is not supported on ref locator ${this.target.ref}`);
  }

  private assertSuccessResponse(response: unknown, action: string): void {
    if (!response || typeof response !== 'object') return;

    const result = response as ActionResponse;
    if (result.success === false || result.error != null) {
      const message = typeof result.error === 'string' ? result.error : `${action} failed`;
      const debug = result.debug === undefined ? '' : ` debug=${JSON.stringify(result.debug)}`;
      const context = result.contextDump?.length
        ? '\n\nVisible widgets on screen:\n' +
          result.contextDump
            .slice(0, 10)
            .map((w) => {
              const parts = [`  - ${w.type}`];
              if (w.text) parts.push(`"${w.text}"`);
              if (w.key) parts.push(`[key=${w.key}]`);
              if (w.role) parts.push(`role=${w.role}`);
              if (w.semanticsLabel) parts.push(`semantics="${w.semanticsLabel}"`);
              return parts.join(' ');
            })
            .join('\n')
        : '';
      throw new Error(`${message}${debug}${context}`);
    }
  }
}

type LocatorTarget =
  | { kind: 'selector'; selector: Selector }
  | { kind: 'ref'; ref: string };

export type AlignmentOption =
  | 'center'
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'centerLeft'
  | 'centerRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight';

function stringifyDefined(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      output[key] = String(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function selectorDisplay(query: SelectorQuery): string {
  const match = query.match;
  if (match && !query.within && !query.fallback && !query.position) {
    if (match.text) return `text=${match.text}`;
    if (match.textContains) return `textContains=${match.textContains}`;
    if (match.key) return `key=${match.key}`;
    if (match.type) return `byType=${match.type}`;
    if (match.id) return `id=${match.id}`;
    if (match.name) return `name=${match.name}`;
    if (match.ancestorKey) return `ancestorKey=${match.ancestorKey}`;
    if (match.semanticIdentifier) return `find=${JSON.stringify(query)}`;
    if (match.semanticsLabel) return `find=${JSON.stringify(query)}`;
    if (match.role) return `role=${match.role}`;
  }
  return `find=${JSON.stringify(query)}`;
}

function isRefTarget(input: unknown): input is RefTarget {
  return typeof input === 'object' &&
    input !== null &&
    'ref' in input &&
    typeof (input as { ref?: unknown }).ref === 'string';
}

function normalizeRef(ref: string): string {
  if (ref.length === 0) throw new Error('Ref must not be empty');
  return ref;
}

export function widgetCheckedState(widget: WidgetInfo | undefined): boolean | undefined {
  const checked = widget?.properties?.checked;
  if (typeof checked === 'boolean') return checked;
  const toggled = widget?.properties?.toggled;
  if (typeof toggled === 'boolean') return toggled;
  const selected = widget?.properties?.selected;
  if (typeof selected === 'boolean') return selected;
  return undefined;
}
