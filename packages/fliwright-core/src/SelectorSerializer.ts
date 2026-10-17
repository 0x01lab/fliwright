import type { MatchCriteria, SelectorQuery } from './types.js';

/** Keys that have a valid `page.locator({...})` shorthand form. */
const SHORTHAND_KEYS = ['text', 'key', 'type'] as const;

function escapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function matchObject(match: MatchCriteria): string {
  const entries: string[] = [];
  for (const [k, v] of Object.entries(match)) {
    if (typeof v === 'string') entries.push(`${k}: '${escapeValue(v)}'`);
    else if (typeof v === 'number') entries.push(`${k}: ${v}`);
    else if (typeof v === 'boolean') entries.push(`${k}: ${v}`);
  }
  return `{ ${entries.join(', ')} }`;
}

function positionObject(position: NonNullable<SelectorQuery['position']>): string {
  const entries: string[] = [];
  if (position.nth != null) entries.push(`nth: ${position.nth}`);
  if (position.first) entries.push('first: true');
  if (position.last) entries.push('last: true');
  if (position.visible != null) entries.push(`visible: ${position.visible}`);
  return `{ ${entries.join(', ')} }`;
}

/**
 * Serialize a SelectorQuery into a `page.locator(...)` object-literal string.
 *
 * A query with a single text/key/type criterion and no scoping emits the
 * compact shorthand `{ text: 'x' }`. Everything else (role, semanticsLabel,
 * within, containing, position, …) emits the full query form, which is a valid
 * SelectorQuery and therefore a valid `page.locator` argument.
 */
export function serializeSelectorQuery(query: SelectorQuery): string {
  return serializeQuery(query, true);
}

function serializeQuery(query: SelectorQuery, allowShorthand: boolean): string {
  const hasExtras =
    !!(query.within || query.containing || query.position || query.and || query.or || query.filter || query.fallback);

  if (allowShorthand && !hasExtras && query.match) {
    const keys = Object.keys(query.match);
    for (const shorthand of SHORTHAND_KEYS) {
      const value = (query.match as Record<string, unknown>)[shorthand];
      if (typeof value === 'string' && value.length > 0 && keys.length === 1) {
        return `{ ${shorthand}: '${escapeValue(value)}' }`;
      }
    }
  }

  const parts: string[] = [];
  if (query.match) parts.push(`match: ${matchObject(query.match)}`);
  if (query.within) parts.push(`within: ${serializeQuery(query.within, false)}`);
  if (query.containing) parts.push(`containing: ${serializeQuery(query.containing, false)}`);
  if (query.and) parts.push(`and: [${query.and.map(item => serializeQuery(item, false)).join(', ')}]`);
  if (query.or) parts.push(`or: [${query.or.map(item => serializeQuery(item, false)).join(', ')}]`);
  if (query.filter) parts.push(`filter: ${JSON.stringify(query.filter)}`);
  if (query.fallback) parts.push(`fallback: ${JSON.stringify(query.fallback)}`);
  if (query.position) parts.push(`position: ${positionObject(query.position)}`);
  return `{ ${parts.join(', ')} }`;
}
