import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  sanitizeFlowFileId,
  validateFlow,
} from '@fliwright/core';
import type {
  AiProviderName,
  FlowCleanPlan,
  FlowAgentSpec,
  FlowReviewArtifactInput,
  FlowReviewComparisonInput,
  FlowReviewPlan,
  FlowReviewBundle,
  FlowReviewReport,
  FlowValidationResult,
  FliwrightFigmaBinding,
  FliwrightFlowDocument,
  FigmaScreenshotProvider,
} from '@fliwright/core';

export interface FlowCommandOptions {
  cwd?: string;
  id?: string;
  path?: string;
  json?: boolean;
}

export interface FlowListItem {
  id: string;
  title?: string;
  updatedAt: string;
  source?: FliwrightFlowDocument['source'];
  path: string;
  nodeCount: number;
  edgeCount: number;
}

export interface FlowBindFigmaOptions extends FlowCommandOptions {
  flowNodeId: string;
  figmaUrl?: string;
  fileKey?: string;
  figmaNodeId?: string;
  name?: string;
  codeConnectId?: string;
  componentName?: string;
}

export interface FlowValidateOptions extends FlowCommandOptions {
  requireCodeTargetForFigmaNodes?: boolean;
  requireReviewRuntimeEntryForFigmaNodes?: boolean;
}

export interface FlowCleanOptions extends FlowCommandOptions {
  outputPath?: string;
  dryRun?: boolean;
  aiProvider?: AiProviderName;
  aiTimeoutMs?: number;
  protectedNodeIds?: string[];
  instructions?: string;
  aiRuntime?: Pick<AiRuntime, 'generate'>;
}

export interface FlowGenerateTestOptions extends FlowCommandOptions {
  outputFile?: string;
  testName?: string;
  resetToHomeBeforeEach?: boolean;
  homeRoute?: string;
  useFlowSteps?: boolean;
}

export interface FlowReviewPlanOptions extends FlowCommandOptions {
  pixelDiffTolerance?: number;
  layoutPxTolerance?: number;
}

export interface FlowReviewBundleOptions extends FlowReviewPlanOptions {
  outputDir?: string;
  outputPath?: string;
}

export interface FlowReviewCaptureFigmaOptions extends FlowReviewPlanOptions {
  outputDir?: string;
  capturesFile?: string;
  accessToken?: string;
  scale?: number;
  figmaProvider?: FigmaScreenshotProvider;
}

export interface FlowReviewReportOptions extends FlowReviewPlanOptions {
  runtimeCaptures?: FlowReviewArtifactInput[];
  figmaCaptures?: FlowReviewArtifactInput[];
  comparisons?: FlowReviewComparisonInput[];
  outputPath?: string;
  autoCompare?: boolean;
  pixelThreshold?: number;
}

export async function flowListCommand(options: FlowCommandOptions = {}): Promise<{ flows: FlowListItem[] }> {
  const cwd = options.cwd ?? process.cwd();
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
      const flow = await readFlowAtPath(path);
      flows.push({
        id: flow.id,
        ...(flow.title ? { title: flow.title } : {}),
        updatedAt: flow.updatedAt,
        ...(flow.source ? { source: flow.source } : {}),
        path,
        nodeCount: flow.nodes.length,
        edgeCount: flow.edges.length,
      });
    } catch {
      // Ignore malformed draft files so a single bad flow does not hide the rest.
    }
  }

  flows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { flows };
}

export async function flowGetCommand(options: FlowCommandOptions): Promise<{ path: string; flow: FliwrightFlowDocument }> {
  const path = resolveFlowPath(options);
  return {
    path,
    flow: await readFlowAtPath(path),
  };
}

export async function flowBindFigmaCommand(options: FlowBindFigmaOptions): Promise<{ path: string; flow: FliwrightFlowDocument; node: FliwrightFlowDocument['nodes'][number] }> {
  const path = resolveFlowPath(options);
  const flow = await readFlowAtPath(path);
  const nodeIndex = flow.nodes.findIndex((node) => node.id === options.flowNodeId);
  if (nodeIndex === -1) {
    throw new Error(`Flow node not found: ${options.flowNodeId}`);
  }

  const currentNode = flow.nodes[nodeIndex];
  const binding = resolveFigmaBinding(options, currentNode.figma);
  if (!binding.fileKey) {
    throw new Error('Pass --figma-url or --file-key.');
  }

  const node = {
    ...currentNode,
    figma: binding,
  };
  const nextFlow: FliwrightFlowDocument = {
    ...flow,
    updatedAt: new Date().toISOString(),
    nodes: flow.nodes.map((candidate, index) => index === nodeIndex ? node : candidate),
  };

  await writeFlowAtPath(path, nextFlow);
  return { path, flow: nextFlow, node };
}

