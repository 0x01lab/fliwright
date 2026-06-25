import type { LocatorHint, SpecElement } from '../spec/InteractionSpec.js';

export type SelectorSynthesisStatus = 'resolved' | 'ambiguous' | 'missing' | 'hint-only';

export interface WidgetCandidate {
  key?: string;
  text?: string;
  type?: string;
  semanticsLabel?: string;
  role?: string;
}

export interface SelectorCandidate {
  hint: LocatorHint;
  confidence: number;
  reason: string;
  matchedWidgets?: WidgetCandidate[];
}

export interface SelectorTraceStep {
  strategy: LocatorHint['strategy'];
  status: 'selected' | 'candidate' | 'rejected' | 'missing';
  value: string;
  message: string;
}

export interface SelectorSynthesisResult {
  elementId: string;
  status: SelectorSynthesisStatus;
  candidates: SelectorCandidate[];
  trace: SelectorTraceStep[];
  stabilityHints: Array<{
    kind: 'add-key' | 'add-semantics' | 'refine-copy' | 'stale-hint';
    description: string;
  }>;
}

export function synthesizeSelector(
  element: SpecElement,
  widgets: WidgetCandidate[] = [],
): SelectorSynthesisResult {
  const trace: SelectorTraceStep[] = [];
  const candidates = candidateHints(element, widgets)
    .map((hint) => scoreHint(hint, widgets, trace))
    .sort((a, b) => b.confidence - a.confidence);

  const selected = candidates[0];
  const status = statusFor(selected, widgets);
  if (selected) {
    trace.push({
      strategy: selected.hint.strategy,
      status: 'selected',
      value: selected.hint.value,
      message: `Selected ${selected.hint.strategy} locator with confidence ${selected.confidence.toFixed(2)}.`,
    });
  }

  return {
    elementId: element.id,
    status,
    candidates,
    trace,
    stabilityHints: stabilityHintsFor(element, selected, status),
  };
}

export function synthesizeSelectorsForElements(
  elements: SpecElement[],
  widgets: WidgetCandidate[] = [],
): SelectorSynthesisResult[] {
  return elements.map((element) => synthesizeSelector(element, widgets));
}

export function bestLocatorHint(element: SpecElement, widgets: WidgetCandidate[] = []): LocatorHint {
  return synthesizeSelector(element, widgets).candidates[0]?.hint ?? {
    strategy: 'text',
    value: element.text ?? element.placeholder ?? element.name,
  };
}

function candidateHints(element: SpecElement, widgets: WidgetCandidate[]): LocatorHint[] {
  const hints = [...(element.locatorHints ?? [])];
  hints.push(...stableWidgetHints(element, widgets));
  if (element.text) hints.push({ strategy: 'text', value: element.text });
  if (element.placeholder) hints.push({ strategy: 'semantics', value: element.placeholder });
  if (element.name && !hints.some((hint) => hint.value === element.name)) {
    hints.push({ strategy: 'text', value: element.name });
  }
  return uniqueHints(hints);
}

