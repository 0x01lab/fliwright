import type { WidgetInfo, SelectorInput, SendRequest } from './types.js';
import { Selector } from './Selector.js';

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

  async longPress(options?: { duration?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selectorString}`);
    }
    const params: Record<string, unknown> = {
      gesture: 'longPress',
      selector: this.selector.toWireFormat(),
    };
    if (options?.duration != null) {
      params.duration = options.duration;
    }
    await this.sendRequest('ext.fliwright.gesture', params);
  }

  async drag(deltaX: number, deltaY: number, options?: { steps?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selectorString}`);
    }
    const params: Record<string, unknown> = {
      gesture: 'drag',
      selector: this.selector.toWireFormat(),
      deltaX,
      deltaY,
    };
    if (options?.steps != null) {
      params.steps = options.steps;
    }
    await this.sendRequest('ext.fliwright.gesture', params);
  }

  async pinch(scale: number, options?: { steps?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selectorString}`);
    }
    const params: Record<string, unknown> = {
      gesture: 'pinch',
      selector: this.selector.toWireFormat(),
      scale,
    };
    if (options?.steps != null) {
      params.steps = options.steps;
    }
    await this.sendRequest('ext.fliwright.gesture', params);
  }

  async type(text: string, options?: { delay?: number; charDelay?: number }): Promise<void> {
    await this.sendType(text, options);
  }

  async fill(text: string, options?: { delay?: number; charDelay?: number }): Promise<void> {
    await this.sendType(text, { ...options, replaceAll: true });
  }

  private async sendType(
    text: string,
    options?: { delay?: number; charDelay?: number; replaceAll?: boolean },
  ): Promise<void> {
    const params: Record<string, unknown> = {
      ...this.selector.toWireParams(),
      text,
    };
    const charDelay = options?.charDelay ?? options?.delay;
    if (charDelay != null) {
      params.charDelay = String(charDelay);
    }
    if (options?.replaceAll === true) {
      params.replaceAll = 'true';
    }
    const response = await this.sendRequest('ext.fliwright.type', params);
    this.assertSuccessResponse(response, 'type');
  }

  private assertSuccessResponse(response: unknown, action: string): void {
    if (!response || typeof response !== 'object') return;

    const result = response as { success?: unknown; error?: unknown; debug?: unknown };
    if (result.success === false) {
      const message = typeof result.error === 'string' ? result.error : `${action} failed`;
      const debug = result.debug === undefined ? '' : ` debug=${JSON.stringify(result.debug)}`;
      const error = `${message}${debug}`;
      throw new Error(error);
    }
  }

  async scrollIntoView(options?: { alignment?: number; duration?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selector.toWireFormat()}`);
    }
    await this.sendRequest('ext.fliwright.scrollIntoView', {
      selector: this.selector.toWireFormat(),
      alignment: options?.alignment ?? 0.5,
      duration: options?.duration ?? 300,
    });
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
