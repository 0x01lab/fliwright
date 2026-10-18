import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sanitizeFlowFileId } from '@fliwright/core';
import { withAppSession, type AppSessionOptions, type AppSessionDeps } from '../capabilities/session.js';
import { flowReviewPlanCommand, flowReviewBundleCommand, flowReviewCaptureFigmaCommand, flowReviewReportCommand, type FlowReviewPlanOptions } from './flow.js';
export interface FlowRuntimeOptions extends FlowReviewPlanOptions, AppSessionOptions {
  outputDir?: string; targetIds?: string[]; limit?: number; pixelRatio?: number;
  accessToken?: string; scale?: number; autoCompare?: boolean; pixelThreshold?: number;
}
export async function flowReviewCaptureRuntimeCommand(options: FlowRuntimeOptions, deps: AppSessionDeps = {}) {
  const { path, reviewPlan } = await flowReviewPlanCommand(options);
  const outputDir = resolve(options.cwd ?? process.cwd(), options.outputDir ?? `.fliwright/reviews/${sanitizeFlowFileId(reviewPlan.flowId)}-${Date.now()}/runtime`);
  await mkdir(outputDir, { recursive: true });
  return withAppSession(options, async ({ driver }) => {
    const targets = reviewPlan.targets.filter((target) => !options.targetIds || options.targetIds.includes(target.flowNodeId)).slice(0, options.limit);
    const captures = [];
    for (const [index, target] of targets.entries()) {
      options.signal?.throwIfAborted();
      try {
        if (target.route) await driver.page.goto(target.route);
        const screenshotPath = join(outputDir, `${String(index + 1).padStart(3, '0')}-${sanitizeFlowFileId(target.flowNodeId)}.png`);
        await writeFile(screenshotPath, await driver.page.screenshot({ pixelRatio: options.pixelRatio }));
        captures.push({ flowNodeId: target.flowNodeId, title: target.title, route: target.route, screenshotPath, status: 'passed' as const });
      } catch (error) { captures.push({ flowNodeId: target.flowNodeId, title: target.title, route: target.route, status: 'failed' as const, error: error instanceof Error ? error.message : String(error) }); }
    }
    const capturesFile = join(outputDir, 'runtime-captures.json');
    await writeFile(capturesFile, JSON.stringify(captures, null, 2));
    return { path, outputDir, capturesFile, captures };
  }, deps);
}
export async function flowReviewRunCommand(options: FlowRuntimeOptions, deps: AppSessionDeps = {}) {
  const bundle = await flowReviewBundleCommand(options);
  const runtime = await flowReviewCaptureRuntimeCommand({ ...options, outputDir: bundle.bundle.artifacts.runtimeDir }, deps);
  const figma = await flowReviewCaptureFigmaCommand({ ...options, outputDir: bundle.bundle.artifacts.figmaDir, capturesFile: bundle.bundle.figmaMcp.capturesFile });
  const report = await flowReviewReportCommand({ ...options, outputPath: bundle.bundle.artifacts.reportPath, runtimeCaptures: runtime.captures, figmaCaptures: figma.captures });
  return { ...report, bundlePath: bundle.outputPath, runtimeCapturesFile: runtime.capturesFile, figmaCapturesFile: figma.capturesFile };
}