function uniqueHints(hints: LocatorHint[]): LocatorHint[] {
  const seen = new Set<string>();
  return hints.filter((hint) => {
    const key = `${hint.strategy}:${hint.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableWidgetHints(element: SpecElement, widgets: WidgetCandidate[]): LocatorHint[] {
  if (widgets.length === 0) return [];
  const matches = widgets.filter((widget) => widgetLooksLikeElement(widget, element));
  if (matches.length !== 1) return [];

  const match = matches[0];
  const hints: LocatorHint[] = [];
  if (match.key) hints.push({ strategy: 'key', value: match.key });
  if (match.semanticsLabel) hints.push({ strategy: 'semantics', value: match.semanticsLabel });
  return hints;
}

function widgetLooksLikeElement(widget: WidgetCandidate, element: SpecElement): boolean {
  const roleMatches = !widget.role || widget.role === element.role;
  if (!roleMatches) return false;

  const elementLabels = [element.text, element.placeholder, element.name]
    .filter((value): value is string => Boolean(value));
  const widgetLabels = [widget.text, widget.semanticsLabel]
    .filter((value): value is string => Boolean(value));
  return elementLabels.some((label) => widgetLabels.includes(label));
}

function scoreHint(hint: LocatorHint, widgets: WidgetCandidate[], trace: SelectorTraceStep[]): SelectorCandidate {
  const matchedWidgets = widgets.length > 0 ? widgets.filter((widget) => widgetMatchesHint(widget, hint)) : undefined;
  const base = baseConfidence(hint.strategy);
  const confidence = matchedWidgets
    ? confidenceFromMatches(base, matchedWidgets.length)
    : base;

  trace.push({
    strategy: hint.strategy,
    status: matchedWidgets && matchedWidgets.length === 0 ? 'missing' : 'candidate',
    value: hint.value,
    message: matchedWidgets
      ? `${matchedWidgets.length} widget candidate(s) matched ${hint.strategy}='${hint.value}'.`
      : `No widget snapshot provided; using ${hint.strategy}='${hint.value}' as a generated hint.`,
  });

  return {
    hint,
    confidence,
    reason: reasonFor(hint, matchedWidgets),
    matchedWidgets,
  };
}

function confidenceFromMatches(base: number, matchCount: number): number {
  if (matchCount === 1) return Math.min(0.99, base + 0.08);
  if (matchCount === 0) return 0.1;
  return Math.max(0.2, base - matchCount * 0.12);
}

function widgetMatchesHint(widget: WidgetCandidate, hint: LocatorHint): boolean {
  if (hint.strategy === 'key') return widget.key === hint.value;
  if (hint.strategy === 'semantics') return widget.semanticsLabel === hint.value;
  if (hint.strategy === 'type') return widget.type === hint.value;
  return widget.text === hint.value;
}

function baseConfidence(strategy: LocatorHint['strategy']): number {
  if (strategy === 'key') return 0.95;
  if (strategy === 'semantics') return 0.88;
  if (strategy === 'text') return 0.72;
  return 0.45;
}

function reasonFor(hint: LocatorHint, matchedWidgets: WidgetCandidate[] | undefined): string {
  if (!matchedWidgets) return `${hint.strategy} hint is available from the interaction spec.`;
  if (matchedWidgets.length === 1) return `${hint.strategy} matches exactly one widget candidate.`;
  if (matchedWidgets.length > 1) return `${hint.strategy} matches multiple widget candidates.`;
  return `${hint.strategy} did not match the provided widget candidates.`;
}

function statusFor(candidate: SelectorCandidate | undefined, widgets: WidgetCandidate[]): SelectorSynthesisStatus {
  if (!candidate) return 'missing';
  if (!candidate.matchedWidgets) return 'hint-only';
  if (candidate.matchedWidgets.length === 1) return 'resolved';
  if (candidate.matchedWidgets.length > 1) return 'ambiguous';
  return widgets.length > 0 ? 'missing' : 'hint-only';
}

function stabilityHintsFor(
  element: SpecElement,
  selected: SelectorCandidate | undefined,
  status: SelectorSynthesisStatus,
): SelectorSynthesisResult['stabilityHints'] {
  const hints: SelectorSynthesisResult['stabilityHints'] = [];
  const hasStableHint = element.locatorHints?.some((hint) => hint.strategy === 'key' || hint.strategy === 'semantics') ?? false;
  const selectedStableHint = selected?.hint.strategy === 'key' || selected?.hint.strategy === 'semantics';
  const staleStableHints = (element.locatorHints ?? []).filter((hint) => (
    (hint.strategy === 'key' || hint.strategy === 'semantics')
    && selected?.hint.value !== hint.value
  ));
  for (const hint of staleStableHints) {
    hints.push({
      kind: 'stale-hint',
      description: `Stable ${hint.strategy} locator '${hint.value}' did not match the current widget snapshot for '${element.name}'.`,
    });
  }
  if (!hasStableHint && !selectedStableHint) {
    hints.push({
      kind: 'add-key',
      description: `Add a stable Key for '${element.name}' so generated TDD tests do not depend on visible copy.`,
    });
    hints.push({
      kind: 'add-semantics',
      description: `Add a semantics label for '${element.name}' if this widget is user-facing or accessibility-relevant.`,
    });
  }
  if (status === 'ambiguous') {
    hints.push({
      kind: 'refine-copy',
      description: `The locator '${selected?.hint.value ?? element.name}' matches multiple widgets; refine copy or add a unique key.`,
    });
  }
  return hints;
}