export async function flowAgentSpecCommand(options: FlowCommandOptions): Promise<{ path: string; spec: FlowAgentSpec }> {
  const { path, flow } = await flowGetCommand(options);
  return {
    path,
    spec: buildFlowAgentSpec(flow),
  };
}

export async function flowCleanCommand(options: FlowCleanOptions): Promise<{ path: string; outputPath: string; flow: FliwrightFlowDocument; plan: FlowCleanPlan; dryRun: boolean }> {
  const { path, flow } = await flowGetCommand(options);
  const aiRuntime = options.aiRuntime ?? new AiRuntime(resolveAiConfig({
    provider: options.aiProvider,
    timeoutMs: options.aiTimeoutMs,
  }));
  const result = await cleanFlowWithAi(flow, {
    ai: aiRuntime,
    timeoutMs: options.aiTimeoutMs,
    protectedNodeIds: options.protectedNodeIds,
    instructions: options.instructions,
  });
  const outputPath = options.outputPath ?? path;
  if (!options.dryRun) {
    await writeFlowAtPath(outputPath, result.flow);
  }
  return {
    path,
    outputPath,
    flow: result.flow,
    plan: result.plan,
    dryRun: Boolean(options.dryRun),
  };
}

export async function flowReviewPlanCommand(options: FlowReviewPlanOptions): Promise<{ path: string; reviewPlan: FlowReviewPlan }> {
  const { path, flow } = await flowGetCommand(options);
  return {
    path,
    reviewPlan: buildFlowReviewPlan(flow, {
      pixelDiffTolerance: options.pixelDiffTolerance,
      layoutPxTolerance: options.layoutPxTolerance,
    }),
  };
}

