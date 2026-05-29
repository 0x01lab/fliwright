import type { WidgetInfo, SelectorInput } from './types.js';
import { Selector } from './Selector.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class Locator {
  private readonly selector: Selector;

  constructor(
    input: SelectorInput,
    private sendRequest: SendRequest,
  ) {
    this.selector = new Selector(input);
  }

  get selectorString(): string {
    return this.selector.toWireFormat();
  }

  async click(): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selectorString}`);
    }
    const widget = widgets[0];
    if (!widget.rect) {
      throw new Error(`Widget matching ${this.selectorString} has no render bounds`);
    }
    const x = widget.rect.x + widget.rect.width / 2;
    const y = widget.rect.y + widget.rect.height / 2;
    await this.sendRequest('ext.fliwright.click', { x, y });
  }

  async type(text: string, options?: { delay?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selectorString}`);
    }
    const params: Record<string, unknown> = {
      ...this.selector.toWireParams(),
      text,
    };
    if (options?.delay != null) {
      params.delay = options.delay;
    }
    await this.sendRequest('ext.fliwright.type', params);
  }

  async count(): Promise<number> {
    const widgets = await this._resolve();
    return widgets.length;
  }

  async isVisible(): Promise<boolean> {
    const widgets = await this._resolve();
    return widgets.length > 0 && widgets[0].rect != null;
  }

  private async _resolve(): Promise<WidgetInfo[]> {
    const result = (await this.sendRequest('ext.fliwright.inspect', {
      ...this.selector.toWireParams(),
    })) as { widgets: WidgetInfo[] };
    return result.widgets ?? [];
  }
}
