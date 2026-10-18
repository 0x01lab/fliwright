import { z } from 'zod';
export const FlowListParamsSchema = z.object({
});

export const FlowGetParamsSchema = z.object({
  id: z.string().optional().describe('Flow id under .fliwright/flows'),
  path: z.string().optional().describe('Direct path to a .flow.json file'),
});

export const FlowBindFigmaParamsSchema = z.object({
  id: z.string().optional().describe('Flow id under .fliwright/flows'),
  path: z.string().optional().describe('Direct path to a .flow.json file'),
  flowNodeId: z.string().describe('Flow node id to bind to a Figma node'),
  figmaUrl: z.string().optional().describe('Figma URL. When provided, fileKey and node id are parsed from it.'),
  fileKey: z.string().optional().describe('Figma file key when figmaUrl is not provided'),
  figmaNodeId: z.string().optional().describe('Figma node id, e.g. 120:340'),
  name: z.string().optional().describe('Readable Figma node or frame name'),
  codeConnectId: z.string().optional().describe('Figma Code Connect id or local mapping key'),
  componentName: z.string().optional().describe('Expected code component name'),
});

export const FlowAgentSpecParamsSchema = z.object({
  id: z.string().optional().describe('Flow id under .fliwright/flows'),
  path: z.string().optional().describe('Direct path to a .flow.json file'),
});

export const FlowCleanParamsSchema = FlowAgentSpecParamsSchema.extend({
  outputPath: z.string().optional().describe('Path to write cleaned flow JSON. Defaults to updating the input flow.'),
  dryRun: z.boolean().optional().describe('Return clean plan and cleaned flow without writing. Default false.'),
  aiProvider: z.enum(['claude', 'codex', 'custom-cli', 'mock', 'none']).optional().describe('AI provider used for cleaning. Defaults to FLIWRIGHT_AI_PROVIDER.'),
  aiTimeoutMs: z.number().optional().describe('AI invocation timeout in milliseconds.'),
  protectedNodeIds: z.array(z.string()).optional().describe('Flow node ids to always keep.'),
  instructions: z.string().optional().describe('Additional cleaning instructions for the AI.'),
});

export const FlowReviewPlanParamsSchema = z.object({
  id: z.string().optional().describe('Flow id under .fliwright/flows'),
  path: z.string().optional().describe('Direct path to a .flow.json file'),
  pixelDiffTolerance: z.number().optional().describe('Allowed visual diff ratio, default 0.03'),
  layoutPxTolerance: z.number().optional().describe('Allowed layout delta in px, default 4'),
});

export const FlowReviewCaptureRuntimeParamsSchema = FlowReviewPlanParamsSchema.extend({
  pixelRatio: z.number().optional().default(1).describe('Runtime screenshot pixel ratio, default 1'),
  outputDir: z.string().optional().describe('Directory to write runtime screenshots. Defaults to .fliwright/reviews/<flowId>-<timestamp>.'),
  targetIds: z.array(z.string()).optional().describe('Optional subset of flow node ids to capture'),
  limit: z.number().optional().describe('Optional max number of targets to capture'),
});

export const FlowReviewBundleParamsSchema = FlowReviewPlanParamsSchema.extend({
  outputDir: z.string().optional().describe('Review artifact root directory. Defaults to .fliwright/reviews/<flowId>.'),
  outputPath: z.string().optional().describe('Optional path to write the review bundle JSON.'),
});

export const FlowReviewCaptureFigmaParamsSchema = FlowReviewPlanParamsSchema.extend({
  outputDir: z.string().optional().describe('Directory for Figma screenshots. Defaults to .fliwright/reviews/<flowId>/figma.'),
  capturesFile: z.string().optional().describe('Path to write figma-captures.json.'),
  accessToken: z.string().optional().describe('Figma access token. Defaults to FIGMA_ACCESS_TOKEN or FIGMA_TOKEN.'),
  scale: z.number().optional().describe('Figma image render scale.'),
});

