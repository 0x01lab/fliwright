import type { SelectorAst, SelectorInput, SelectorQuery, SendRequest, WidgetInfo } from './types.js';
import { Selector } from './Selector.js';

type ActionResponse = {
  success?: boolean;
  error?: string;
  debug?: unknown;
};

type ResolveResponse = {
  widgets?: WidgetInfo[];
  matches?: WidgetInfo[];
  count?: number;
};

export class Locator {
  private readonly selector: Selector;

  constructor(
    input: SelectorInput | SelectorAst | Selector,
    private sendRequest: SendRequest,
  ) {
    this.selector = input instanceof Selector ? input : new Selector(input);
  }

  get selectorString(): string {
    return selectorDisplay(this.selector.toQuery());
  }

  get selectorAst(): SelectorAst {
    return this.selector.toJSON();
  }

  locator(selector: SelectorInput): Locator {
    return new Locator(this.selector.descendant(selector), this.sendRequest);
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
    return new Locator(this.selector.ancestor(selector), this.sendRequest);
  }

  and(...selectors: SelectorInput[]): Locator {
    return new Locator(this.selector.and(...selectors), this.sendRequest);
  }

  or(...selectors: SelectorInput[]): Locator {
    return new Locator(this.selector.or(...selectors), this.sendRequest);
  }

  nth(index: number): Locator {
    return new Locator(this.selector.nth(index), this.sendRequest);
  }

  first(): Locator {
    return this.nth(0);
  }

  async click(options?: { alignment?: AlignmentOption; timeout?: number }): Promise<void> {
    const response = await this.sendAction('tap', {
      alignment: options?.alignment ?? 'center',
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'click');
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

  async fill(text: string, options?: { delay?: number; charDelay?: number; timeout?: number }): Promise<void> {
    const response = await this.sendAction('fill', {
      text,
      charDelay: options?.charDelay ?? options?.delay,
      replaceAll: true,
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'fill');
  }

  async scrollIntoView(options?: { alignment?: number; duration?: number; timeout?: number }): Promise<void> {
    const response = await this.sendAction('scrollIntoView', {
      alignment: options?.alignment ?? 0.5,
      duration: options?.duration ?? 300,
      timeout: options?.timeout,
    });
    this.assertSuccessResponse(response, 'scrollIntoView');
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
      ...this.selector.toWireParams({
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
    });
    this.assertSuccessResponse(response, 'fill');
  }

  /** Click using a pre-resolved widget. */
  async clickResolved(resolved: WidgetInfo): Promise<void> {
    const response = await this.sendAction('tap', { targetId: resolved.id });
    this.assertSuccessResponse(response, 'click');
  }

  private async sendAction(action: string, params: Record<string, unknown>): Promise<ActionResponse> {
    return (await this.sendRequest('ext.fliwright.action', {
      action,
      strict: 'true',
      visible: 'hitTestable',
      ...this.selector.toWireParams(),
      ...stringifyDefined(params),
    })) as ActionResponse;
  }

  private assertSuccessResponse(response: unknown, action: string): void {
    if (!response || typeof response !== 'object') return;

    const result = response as ActionResponse;
    if (result.success === false || result.error != null) {
      const message = typeof result.error === 'string' ? result.error : `${action} failed`;
      const debug = result.debug === undefined ? '' : ` debug=${JSON.stringify(result.debug)}`;
      throw new Error(`${message}${debug}`);
    }
  }
}

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
