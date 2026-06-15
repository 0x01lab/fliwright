import type {
  RecordedOperation,
  ResolvedSelector,
  SelectorQuery,
  WidgetInfo,
} from './types.js';
import { buildBaseSelector } from './SelectorResolver.js';
import { serializeSelectorQuery } from './SelectorSerializer.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

const RESOLVE_LIMIT = 8;
const NTH_LIMIT = 64;
const MAX_KEYED_ANCESTORS = 3;

interface ResolveOutcome {
  count: number;
  matches: WidgetInfo[];
}

/**
 * Resolves a recorded operation to a SelectorQuery that is unique at record
 * time. Pipeline: hitTest → buildBaseSelector → resolve(count) → adaptive
 * disambiguation (within keyed ancestor → containing descendant text → nth).
 *
 * Uniqueness semantics: count === 1 → unique; count === 0 → unverifiable,
 * keep the base selector (best-effort); count > 1 → disambiguate; a resolve
 * *failure* (exception) → keep the base selector but flag ambiguous.
 */
export class RecordedSelectorResolver {
  constructor(private readonly sendRequest: SendRequest) {}

  async resolveUniqueSelector(op: RecordedOperation): Promise<ResolvedSelector> {
    const widget = await this.hitTest(op);
    if (!widget?.type) {
      return { query: { match: { type: 'Widget' } }, ambiguous: true, matchCount: 0 };
    }

    const base = buildBaseSelector(widget);
    const initial = await this.countMatches(base);

    // Resolve failed entirely → keep base, flag ambiguous (per spec).
    if (initial === null) {
      return { query: base, ambiguous: true, matchCount: 0 };
    }
    // Exactly one match → done.
    if (initial.count === 1) {
      return { query: base, ambiguous: false, matchCount: 1 };
    }
    // Zero matches → unverifiable (e.g. transient state); keep base, not ambiguous.
    if (initial.count === 0) {
      return { query: base, ambiguous: false, matchCount: 0 };
    }

    // count > 1 → try to disambiguate; fall back to nth (ambiguous).
    const disambiguated = await this.tryDisambiguators(base, widget);
    if (disambiguated) return disambiguated;

    const nthQuery = await this.nthFallback(base, widget, initial);
    return { query: nthQuery, ambiguous: true, matchCount: initial.count };
  }

  private async hitTest(op: RecordedOperation): Promise<Partial<WidgetInfo> | undefined> {
    try {
      const result = (await this.sendRequest('ext.fliwright.hitTest', {
        x: op.position.x,
        y: op.position.y,
      })) as { widget?: Partial<WidgetInfo> };
      return result.widget;
    } catch {
      return undefined;
    }
  }

  /** Returns null when the resolve call itself fails (distinguishes failure from count 0). */
  private async countMatches(query: SelectorQuery, limit = RESOLVE_LIMIT): Promise<ResolveOutcome | null> {
    try {
      const res = (await this.sendRequest('ext.fliwright.resolve', {
        selector: JSON.stringify(query),
        strict: 'false',
        visible: 'any',
        limit: String(limit),
      })) as { count?: number; matches?: WidgetInfo[]; widgets?: WidgetInfo[] };
      return { count: res.count ?? 0, matches: res.matches ?? res.widgets ?? [] };
    } catch {
      return null;
    }
  }

  /** Try within(keyedAncestor) then containing(descendantText); shortest unique wins. */
  private async tryDisambiguators(
    base: SelectorQuery,
    widget: Partial<WidgetInfo>,
  ): Promise<ResolvedSelector | null> {
    const candidates: SelectorQuery[] = [];

    for (const ancestor of (widget.keyedAncestors ?? []).slice(0, MAX_KEYED_ANCESTORS)) {
      candidates.push({ ...base, within: { match: { key: ancestor.key } } });
    }

    if (widget.descendantText && widget.descendantText.trim()) {
      candidates.push({ ...base, containing: { match: { text: widget.descendantText.trim() } } });
    }

    let best: ResolvedSelector | null = null;
    for (const candidate of candidates) {
      const outcome = await this.countMatches(candidate);
      if (outcome !== null && outcome.count === 1) {
        const resolved: ResolvedSelector = {
          query: candidate,
          ambiguous: false,
          matchCount: 1,
        };
        if (
          best === null ||
          serializeSelectorQuery(candidate).length < serializeSelectorQuery(best.query).length
        ) {
          best = resolved;
        }
      }
    }
    return best;
  }

  /** Index the target inside the matched set and return base.nth(index). */
  private async nthFallback(
    base: SelectorQuery,
    widget: Partial<WidgetInfo>,
    initial: ResolveOutcome,
  ): Promise<SelectorQuery> {
    let matches = initial.matches;
    if (matches.length < initial.count) {
      const refill = await this.countMatches(base, NTH_LIMIT);
      if (refill) matches = refill.matches;
    }
    const foundIndex = matches.findIndex((m) => m.id === widget.id);
    const index = foundIndex >= 0 ? foundIndex : 0;
    return { ...base, position: { nth: index } };
  }
}