export const FlowReviewRunParamsSchema = FlowReviewPlanParamsSchema.extend({
  outputDir: z.string().optional().describe('Review artifact root directory. Defaults to .fliwright/reviews/<flowId>-<timestamp>.'),
  accessToken: z.string().optional().describe('Figma access token. Defaults to FIGMA_ACCESS_TOKEN or FIGMA_TOKEN.'),
  scale: z.number().optional().describe('Figma image render scale.'),
  pixelRatio: z.number().optional().default(1).describe('Runtime screenshot pixel ratio, default 1.'),
  pixelThreshold: z.number().optional().describe('Per-pixel RGBA delta threshold used by autoCompare. Default 0.'),
  autoCompare: z.boolean().optional().default(true).describe('Automatically compare runtime/Figma PNG screenshots. Default true.'),
  targetIds: z.array(z.string()).optional().describe('Optional subset of flow node ids to capture.'),
  limit: z.number().optional().describe('Optional max number of targets to capture.'),
});

export const FlowReviewArtifactSchema = z.object({
  flowNodeId: z.string(),
  screenshotPath: z.string().optional(),
  error: z.string().optional(),
});

const FlowReviewComparisonSchema = z.object({
  flowNodeId: z.string(),
  pixelDiff: z.number().optional(),
  layoutPx: z.number().optional(),
  textMismatches: z.array(z.string()).optional(),
  tokenMismatches: z.array(z.string()).optional(),
  componentMismatches: z.array(z.string()).optional(),
  error: z.string().optional(),
  notes: z.string().optional(),
});

export const FlowReviewReportParamsSchema = FlowReviewPlanParamsSchema.extend({
  runtimeCapturesFile: z.string().optional().describe('JSON array file of runtime captures; exclusive with runtimeCaptures'),
  figmaCapturesFile: z.string().optional().describe('JSON array file of Figma captures; exclusive with figmaCaptures'),
  runtimeCaptures: z.array(FlowReviewArtifactSchema).optional().describe('Runtime screenshots produced by fliwright flow review-capture-runtime'),
  figmaCaptures: z.array(FlowReviewArtifactSchema).optional().describe('Figma screenshots produced by Figma MCP or other design export'),
  comparisons: z.array(FlowReviewComparisonSchema).optional().describe('Optional visual/text/token comparison metrics from a diff engine'),
  autoCompare: z.boolean().optional().default(true).describe('Automatically compare runtime/Figma PNG screenshots when both paths are available. Default true.'),
  pixelThreshold: z.number().optional().describe('Per-pixel RGBA delta threshold used by autoCompare. Default 0.'),
  outputPath: z.string().optional().describe('Path to write the review report JSON. Defaults to .fliwright/reviews/<flowId>-report.json'),
});

export const FlowGenerateTestParamsSchema = FlowAgentSpecParamsSchema.extend({
  testName: z.string().optional().describe('Generated test name. Defaults to flow title or id.'),
  outputFile: z.string().optional().describe('Optional path to write the generated test skeleton'),
  resetToHomeBeforeEach: z.boolean().optional().describe('Generate a beforeEach page.resetToHome hook'),
  homeRoute: z.string().optional().describe('Home route used by the beforeEach reset hook'),
  useFlowSteps: z.boolean().optional().describe('Wrap each flow node in flow.step calls; default true'),
});

export const FlowValidateParamsSchema = FlowAgentSpecParamsSchema.extend({
  requireFigmaForFigmaNodes: z.boolean().optional().describe('Require figma nodes to have fileKey/nodeId. Default true.'),
  requireCodeTargetForFigmaNodes: z.boolean().optional().describe('Warn when Figma-bound nodes lack componentName/codeConnectId'),
  requireReviewRuntimeEntryForFigmaNodes: z.boolean().optional().describe('Warn when Figma-bound nodes lack route/selector/recording screenshot entry points'),
});

