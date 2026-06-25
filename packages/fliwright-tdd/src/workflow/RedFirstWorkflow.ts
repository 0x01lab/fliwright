import { generateRedFirstTest } from '../generator/RedFirstTestGenerator.js';
import type { RedFirstTestGeneratorOptions } from '../generator/RedFirstTestGenerator.js';
import type { InteractionSpec } from '../spec/InteractionSpec.js';
import { analyzeInteractionSpecCoverage } from '../spec/InteractionSpecCoverage.js';
import type { InteractionSpecCoverageReport } from '../spec/InteractionSpecCoverage.js';
import type { SelectorSynthesisResult } from '../selectors/SelectorSynthesizer.js';

export type RedFirstWorkflowStatus =
  | 'ready-to-run'
  | 'needs-output-file'
  | 'needs-coverage-review'
  | 'needs-selector-review';

export interface RedFirstWorkflowOptions extends RedFirstTestGeneratorOptions {
  testFile?: string;
}

export interface RedFirstWorkflowContext {
  testName: string;
  flowId?: string;
  testFile?: string;
  selectorDiagnostics: SelectorSynthesisResult[];
}

export interface RedFirstWorkflowPlan {
  status: RedFirstWorkflowStatus;
  context: RedFirstWorkflowContext;
  coverage: InteractionSpecCoverageReport;
}

export interface PrepareRedFirstWorkflowResult {
  testCode: string;
  testName: string;
  flowId?: string;
  warnings: string[];
  selectorDiagnostics: SelectorSynthesisResult[];
  workflow: RedFirstWorkflowPlan;
}

export function prepareRedFirstWorkflow(
  spec: InteractionSpec,
  options: RedFirstWorkflowOptions = {},
): PrepareRedFirstWorkflowResult {
  const generated = generateRedFirstTest(spec, options);
  const coverage = analyzeInteractionSpecCoverage(spec);
  const context: RedFirstWorkflowContext = {
    testName: generated.testName,
    flowId: generated.flowId,
    testFile: options.testFile,
    selectorDiagnostics: generated.selectorDiagnostics,
  };
  const status = workflowStatus(context, coverage);

  return {
    ...generated,
    workflow: {
      status,
      context,
      coverage,
    },
  };
}

function workflowStatus(
  context: RedFirstWorkflowContext,
  coverage: InteractionSpecCoverageReport,
): RedFirstWorkflowStatus {
  const needsSelectorReview = context.selectorDiagnostics.some((diagnostic) => (
    diagnostic.status === 'ambiguous'
    || diagnostic.status === 'missing'
    || diagnostic.status === 'hint-only'
  ));
  if (needsSelectorReview) return 'needs-selector-review';
  if (coverage.status === 'has-gaps') return 'needs-coverage-review';
  if (!context.testFile) return 'needs-output-file';
  return 'ready-to-run';
}
