import type { WidgetInfo } from './types.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class Locator {
  constructor(
    private selector: string,
    private sendRequest: SendRequest,
  ) {}

  async click(): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selector}`);
    }
    const widget = widgets[0];
    if (!widget.rect) {
      throw new Error(`Widget matching ${this.selector} has no render bounds`);
    }
    const x = widget.rect.x + widget.rect.width / 2;
    const y = widget.rect.y + widget.rect.height / 2;
    await this.sendRequest('ext.fliwright.click', { x, y });
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
      selector: this.selector,
    })) as { widgets: WidgetInfo[] };
    return result.widgets ?? [];
  }
}
