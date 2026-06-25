import type {
  InteractionSpec,
  SpecAssertion,
  SpecElement,
  SpecFlow,
  SpecStep,
} from '../spec/InteractionSpec.js';
import { parseInteractionSpec } from '../spec/InteractionSpec.js';
import { bestLocatorHint, synthesizeSelectorsForElements } from '../selectors/SelectorSynthesizer.js';
import type { SelectorSynthesisResult, WidgetCandidate } from '../selectors/SelectorSynthesizer.js';

export interface RedFirstTestGeneratorOptions {
  flowId?: string;
  testName?: string;
  homeRoute?: string;
  resetToHomeBeforeEach?: boolean;
  widgets?: WidgetCandidate[];
}

export interface RedFirstTestSuiteGeneratorOptions extends Omit<RedFirstTestGeneratorOptions, 'flowId' | 'testName'> {
  flowIds?: string[];
  testNamePrefix?: string;
}

export interface GenerateRedFirstTestResult {
  testCode: string;
  testName: string;
  flowId?: string;
  warnings: string[];
  selectorDiagnostics: SelectorSynthesisResult[];
}

export interface GenerateRedFirstTestSuiteResult {
  testCode: string;
  tests: Array<{
    testName: string;
    flowId?: string;
    warnings: string[];
  }>;
  warnings: string[];
  selectorDiagnostics: SelectorSynthesisResult[];
}

export function generateRedFirstTest(
  spec: InteractionSpec,
  options: RedFirstTestGeneratorOptions = {},
): GenerateRedFirstTestResult {
  spec = parseInteractionSpec(spec);
  const warnings: string[] = [];
  const flow = selectFlow(spec, options.flowId);
  if (!flow) throw new Error('InteractionSpec must include at least one flow.');

  const elements = new Map(spec.elements.map((element) => [element.id, element]));
  const testName = options.testName ?? flow.name;
  const resetToHomeBeforeEach = options.resetToHomeBeforeEach ?? true;
  const homeRoute = options.homeRoute ?? spec.initialState?.route ?? spec.app?.route ?? '/';
  const assertions = [...(flow.expectedOutcome ?? []), ...(spec.assertions ?? [])];
  const needsMock = assertions.some((assertion) => assertion.kind === 'mockCalled');
  const widgets = options.widgets ?? [];
  const selectorDiagnostics = synthesizeSelectorsForElements(spec.elements, widgets);

  const lines: string[] = [];
  const imports = resetToHomeBeforeEach ? 'test, expect, beforeEach' : 'test, expect';
  lines.push(`import { ${imports} } from '@fliwright/vitest';`);
  lines.push('');

  if (resetToHomeBeforeEach) {
    lines.push('beforeEach(async ({ page }) => {');
    lines.push(`  await page.resetToHome({ homeRoute: ${stringLiteral(homeRoute)} });`);
    lines.push('});');
    lines.push('');
  }

  lines.push(`test(${stringLiteral(testName)}, async ({ ${needsMock ? 'page, mock' : 'page'} }) => {`);
  for (const step of flow.steps) appendStep(lines, step, elements, widgets, warnings);
  for (const assertion of assertions) appendAssertion(lines, assertion, elements, widgets, warnings);
  if (flow.steps.length === 0 && assertions.length === 0) {
    warnings.push(`Flow '${flow.id}' has no steps or assertions.`);
  }
  lines.push('});');

  return {
    testCode: lines.join('\n'),
    testName,
    flowId: flow.id,
    warnings,
    selectorDiagnostics,
  };
}

export function generateRedFirstTestSuite(
  spec: InteractionSpec,
  options: RedFirstTestSuiteGeneratorOptions = {},
): GenerateRedFirstTestSuiteResult {
  spec = parseInteractionSpec(spec);
  const warnings: string[] = [];
  const flows = selectFlows(spec, options.flowIds);
  const elements = new Map(spec.elements.map((element) => [element.id, element]));
  const resetToHomeBeforeEach = options.resetToHomeBeforeEach ?? true;
  const homeRoute = options.homeRoute ?? spec.initialState?.route ?? spec.app?.route ?? '/';
  const widgets = options.widgets ?? [];
  const selectorDiagnostics = synthesizeSelectorsForElements(spec.elements, widgets);
  const lines = testFilePreamble({ resetToHomeBeforeEach, homeRoute });
  const tests: GenerateRedFirstTestSuiteResult['tests'] = [];

  for (const flow of flows) {
    const flowWarnings: string[] = [];
    const testName = options.testNamePrefix ? `${options.testNamePrefix}: ${flow.name}` : flow.name;
    appendTest(lines, flow, testName, elements, spec.assertions ?? [], widgets, flowWarnings);
    tests.push({ testName, flowId: flow.id, warnings: flowWarnings });
    warnings.push(...flowWarnings.map((warning) => `[${flow.id}] ${warning}`));
  }

  return {
    testCode: lines.join('\n'),
    tests,
    warnings,
    selectorDiagnostics,
  };
}

function selectFlow(spec: InteractionSpec, flowId: string | undefined): SpecFlow | undefined {
  if (!flowId) return spec.flows[0];
  const flow = spec.flows.find((candidate) => candidate.id === flowId);
  if (!flow) throw new Error(`Flow '${flowId}' was not found in InteractionSpec.flows.`);
  return flow;
}

