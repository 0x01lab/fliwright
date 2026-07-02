import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  AiRuntime,
  FLIWRIGHT_FLOWS_DIR,
  buildFlowAgentSpec,
  buildFlowReviewBundle,
  buildFlowReviewReport,
  buildFlowReviewPlan,
  buildFlowVisualComparisons,
  captureFigmaReviewScreenshots,
  cleanFlowWithAi,
  FigmaRestScreenshotProvider,
  figmaBindingFromUrl,
  flowFilePath,
  generateFlowTestSkeleton,
  resolveAiConfig,
  validateFlow,
  sanitizeFlowFileId,
  type FlowAgentSpec,
  type FlowCleanPlan,
  type FlowReviewArtifactInput,
  type FlowReviewComparisonInput,
  type FlowReviewPlan,
  type FlowReviewBundle,
  type FlowReviewReport,
  type FlowValidationResult,
  type FliwrightFlowDocument,
  type FliwrightFigmaBinding,
  type FigmaScreenshotProvider,
} from '@fliwright/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { requireDriver } from './screenshot.js';

export const FlowListParamsSchema = z.object({
  cwd: z.string().optional().describe('Workspace root. Defaults to the MCP process cwd.'),
});

export const FlowGetParamsSchema = z.object({
  cwd: z.string().optional().describe('Workspace root. Defaults to the MCP process cwd.'),
  id: z.string().optional().describe('Flow id under .fliwright/flows'),
  path: z.string().optional().describe('Direct path to a .flow.json file'),
});

