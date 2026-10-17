import type { RecordedOperation, ResolvedSelector, SelectorQuery, RecordingSelectorCandidate } from './types.js';
import { recordedTargetSchema } from './RunContracts.js';

const priority = { key: 0, semantics: 1, label: 2, ancestor: 3, positional: 4 };

/** Selects only candidates validated synchronously in the event's original widget tree. */
export class RecordedSelectorResolver {
  async resolveUniqueSelector(operation: RecordedOperation): Promise<ResolvedSelector | undefined> {
    const parsed = recordedTargetSchema.safeParse(operation.recordedTarget);
    if (!parsed.success || parsed.data.status !== 'resolved') return undefined;
    const candidates = parsed.data.candidates
      .filter((candidate) => candidate.matchesTarget && candidate.matchCount > 0)
      .sort((a, b) => Number(!isDurable(a)) - Number(!isDurable(b))
        || priority[a.stability] - priority[b.stability]);
    const candidate = candidates[0];
    if (!candidate) return undefined;
    return {
      query: candidate.query, matchCount: candidate.matchCount,
      ambiguous: !isDurable(candidate), stability: candidate.stability,
    };
  }
}

function isDurable(candidate: RecordingSelectorCandidate): boolean {
  const query = candidate.query;
  if (candidate.matchCount !== 1 || hasEphemeralOrPositionalQuery(query)) return false;
  switch (candidate.stability) {
    case 'key': return !!query.match?.key;
    case 'semantics': return !!query.match?.semanticIdentifier;
    case 'label': return !!(query.match?.type || query.match?.role)
      && !!(query.match?.text || query.match?.semanticsLabel || query.match?.tooltip || query.containing?.match?.text);
    case 'ancestor': return !!query.within && hasStableAnchor(query.within)
      && !!query.match && Object.keys(query.match).length > 0;
    case 'positional': return false;
  }
}

function hasStableAnchor(query: SelectorQuery): boolean {
  return !!(query.match?.key || query.match?.semanticIdentifier)
    || (query.and ?? []).some(hasStableAnchor);
}

function hasEphemeralOrPositionalQuery(query: SelectorQuery): boolean {
  return query.position !== undefined || query.fallback !== undefined || query.match?.id !== undefined
    || query.match?.type === 'Widget'
    || [query.within, query.containing, ...(query.and ?? []), ...(query.or ?? [])]
      .some((child) => child !== undefined && hasEphemeralOrPositionalQuery(child));
}
