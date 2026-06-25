import { parseInteractionSpec } from './InteractionSpec.js';
import type { InteractionSpec, SpecAssertion, SpecElement, SpecFlow } from './InteractionSpec.js';

export type InteractionSpecCoverageGapKind =
  | 'missing-flow-outcome'
  | 'unreferenced-required-element'
  | 'unasserted-required-element';

export interface InteractionSpecCoverageGap {
  kind: InteractionSpecCoverageGapKind;
  path: string;
  message: string;
  elementId?: string;
  flowId?: string;
}

export interface InteractionSpecCoverageReport {
  status: 'complete' | 'has-gaps';
  flowCount: number;
  elementCount: number;
  coveredElementIds: string[];
  assertedElementIds: string[];
  gaps: InteractionSpecCoverageGap[];
}

export function analyzeInteractionSpecCoverage(value: unknown): InteractionSpecCoverageReport {
  const spec = parseInteractionSpec(value);
  const coveredElementIds = new Set<string>();
  const assertedElementIds = new Set<string>();
  const gaps: InteractionSpecCoverageGap[] = [];
  const globalAssertions = spec.assertions ?? [];

  spec.flows.forEach((flow, flowIndex) => {
    collectStepTargets(flow, coveredElementIds);
    collectAssertionTargets(flow.expectedOutcome ?? [], assertedElementIds);

    if ((flow.expectedOutcome?.length ?? 0) === 0 && globalAssertions.length === 0) {
      gaps.push({
        kind: 'missing-flow-outcome',
        path: `$.flows[${flowIndex}].expectedOutcome`,
        flowId: flow.id,
        message: `Flow '${flow.name}' has no expectedOutcome and the spec has no global assertions.`,
      });
    }
  });
  collectAssertionTargets(globalAssertions, assertedElementIds);
  for (const elementId of assertedElementIds) coveredElementIds.add(elementId);

  spec.elements.forEach((element, index) => {
    if (element.importance !== 'required') return;
    if (!coveredElementIds.has(element.id)) {
      gaps.push({
        kind: 'unreferenced-required-element',
        path: `$.elements[${index}]`,
        elementId: element.id,
        message: `Required element '${element.name}' is not referenced by any step or assertion.`,
      });
    }
    if (shouldAssertElement(element) && !assertedElementIds.has(element.id)) {
      gaps.push({
        kind: 'unasserted-required-element',
        path: `$.elements[${index}]`,
        elementId: element.id,
        message: `Required ${element.role} '${element.name}' is not asserted by any expected outcome.`,
      });
    }
  });

  return {
    status: gaps.length > 0 ? 'has-gaps' : 'complete',
    flowCount: spec.flows.length,
    elementCount: spec.elements.length,
    coveredElementIds: [...coveredElementIds].sort(),
    assertedElementIds: [...assertedElementIds].sort(),
    gaps,
  };
}

function collectStepTargets(flow: SpecFlow, coveredElementIds: Set<string>): void {
  for (const step of flow.steps) coveredElementIds.add(step.target);
}

function collectAssertionTargets(assertions: SpecAssertion[], assertedElementIds: Set<string>): void {
  for (const assertion of assertions) {
    if ('target' in assertion) assertedElementIds.add(assertion.target);
  }
}

function shouldAssertElement(element: SpecElement): boolean {
  return element.role === 'text'
    || element.role === 'image'
    || element.role === 'list'
    || element.role === 'checkbox'
    || element.role === 'switch'
    || element.role === 'tab';
}
