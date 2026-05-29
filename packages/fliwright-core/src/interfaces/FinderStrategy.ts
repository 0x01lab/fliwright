import type { WidgetInfo, WidgetMatch } from '../types.js';

export interface FinderStrategy {
  readonly strategyName: string;
  find(query: string): Promise<WidgetMatch[]>;
  describe(widget: WidgetInfo): string;
}