function selectFlows(spec: InteractionSpec, flowIds: string[] | undefined): SpecFlow[] {
  if (!flowIds?.length) return spec.flows;
  const flows = flowIds.map((flowId) => {
    const flow = spec.flows.find((candidate) => candidate.id === flowId);
    if (!flow) throw new Error(`Flow '${flowId}' was not found in InteractionSpec.flows.`);
    return flow;
  });
  return flows;
}

function testFilePreamble(opts: {
  resetToHomeBeforeEach: boolean;
  homeRoute: string;
}): string[] {
  const lines: string[] = [];
  const imports = opts.resetToHomeBeforeEach ? 'test, expect, beforeEach' : 'test, expect';
  lines.push(`import { ${imports} } from '@fliwright/vitest';`);
  lines.push('');

  if (opts.resetToHomeBeforeEach) {
    lines.push('beforeEach(async ({ page }) => {');
    lines.push(`  await page.resetToHome({ homeRoute: ${stringLiteral(opts.homeRoute)} });`);
    lines.push('});');
    lines.push('');
  }
  return lines;
}

function appendTest(
  lines: string[],
  flow: SpecFlow,
  testName: string,
  elements: Map<string, SpecElement>,
  globalAssertions: SpecAssertion[],
  widgets: WidgetCandidate[],
  warnings: string[],
): void {
  const assertions = [...(flow.expectedOutcome ?? []), ...globalAssertions];
  const needsMock = assertions.some((assertion) => assertion.kind === 'mockCalled');
  lines.push(`test(${stringLiteral(testName)}, async ({ ${needsMock ? 'page, mock' : 'page'} }) => {`);
  for (const step of flow.steps) appendStep(lines, step, elements, widgets, warnings);
  for (const assertion of assertions) appendAssertion(lines, assertion, elements, widgets, warnings);
  if (flow.steps.length === 0 && assertions.length === 0) {
    warnings.push(`Flow '${flow.id}' has no steps or assertions.`);
  }
  lines.push('});');
  lines.push('');
}

function appendStep(
  lines: string[],
  step: SpecStep,
  elements: Map<string, SpecElement>,
  widgets: WidgetCandidate[],
  warnings: string[],
): void {
  const element = elements.get(step.target);
  if (!element) {
    warnings.push(`Step target '${step.target}' was not found in spec.elements.`);
    return;
  }
  const locator = locatorExpression(element, widgets);

  if (step.action === 'tap') {
    lines.push(`  await ${locator}.click();`);
    return;
  }
  if (step.action === 'type') {
    lines.push(`  await ${locator}.fill(${stringLiteral(step.value)});`);
    return;
  }
  if (step.action === 'select') {
    lines.push(`  await ${locator}.selectOption(${stringLiteral(step.value)});`);
    return;
  }
  if (step.action === 'waitFor' || step.action === 'assertVisible') {
    lines.push(`  await expect(${locator}).toBeVisible();`);
  }
}

function appendAssertion(
  lines: string[],
  assertion: SpecAssertion,
  elements: Map<string, SpecElement>,
  widgets: WidgetCandidate[],
  warnings: string[],
): void {
  if (assertion.kind === 'mockCalled') {
    const matcher = assertion.method
      ? `{ path: ${stringLiteral(assertion.endpoint)}, method: ${stringLiteral(assertion.method)} }`
      : stringLiteral(assertion.endpoint);
    lines.push(`  await mock.waitForCall(${matcher});`);
    return;
  }

  if (assertion.kind === 'route') {
    lines.push(`  await expect(await page.currentRoute()).toBe(${stringLiteral(assertion.equals)});`);
    return;
  }

  if (assertion.kind === 'state') {
    warnings.push(`State assertion '${assertion.path}' requires a custom state adapter and was not emitted.`);
    return;
  }

  const element = elements.get(assertion.target);
  if (!element) {
    warnings.push(`Assertion target '${assertion.target}' was not found in spec.elements.`);
    return;
  }

  const locator = locatorExpression(element, widgets);
  if (assertion.kind === 'visible') {
    lines.push(`  await expect(${locator}).toBeVisible();`);
    return;
  }

  if (assertion.equals !== undefined) {
    lines.push(`  await expect(${locator}).toHaveText(${stringLiteral(assertion.equals)});`);
  } else if (assertion.contains !== undefined) {
    lines.push(`  await expect(${locator}).toContainText(${stringLiteral(assertion.contains)});`);
  } else {
    lines.push(`  await expect(${locator}).toBeVisible();`);
  }
}

function locatorExpression(element: SpecElement, widgets: WidgetCandidate[]): string {
  const hint = bestLocatorHint(element, widgets);
  return `page.locator(${locatorInputExpression(hint)})`;
}

function locatorInputExpression(hint: ReturnType<typeof bestLocatorHint>): string {
  if (hint.strategy === 'key') return `{ key: ${stringLiteral(hint.value)} }`;
  if (hint.strategy === 'semantics') return `{ semantics: { label: ${stringLiteral(hint.value)} } }`;
  if (hint.strategy === 'type') return `{ type: ${stringLiteral(hint.value)} }`;
  return `{ text: ${stringLiteral(hint.value)} }`;
}

function stringLiteral(value: string): string {
  return JSON.stringify(value);
}