export const FlowBindFigmaParamsSchema = z.object({
  cwd: z.string().optional().describe('Workspace root. Defaults to the MCP process cwd.'),
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
  cwd: z.string().optional().describe('Workspace root. Defaults to the MCP process cwd.'),
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
  cwd: z.string().optional().describe('Workspace root. Defaults to the MCP process cwd.'),
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

const FlowReviewArtifactSchema = z.object({
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
  runtimeCaptures: z.array(FlowReviewArtifactSchema).optional().describe('Runtime screenshots produced by fliwright_flow_review_capture_runtime'),
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

export interface FlowListItem {
  id: string;
  title?: string;
  source?: FliwrightFlowDocument['source'];
  updatedAt: string;
  path: string;
  nodeCount: number;
  edgeCount: number;
}

export async function handleFlowList(params: z.infer<typeof FlowListParamsSchema>): Promise<{ flows: FlowListItem[] }> {
  const cwd = params.cwd ?? process.cwd();
  const flowsDir = join(cwd, FLIWRIGHT_FLOWS_DIR);
  let entries: string[];
  try {
    entries = await readdir(flowsDir);
  } catch {
    return { flows: [] };
  }

  const flows: FlowListItem[] = [];
  for (const entry of entries.filter((name) => name.endsWith('.flow.json'))) {
    const path = join(flowsDir, entry);
    try {
      const flow = JSON.parse(await readFile(path, 'utf8')) as FliwrightFlowDocument;
      flows.push({
        id: flow.id,
        ...(flow.title ? { title: flow.title } : {}),
        ...(flow.source ? { source: flow.source } : {}),
        updatedAt: flow.updatedAt,
        path,
        nodeCount: flow.nodes.length,
        edgeCount: flow.edges.length,
      });
    } catch {
      // Ignore malformed draft files so one bad flow does not hide the rest.
    }
  }
  flows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { flows };
}

export async function handleFlowGet(params: z.infer<typeof FlowGetParamsSchema>): Promise<{ path?: string; flow?: FliwrightFlowDocument; error?: string }> {
  const cwd = params.cwd ?? process.cwd();
  const path = params.path ?? (params.id ? flowFilePath(cwd, params.id) : undefined);
  if (!path) return { error: 'Pass either id or path.' };

  try {
    return {
      path,
      flow: JSON.parse(await readFile(path, 'utf8')) as FliwrightFlowDocument,
    };
  } catch (error) {
    return {
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function handleFlowBindFigma(
  params: z.infer<typeof FlowBindFigmaParamsSchema>,
): Promise<{ path?: string; flow?: FliwrightFlowDocument; node?: FliwrightFlowDocument['nodes'][number]; error?: string }> {
  const path = resolveFlowPath(params);
  if (!path) return { error: 'Pass either id or path.' };

  let flow: FliwrightFlowDocument;
  try {
    flow = JSON.parse(await readFile(path, 'utf8')) as FliwrightFlowDocument;
  } catch (error) {
    return { path, error: error instanceof Error ? error.message : String(error) };
  }

  const index = flow.nodes.findIndex((node) => node.id === params.flowNodeId);
  if (index === -1) return { path, error: `Flow node not found: ${params.flowNodeId}` };

  const binding = resolveFigmaBinding(params, flow.nodes[index].figma);
  if (!binding.fileKey) return { path, error: 'Pass figmaUrl or fileKey.' };

  const nextNode = {
    ...flow.nodes[index],
    figma: binding,
  };
  const nextFlow: FliwrightFlowDocument = {
    ...flow,
    updatedAt: new Date().toISOString(),
    nodes: flow.nodes.map((node, nodeIndex) => nodeIndex === index ? nextNode : node),
  };

  await writeFile(path, `${JSON.stringify(nextFlow, null, 2)}\n`, 'utf8');
  return { path, flow: nextFlow, node: nextNode };
}

export async function handleFlowAgentSpec(
  params: z.infer<typeof FlowAgentSpecParamsSchema>,
): Promise<{ path?: string; spec?: FlowAgentSpec; error?: string }> {
  const result = await handleFlowGet(params);
  if (!result.flow) return { path: result.path, error: result.error ?? 'Flow not found.' };
  return {
    path: result.path,
    spec: buildFlowAgentSpec(result.flow),
  };
}

export async function handleFlowClean(
  params: z.infer<typeof FlowCleanParamsSchema>,
  aiRuntime?: Pick<AiRuntime, 'generate'>,
): Promise<{ path?: string; outputPath?: string; flow?: FliwrightFlowDocument; plan?: FlowCleanPlan; dryRun?: boolean; error?: string }> {
  const input = FlowCleanParamsSchema.parse(params);
  const result = await handleFlowGet(input);
  if (!result.flow || !result.path) return { path: result.path, error: result.error ?? 'Flow not found.' };

  const runtime = aiRuntime ?? new AiRuntime(resolveAiConfig({
    provider: input.aiProvider,
    timeoutMs: input.aiTimeoutMs,
  }));
  const cleaned = await cleanFlowWithAi(result.flow, {
    ai: runtime,
    timeoutMs: input.aiTimeoutMs,
    protectedNodeIds: input.protectedNodeIds,
    instructions: input.instructions,
  });
  const outputPath = input.outputPath ?? result.path;
  if (!input.dryRun) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(cleaned.flow, null, 2)}\n`, 'utf8');
  }

  return {
    path: result.path,
    outputPath,
    flow: cleaned.flow,
    plan: cleaned.plan,
    dryRun: Boolean(input.dryRun),
  };
}

export async function handleFlowReviewPlan(
  params: z.infer<typeof FlowReviewPlanParamsSchema>,
): Promise<{ path?: string; reviewPlan?: FlowReviewPlan; error?: string }> {
  const result = await handleFlowGet(params);
  if (!result.flow) return { path: result.path, error: result.error ?? 'Flow not found.' };
  return {
    path: result.path,
    reviewPlan: buildFlowReviewPlan(result.flow, {
      pixelDiffTolerance: params.pixelDiffTolerance,
      layoutPxTolerance: params.layoutPxTolerance,
    }),
  };
}

export async function handleFlowReviewCaptureRuntime(
  params: z.infer<typeof FlowReviewCaptureRuntimeParamsSchema>,
  state: ServerState,
): Promise<{ path?: string; outputDir?: string; capturesFile?: string; captures?: Array<{ flowNodeId: string; title: string; route?: string; screenshotPath?: string; status: 'passed' | 'failed'; error?: string }>; error?: string }> {
  const input = FlowReviewCaptureRuntimeParamsSchema.parse(params);
  const planResult = await handleFlowReviewPlan(input);
  if (!planResult.reviewPlan) return { path: planResult.path, error: planResult.error ?? 'Review plan not available.' };

  const driver = requireDriver(state);
  const cwd = input.cwd ?? process.cwd();
  const outputDir = input.outputDir ?? join(cwd, '.fliwright', 'reviews', `${sanitizeFlowFileId(planResult.reviewPlan.flowId)}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });

  const targetIdSet = input.targetIds ? new Set(input.targetIds) : undefined;
  const targets = planResult.reviewPlan.targets
    .filter((target) => !targetIdSet || targetIdSet.has(target.flowNodeId))
    .slice(0, input.limit);
  const captures: Array<{ flowNodeId: string; title: string; route?: string; screenshotPath?: string; status: 'passed' | 'failed'; error?: string }> = [];

  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    try {
      if (target.route) await driver.page.goto(target.route);
      const screenshot = await driver.page.screenshot({ pixelRatio: input.pixelRatio });
      const screenshotPath = join(outputDir, `${String(index + 1).padStart(3, '0')}-${sanitizeFlowFileId(target.flowNodeId)}.png`);
      await writeFile(screenshotPath, screenshot);
      captures.push({
        flowNodeId: target.flowNodeId,
        title: target.title,
        ...(target.route ? { route: target.route } : {}),
        screenshotPath,
        status: 'passed',
      });
    } catch (error) {
      captures.push({
        flowNodeId: target.flowNodeId,
        title: target.title,
        ...(target.route ? { route: target.route } : {}),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const capturesFile = join(outputDir, 'runtime-captures.json');
  await writeFile(capturesFile, `${JSON.stringify(captures, null, 2)}\n`, 'utf8');

  return {
    path: planResult.path,
    outputDir,
    capturesFile,
    captures,
  };
}

export async function handleFlowReviewBundle(
  params: z.infer<typeof FlowReviewBundleParamsSchema>,
): Promise<{ path?: string; outputPath?: string; bundle?: FlowReviewBundle; error?: string }> {
  const input = FlowReviewBundleParamsSchema.parse(params);
  const result = await handleFlowGet(input);
  if (!result.flow) return { path: result.path, error: result.error ?? 'Flow not found.' };
  const outputDir = input.outputDir ?? join(input.cwd ?? process.cwd(), '.fliwright', 'reviews', sanitizeFlowFileId(result.flow.id));
  const bundle = buildFlowReviewBundle(result.flow, {
    flowPath: result.path,
    outputDir,
    pixelDiffTolerance: input.pixelDiffTolerance,
    layoutPxTolerance: input.layoutPxTolerance,
  });
  const outputPath = input.outputPath ?? join(outputDir, `${sanitizeFlowFileId(result.flow.id)}-review-bundle.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  return {
    path: result.path,
    outputPath,
    bundle,
  };
}

export async function handleFlowReviewCaptureFigma(
  params: z.infer<typeof FlowReviewCaptureFigmaParamsSchema>,
  figmaProvider?: FigmaScreenshotProvider,
): Promise<{ path?: string; outputDir?: string; capturesFile?: string; captures?: FlowReviewArtifactInput[]; error?: string }> {
  const input = FlowReviewCaptureFigmaParamsSchema.parse(params);
  const result = await handleFlowGet(input);
  if (!result.flow) return { path: result.path, error: result.error ?? 'Flow not found.' };
  const outputDir = input.outputDir ?? join(input.cwd ?? process.cwd(), '.fliwright', 'reviews', sanitizeFlowFileId(result.flow.id), 'figma');
  const bundle = buildFlowReviewBundle(result.flow, {
    flowPath: result.path,
    outputDir: dirname(outputDir),
    pixelDiffTolerance: input.pixelDiffTolerance,
    layoutPxTolerance: input.layoutPxTolerance,
  });
  const provider = figmaProvider ?? new FigmaRestScreenshotProvider({
    accessToken: input.accessToken,
    scale: input.scale,
  });
  const captures = await captureFigmaReviewScreenshots(bundle.figmaMcp.tasks.map((task) => ({
    ...task,
    screenshotPath: join(outputDir, `${task.screenshotPath.split('/').pop()}`),
    metadataPath: join(outputDir, `${task.metadataPath.split('/').pop()}`),
  })), provider);
  const capturesFile = input.capturesFile ?? join(outputDir, 'figma-captures.json');
  await mkdir(dirname(capturesFile), { recursive: true });
  await writeFile(capturesFile, `${JSON.stringify(captures, null, 2)}\n`, 'utf8');

  return {
    path: result.path,
    outputDir,
    capturesFile,
    captures,
  };
}

export async function handleFlowReviewRun(
  params: z.infer<typeof FlowReviewRunParamsSchema>,
  state: ServerState,
  figmaProvider?: FigmaScreenshotProvider,
): Promise<{
  path?: string;
  outputDir?: string;
  bundlePath?: string;
  runtimeCapturesFile?: string;
  figmaCapturesFile?: string;
  reportPath?: string;
  report?: FlowReviewReport;
  error?: string;
}> {
  const input = FlowReviewRunParamsSchema.parse(params);
  const result = await handleFlowGet(input);
  if (!result.flow) return { path: result.path, error: result.error ?? 'Flow not found.' };

  const cwd = input.cwd ?? process.cwd();
  const outputDir = input.outputDir ?? join(cwd, '.fliwright', 'reviews', `${sanitizeFlowFileId(result.flow.id)}-${Date.now()}`);
  const bundleResult = await handleFlowReviewBundle({
    ...input,
    outputDir,
    outputPath: join(outputDir, `${sanitizeFlowFileId(result.flow.id)}-review-bundle.json`),
  });
  if (!bundleResult.bundle) return { path: result.path, outputDir, error: bundleResult.error ?? 'Review bundle not available.' };

  const runtimeResult = await handleFlowReviewCaptureRuntime({
    ...input,
    outputDir: bundleResult.bundle.artifacts.runtimeDir,
    pixelRatio: input.pixelRatio,
    targetIds: input.targetIds,
    limit: input.limit,
  }, state);
  if (!runtimeResult.captures) return { path: result.path, outputDir, bundlePath: bundleResult.outputPath, error: runtimeResult.error ?? 'Runtime capture failed.' };

  const figmaResult = await handleFlowReviewCaptureFigma({
    ...input,
    outputDir: bundleResult.bundle.artifacts.figmaDir,
    capturesFile: bundleResult.bundle.figmaMcp.capturesFile,
    accessToken: input.accessToken,
    scale: input.scale,
  }, figmaProvider);
  if (!figmaResult.captures) return { path: result.path, outputDir, bundlePath: bundleResult.outputPath, runtimeCapturesFile: runtimeResult.capturesFile, error: figmaResult.error ?? 'Figma capture failed.' };

  const reportResult = await handleFlowReviewReport({
    ...input,
    runtimeCaptures: runtimeResult.captures,
    figmaCaptures: figmaResult.captures,
    autoCompare: input.autoCompare,
    pixelThreshold: input.pixelThreshold,
    outputPath: bundleResult.bundle.artifacts.reportPath,
  });

  return {
    path: result.path,
    outputDir,
    bundlePath: bundleResult.outputPath,
    runtimeCapturesFile: runtimeResult.capturesFile,
    figmaCapturesFile: figmaResult.capturesFile,
    reportPath: reportResult.reportPath,
    report: reportResult.report,
  };
}

export async function handleFlowReviewReport(
  params: z.infer<typeof FlowReviewReportParamsSchema>,
): Promise<{ path?: string; reportPath?: string; report?: FlowReviewReport; error?: string }> {
  const input = FlowReviewReportParamsSchema.parse(params);
  const planResult = await handleFlowReviewPlan(input);
  if (!planResult.reviewPlan) return { path: planResult.path, error: planResult.error ?? 'Review plan not available.' };

  const autoComparisons = input.autoCompare
    ? await buildFlowVisualComparisons({
        runtimeCaptures: input.runtimeCaptures as FlowReviewArtifactInput[] | undefined,
        figmaCaptures: input.figmaCaptures as FlowReviewArtifactInput[] | undefined,
        pixelThreshold: input.pixelThreshold,
      })
    : [];
  const report = buildFlowReviewReport({
    reviewPlan: planResult.reviewPlan,
    runtimeCaptures: input.runtimeCaptures as FlowReviewArtifactInput[] | undefined,
    figmaCaptures: input.figmaCaptures as FlowReviewArtifactInput[] | undefined,
    comparisons: [
      ...autoComparisons,
      ...((input.comparisons as FlowReviewComparisonInput[] | undefined) ?? []),
    ],
  });
  const cwd = input.cwd ?? process.cwd();
  const reportPath = input.outputPath ?? join(cwd, '.fliwright', 'reviews', `${sanitizeFlowFileId(report.flowId)}-report.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return {
    path: planResult.path,
    reportPath,
    report,
  };
}

export async function handleFlowGenerateTest(
  params: z.infer<typeof FlowGenerateTestParamsSchema>,
): Promise<{ path?: string; code?: string; outputFile?: string; error?: string }> {
  const input = FlowGenerateTestParamsSchema.parse(params);
  const result = await handleFlowGet(input);
  if (!result.flow) return { path: result.path, error: result.error ?? 'Flow not found.' };
  const code = generateFlowTestSkeleton(result.flow, {
    testName: input.testName,
    resetToHomeBeforeEach: input.resetToHomeBeforeEach,
    homeRoute: input.homeRoute,
    useFlowSteps: input.useFlowSteps,
  });
  if (input.outputFile) {
    await mkdir(dirname(input.outputFile), { recursive: true });
    await writeFile(input.outputFile, `${code}\n`, 'utf8');
  }
  return {
    path: result.path,
    code,
    ...(input.outputFile ? { outputFile: input.outputFile } : {}),
  };
}

export async function handleFlowValidate(
  params: z.infer<typeof FlowValidateParamsSchema>,
): Promise<{ path?: string; validation?: FlowValidationResult; error?: string }> {
  const input = FlowValidateParamsSchema.parse(params);
  const result = await handleFlowGet(input);
  if (!result.flow) return { path: result.path, error: result.error ?? 'Flow not found.' };
  return {
    path: result.path,
    validation: validateFlow(result.flow, {
      requireFigmaForFigmaNodes: input.requireFigmaForFigmaNodes,
      requireCodeTargetForFigmaNodes: input.requireCodeTargetForFigmaNodes,
      requireReviewRuntimeEntryForFigmaNodes: input.requireReviewRuntimeEntryForFigmaNodes,
    }),
  };
}

export function registerFlowTools(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_flow_list',
    'List editable Fliwright business flow JSON files under .fliwright/flows.',
    FlowListParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowList(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_get',
    'Read an editable Fliwright business flow JSON file by id or path.',
    FlowGetParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowGet(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_bind_figma',
    'Bind a flow node to a Figma file/node using a Figma URL or explicit fileKey and figmaNodeId.',
    FlowBindFigmaParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowBindFigma(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_agent_spec',
    'Build an AI-agent-ready development context spec from a Fliwright business flow.',
    FlowAgentSpecParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowAgentSpec(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_clean',
    'Use Claude/Codex or another configured AI provider to remove noisy recording nodes from a Fliwright business flow.',
    FlowCleanParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowClean(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_review_plan',
    'Build a UI review plan from a Fliwright business flow, including Figma targets and runtime entry hints.',
    FlowReviewPlanParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowReviewPlan(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_review_capture_runtime',
    'Capture runtime screenshots for UI review targets from a Fliwright business flow. Figma screenshots should be captured separately via Figma MCP.',
    FlowReviewCaptureRuntimeParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowReviewCaptureRuntime(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_review_bundle',
    'Build a UI review bundle that lists Figma MCP screenshot tasks, Fliwright runtime capture args, and final report args for a Figma-bound business flow.',
    FlowReviewBundleParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowReviewBundle(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_review_capture_figma',
    'Capture Figma screenshots for UI review targets through the deterministic Figma REST API and save figma-captures.json.',
    FlowReviewCaptureFigmaParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowReviewCaptureFigma(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_review_run',
    'Run the full deterministic UI review pipeline: build bundle, capture runtime screenshots, capture Figma screenshots via REST API, and save the review report.',
    FlowReviewRunParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowReviewRun(params, state), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_review_report',
    'Build and save a UI review report by pairing runtime screenshots, Figma screenshots, and optional diff metrics.',
    FlowReviewReportParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowReviewReport(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_generate_test',
    'Generate a Fliwright/Vitest test skeleton from a business flow.',
    FlowGenerateTestParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowGenerateTest(params), null, 2) }],
    }),
  );

  server.tool(
    'fliwright_flow_validate',
    'Validate a Fliwright business flow for graph integrity and optional Figma/code/review completeness.',
    FlowValidateParamsSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleFlowValidate(params), null, 2) }],
    }),
  );
}

function resolveFlowPath(params: { cwd?: string; id?: string; path?: string }): string | undefined {
  const cwd = params.cwd ?? process.cwd();
  return params.path ?? (params.id ? flowFilePath(cwd, params.id) : undefined);
}

function resolveFigmaBinding(
  params: z.infer<typeof FlowBindFigmaParamsSchema>,
  existing: FliwrightFigmaBinding | undefined,
): FliwrightFigmaBinding {
  const fromUrl = params.figmaUrl ? figmaBindingFromUrl(params.figmaUrl, existing) : null;
  return {
    ...(existing ?? {}),
    ...(fromUrl ?? {}),
    fileKey: params.fileKey ?? fromUrl?.fileKey ?? existing?.fileKey ?? '',
    nodeId: normalizeFigmaNodeId(params.figmaNodeId) ?? fromUrl?.nodeId ?? existing?.nodeId ?? '',
    ...(params.figmaUrl ? { url: params.figmaUrl } : {}),
    ...(params.name ? { name: params.name } : {}),
    ...(params.codeConnectId ? { codeConnectId: params.codeConnectId } : {}),
    ...(params.componentName ? { componentName: params.componentName } : {}),
  };
}

function normalizeFigmaNodeId(nodeId: string | undefined): string | undefined {
  return nodeId?.replace(/-/g, ':');
}
