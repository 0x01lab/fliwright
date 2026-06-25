import type { TddCycleResult } from '../types.js';

/**
 * Reload-vs-restart decision policy (design spec §6.4).
 *
 * Default mode is heuristic + path-based (no analyzer dependency). A later opt-in `strategy:
 * 'precise'` upgrade would add AST-diff signals; the heuristic here is the safe default and errs
 * toward "restart once more than be stale" only for signals that path inspection alone proves
 * structural (generated code, pubspec/assets/l10n). Plain `.dart` changes are treated as reload;
 * if reload fails to reflect a structural edit, the loop's auto-escalation (see `TddRuntime.cycle`)
 * promotes the next pass to restart.
 */

/** Sync level the runtime should perform for this change set. */
export type SyncDecision = TddCycleResult['lastSync'];

/**
 * File-path suffixes that are generated and therefore always structural: a change here can never
 * be hot-reloaded and must trigger a restart.
 */
const GENERATED_SUFFIXES = [
  '.g.dart',
  '.freezed.dart',
  '.gr.dart', // go_router codegen
  '.mocks.dart', // mockito codegen
  '.gen.dart',
];

/** Basenames / path segments that imply structural app changes. */
const STRUCTURAL_BASENAMES = new Set([
  'pubspec.yaml',
  'pubspec.lock',
]);

/** Path segments that imply resource directories the VM cannot reload. */
const STRUCTURAL_SEGMENTS = new Set(['assets', 'l10n']);

/** Path fragments that imply resource changes the VM cannot reload. */
const STRUCTURAL_FRAGMENTS = ['i18n'];

/**
 * Decide the sync level for a set of changed file paths since the last sync.
 *
 * - no changes → `none`
 * - any generated / pubspec / assets / l10n path → `restart`
 * - otherwise (plain `.dart` bodies, literals, UI) → `reload`
 */
export function decideSync(changes: readonly string[] = []): SyncDecision {
  if (changes.length === 0) return 'none';
  for (const change of changes) {
    if (isStructuralFileChange(change)) return 'restart';
  }
  return 'reload';
}

/** True when a single changed path is provably structural by inspection alone. */
export function isStructuralFileChange(changePath: string): boolean {
  const lower = changePath.toLowerCase();
  if (GENERATED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  const segments = lower.split('/');
  const base = segments.pop() ?? lower;
  if (STRUCTURAL_BASENAMES.has(base)) return true;
  if (segments.some((segment) => STRUCTURAL_SEGMENTS.has(segment))) return true;
  return STRUCTURAL_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Failure kinds whose presence after a `reload` strongly suggests the reload did not reflect a
 * structural edit (a provider/route/declaration that only a restart can pick up). Used by the loop's
 * reload→restart auto-escalation.
 */
const STRUCTURAL_FAILURE_KINDS: ReadonlySet<TddFailureKindForEscalation> = new Set([
  'missing-element',
  'ambiguous-element',
  'state-mismatch',
  'navigation-failed',
]);

/** Narrowed view of {@link TddCycleResult} failure kinds relevant to escalation. */
type TddFailureKindForEscalation = NonNullable<NonNullable<TddCycleResult['failureContext']>['kind']>;

/**
 * True when a red cycle result looks like a reload that failed to reflect a structural change and
 * is therefore worth retrying with a restart.
 */
export function looksStructuralAfterReload(result: Pick<TddCycleResult, 'status' | 'lastSync' | 'failureContext'>): boolean {
  if (result.status !== 'red') return false;
  if (result.lastSync !== 'reload') return false;
  const kind = result.failureContext?.kind;
  return kind !== undefined && STRUCTURAL_FAILURE_KINDS.has(kind);
}