export async function flowReviewBundleCommand(options: FlowReviewBundleOptions): Promise<{ path: string; outputPath: string; bundle: FlowReviewBundle }> {
  const { path, flow } = await flowGetCommand(options);
  const cwd = options.cwd ?? process.cwd();
  const outputDir = options.outputDir ?? join(cwd, '.fliwright', 'reviews', sanitizeFlowFileId(flow.id));
  const bundle = buildFlowReviewBundle(flow, {
    flowPath: path,
    outputDir,
    pixelDiffTolerance: options.pixelDiffTolerance,
    layoutPxTolerance: options.layoutPxTolerance,
  });
  const outputPath = options.outputPath ?? join(outputDir, `${sanitizeFlowFileId(flow.id)}-review-bundle.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return { path, outputPath, bundle };
}

export async function flowReviewCaptureFigmaCommand(options: FlowReviewCaptureFigmaOptions): Promise<{ path: string; outputDir: string; capturesFile: string; captures: FlowReviewArtifactInput[] }> {
  const { path, flow } = await flowGetCommand(options);
  const cwd = options.cwd ?? process.cwd();
  const outputDir = options.outputDir ?? join(cwd, '.fliwright', 'reviews', sanitizeFlowFileId(flow.id), 'figma');
  const bundle = buildFlowReviewBundle(flow, {
    flowPath: path,
    outputDir: dirname(outputDir),
    pixelDiffTolerance: options.pixelDiffTolerance,
    layoutPxTolerance: options.layoutPxTolerance,
  });
  const provider = options.figmaProvider ?? new FigmaRestScreenshotProvider({
    accessToken: options.accessToken,
    scale: options.scale,
  });
  const captures = await captureFigmaReviewScreenshots(bundle.figmaMcp.tasks.map((task) => ({
    ...task,
    screenshotPath: join(outputDir, `${task.screenshotPath.split('/').pop()}`),
    metadataPath: join(outputDir, `${task.metadataPath.split('/').pop()}`),
  })), provider);
  const capturesFile = options.capturesFile ?? join(outputDir, 'figma-captures.json');
  await mkdir(dirname(capturesFile), { recursive: true });
  await writeFile(capturesFile, `${JSON.stringify(captures, null, 2)}\n`, 'utf8');
  return { path, outputDir, capturesFile, captures };
}

export async function flowReviewReportCommand(options: FlowReviewReportOptions): Promise<{ path: string; reportPath: string; report: FlowReviewReport }> {
  const { path, reviewPlan } = await flowReviewPlanCommand(options);
  const autoComparisons = (options.autoCompare ?? true)
    ? await buildFlowVisualComparisons({
        runtimeCaptures: options.runtimeCaptures,
        figmaCaptures: options.figmaCaptures,
        pixelThreshold: options.pixelThreshold,
      })
    : [];
  const report = buildFlowReviewReport({
    reviewPlan,
    runtimeCaptures: options.runtimeCaptures,
    figmaCaptures: options.figmaCaptures,
    comparisons: [
      ...autoComparisons,
      ...(options.comparisons ?? []),
    ],
  });
  const cwd = options.cwd ?? process.cwd();
  const reportPath = options.outputPath ?? join(cwd, '.fliwright', 'reviews', `${sanitizeFlowFileId(report.flowId)}-report.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { path, reportPath, report };
}

export async function flowGenerateTestCommand(options: FlowGenerateTestOptions): Promise<{ path: string; code: string; outputFile?: string }> {
  const { path, flow } = await flowGetCommand(options);
  const code = generateFlowTestSkeleton(flow, {
    testName: options.testName,
    resetToHomeBeforeEach: options.resetToHomeBeforeEach,
    homeRoute: options.homeRoute,
    useFlowSteps: options.useFlowSteps,
  });

  if (options.outputFile) {
    await mkdir(dirname(options.outputFile), { recursive: true });
    await writeFile(options.outputFile, `${code}\n`, 'utf8');
  }

  return {
    path,
    code,
    ...(options.outputFile ? { outputFile: options.outputFile } : {}),
  };
}

export async function flowValidateCommand(options: FlowValidateOptions): Promise<{ path: string; validation: FlowValidationResult }> {
  const { path, flow } = await flowGetCommand(options);
  return {
    path,
    validation: validateFlow(flow, {
      requireCodeTargetForFigmaNodes: options.requireCodeTargetForFigmaNodes,
      requireReviewRuntimeEntryForFigmaNodes: options.requireReviewRuntimeEntryForFigmaNodes,
    }),
  };
}

function resolveFlowPath(options: FlowCommandOptions): string {
  const cwd = options.cwd ?? process.cwd();
  const path = options.path ?? (options.id ? flowFilePath(cwd, options.id) : undefined);
  if (!path) {
    throw new Error('Pass a flow id or --path <file>.');
  }
  return path;
}

async function readFlowAtPath(path: string): Promise<FliwrightFlowDocument> {
  return JSON.parse(await readFile(path, 'utf8')) as FliwrightFlowDocument;
}

async function writeFlowAtPath(path: string, flow: FliwrightFlowDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
}

function resolveFigmaBinding(
  options: FlowBindFigmaOptions,
  existing: FliwrightFigmaBinding | undefined,
): FliwrightFigmaBinding {
  const fromUrl = options.figmaUrl ? figmaBindingFromUrl(options.figmaUrl, existing) : null;
  return {
    ...(existing ?? {}),
    ...(fromUrl ?? {}),
    fileKey: options.fileKey ?? fromUrl?.fileKey ?? existing?.fileKey ?? '',
    nodeId: normalizeFigmaNodeId(options.figmaNodeId) ?? fromUrl?.nodeId ?? existing?.nodeId ?? '',
    ...(options.figmaUrl ? { url: options.figmaUrl } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(options.codeConnectId ? { codeConnectId: options.codeConnectId } : {}),
    ...(options.componentName ? { componentName: options.componentName } : {}),
  };
}

function normalizeFigmaNodeId(nodeId: string | undefined): string | undefined {
  return nodeId?.replace(/-/g, ':');
}

export function flowIdFromPath(path: string): string {
  return sanitizeFlowFileId(path.replace(/\.flow\.json$/u, ''));
}
