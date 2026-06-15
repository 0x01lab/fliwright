# Design: Specificity-Guaranteed Recorder Selectors

- **Date:** 2026-06-15
- **Status:** Approved (pending implementation)
- **Goal owner:** Leo

## Problem

The visual recorder emits selectors like `{ type: 'GestureDetector' }`, which are too
vague to identify the element the user actually interacted with. Recorded scripts repeat
identical selectors across unrelated taps because the resolution step throws away most of
the information that is already available.

### Root cause

`resolveSelector` (`packages/fliwright-core/src/SelectorResolver.ts`) only inspects three
fields in priority order: `text` → `key` → `type`. When the hit-tested widget is an
interactive wrapper (`GestureDetector`, `InkWell`, `IconButton`, …) with no own text or
key — the overwhelmingly common case for tappable list items, cards, and icon buttons —
it falls back to the bare type.

`hitTest` (`packages/fliwright-bridge/lib/src/extensions/recording.dart`) already calls
`InspectExtension.extractWidgetInfo`, which returns `ancestorKey`, `name`,
`semanticsLabel`, `semanticsHint`, `role`, and `rect`. `resolveSelector` ignores all of
them. `hitTest` also returns only a single widget — no descendant content and no full
ancestor chain — and nothing checks whether the resulting selector is unique.

A second gap: `DartCodeGenerator.dartFinder` resolves a selector with a naive regex that
only understands `text`, `key`, `role`, and `type`. Any `within` / `containing` / `nth`
output the TS side produces is silently dropped when generating Dart.

## Goal

Recorded selectors resolve to exactly one element at record time. The recorder must stop
emitting bare `{ type: 'GestureDetector' }`. When an interactive wrapper has no own
identity, reach into its descendants and ancestors. Only fall back to `nth` as a last
resort, flagged with an `// ambiguous` comment so the test stays runnable.

Confirmed decisions:

- **Uniqueness guaranteed at record time** — verify each selector against the live frame.
- **Adaptive-shortest disambiguation** — try `within(keyedAncestor)` →
  `containing(descendantText)` → `nth`/`last`, pick the shortest candidate that yields a
  unique match.
- **nth fallback** — when no disambiguator achieves uniqueness, emit `nth`/`last` plus an
  `// ambiguous` comment.

## Architecture

```
op.position
   │
   ▼
ext.fliwright.hitTest ─► richer WidgetInfo
   │   (existing type/key/text/ancestorKey/name/semantics*/role/rect
   │    + NEW descendantText, descendantIcon, tooltip, keyedAncestors[])
   ▼
RecordedSelectorResolver.buildBase(widget) ─► Selector  (priority cascade)
   │
   ▼
ext.fliwright.resolve(selector, limit) ─► count (+ matched WidgetInfo[])
   │
   ▼   count==1 ?  yes ─► done
   │   no
   ▼
adaptive disambiguation loop (re-resolve each candidate):
   within(keyedAncestor.key) → containing(descendantText) → nth/last
   pick shortest candidate with count==1
   │
   ▼
{ selector: Selector, ambiguous: boolean, matchCount: number }
   │
   ▼
CodeGenerator / DartCodeGenerator  (serialize Selector + optional comment)
```

The base resolver returns a `Selector` instance (the project's existing rich `Selector`
class), not a raw string. This is what lets later steps attach `within` / `containing` /
`position` and lets both codegens serialize it.

## Components

### 1. Dart `_hitTest` enrichment — `packages/fliwright-bridge/lib/src/extensions/recording.dart`

`extractWidgetInfo` on the selected widget gains four optional fields, computed with small
subtree/ancestor walks (single round-trip, no new endpoints):

- `descendantText` — first `Text` / `RichText` / `EditableText` plain text in the subtree
  (the text a wrapper renders).
- `descendantIcon` — `{ codePoint, fontFamily?, fontPackage? }` from the first `Icon`.
- `tooltip` — `IconButton.tooltip`, a wrapping `Tooltip.message`, or nearest ancestor
  `Tooltip`. Reuses existing semantics helpers where possible.
- `keyedAncestors` — `[{ key, type }, …]` walking up, nearest-first, capped at depth 3.
  Lets the resolver pick the tightest ancestor that disambiguates, not just the first key.

Reuses existing helpers (`extractSemantics`, `findAncestorKey`, `findAncestorName`). Adds
two small walkers for descendants (text/icon).

