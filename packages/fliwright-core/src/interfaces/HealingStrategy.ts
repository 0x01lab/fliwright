import type { WidgetSnapshot, HealingResult } from '../types.js';

export interface HealingStrategy {
  readonly strategyName: string;
  score(original: WidgetSnapshot, candidate: WidgetSnapshot): number;
  heal(original: WidgetSnapshot, candidates: WidgetSnapshot[], threshold?: number): HealingResult | null;
}