### 2. Wire-protocol extension — `packages/fliwright-core/src/types.ts` + `wire-protocol.ts`

Add the four optional fields to `WidgetInfo` and the matching Zod schema. All new fields
optional → backward compatible. Update the wire-protocol contract test and JSON-schema
export (the guardrail described in the wire-protocol repository memory).

### 3. Structured base selector — `packages/fliwright-core/src/SelectorResolver.ts`

Replace `resolveSelector(widget): string` with a cascade that returns a `Selector`
instance. Priority:

```
text → key → tooltip → semanticsLabel → role → name → semanticsHint
  → ancestorKey → { type, role? }
```

Each step picks the first field the widget actually has. `role?` is attached to the final
type branch when present.

### 4. Verification + disambiguation engine — new `RecordedSelectorResolver` (TS)

`resolveUniqueSelector(op)`:

1. `hitTest` → `buildBase` → candidate `Selector`.
2. `resolve(candidate, limit≈8)` → read `count`.
3. If `count == 1` → return.
4. Else try, re-resolving each, shortest-wins:
   - `candidate.within({ key: a.key })` for each `keyedAncestors` entry (nearest first).
   - `candidate.containing({ text: descendantText })` when `descendantText` exists.
   - `candidate.nth(index)` / `.last()`, where `index` is the target's position in the
     matched set (match by `rect` / `id` from the hitTest widget).
5. Pick the shortest candidate with `count == 1`. If only `nth` works, set
   `ambiguous = true`. Cap total resolve round-trips at ~6 so pathological trees do not
   loop.

### 5. RecorderController — `packages/fliwright-core/src/RecorderController.ts`

Swap `resolveSelector(op)` for `resolveUniqueSelector(op)`. Store
`{ selector, ambiguous, matchCount }` per operation alongside today's selector string, and
thread the flag to codegen.

### 6. Codegen parity — `CodeGenerator.ts` + `DartCodeGenerator.ts`

- **TS** — serialize a structured `Selector` to an object-literal string, handling `match`
  fields, `within`, `containing`, `position.nth/last`. Emit
  `// ambiguous: matched <matchCount>, using nth` above the line when flagged.
- **Dart** — replace the `dartFinder` regex with structured mapping: `within` →
  `find.descendant(of:, matching:)`, `containing` → `find.ancestor(of:, matching:)`,
  `nth` → `.at(i)`, `last` → `.last`, `semantics` → `find.bySemanticsLabel`, `tooltip` →
  `find.byTooltip`, `role` → role-based finder, `icon` → icon-based finder. Restores
  Dart/TS parity that the regex broke.

## Data flow & error handling

- `hitTest` returning empty (animation/transition mid-tap) → existing
  `{ type: 'Widget' }` fallback preserved.
- `resolve` failures/timeouts → keep the base selector (best-effort), set
  `ambiguous = true`, comment it. Recording never aborts over selector specificity.
- Each operation resolves independently; disambiguation state is per-operation.

## Testing

- `SelectorResolver.test.ts` and a new `RecordedSelectorResolver.test.ts` — cascade
  priority plus each disambiguation branch, mocking `hitTest` and `resolve` counts (no
  live device). Covers: unique on first try, `within` wins, `containing` wins, only-`nth`
  (ambiguous flag), empty `hitTest`.
- `CodeGenerator.test.ts` and `DartCodeGenerator.test.ts` — serialization of `within` /
  `containing` / `nth`, ambiguous comment, parity between TS and Dart output.
- `recorder-integration.test.ts` — end-to-end op → selector with a mocked VM service.
- Bridge `recording_test.dart` — `_hitTest` returns the four new fields for known widget
  trees.
- Wire-protocol contract test — extended `WidgetInfo` shape; JSON-schema export updated.

## Scope boundary (YAGNI)

Not doing: ML/AI selector suggestion, a recording-time UI to let users edit selectors,
cross-recording selector dedup, or refactoring the existing `Selector` class. The
`nth`-last-resort + comment keeps every test runnable without over-engineering positional
stability.

## Open notes (decided during review)

- **Priority cascade** — `tooltip` placed above `semanticsLabel`. Revisit if field tests
  show semantics labels are more stable than tooltips for this codebase's widgets.
- **Disambiguation round-trip cap** — ~6 per operation, acceptable latency for a
  stop-recording flow.
