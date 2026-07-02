import { buildFlowReviewPlan, type FlowReviewPlanOptions } from './FlowReviewPlan.js';
import { sanitizeFlowFileId } from './FlowFile.js';
import type { FliwrightFlowDocument } from './types.js';
import type { FlowReviewPlan } from './FlowReviewPlan.js';

export interface FlowReviewBundleOptions extends FlowReviewPlanOptions {
  flowPath?: string;
  outputDir?: string;
  generatedAt?: string;
}

export interface FlowReviewFigmaCaptureTask {
  flowNodeId: string;
  title: string;
  fileKey: string;
  nodeId: string;
  url?: string;
  screenshotPath: string;
  metadataPath: string;
  mcpTool: 'figma.get_screenshot';
}

export interface FlowReviewBundle {
  version: 1;
  flowId: string;
  title?: string;
  generatedAt: string;
  reviewPlan: FlowReviewPlan;
  artifacts: {
    rootDir: string;
    runtimeDir: string;
    figmaDir: string;
    reportPath: string;
  };
  figmaMcp: {
    tasks: FlowReviewFigmaCaptureTask[];
    capturesFile: string;
  };
  fliwrightMcp: {
    runtimeCapture: {
      tool: 'fliwright_flow_review_capture_runtime';
      args: {
        path?: string;
        outputDir: string;
        targetIds: string[];
      };
    };
    report: {
      tool: 'fliwright_flow_review_report';
      args: {
        path?: string;
        outputPath: string;
        autoCompare: true;
        runtimeCaptures: string;
        figmaCaptures: string;
      };
    };
  };
}

export function buildFlowReviewBundle(
  flow: FliwrightFlowDocument,
  options: FlowReviewBundleOptions = {},
): FlowReviewBundle {
  const reviewPlan = buildFlowReviewPlan(flow, options);
  const rootDir = trimTrailingSlash(options.outputDir ?? `.fliwright/reviews/${sanitizeFlowFileId(flow.id)}`);
  const runtimeDir = `${rootDir}/runtime`;
  const figmaDir = `${rootDir}/figma`;
  const reportPath = `${rootDir}/${sanitizeFlowFileId(flow.id)}-report.json`;
  const targetIds = reviewPlan.targets.map((target) => target.flowNodeId);
  const flowPath = options.flowPath;

  return {
    version: 1,
    flowId: flow.id,
    ...(flow.title ? { title: flow.title } : {}),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    reviewPlan,
    artifacts: {
      rootDir,
      runtimeDir,
      figmaDir,
      reportPath,
    },
    figmaMcp: {
      capturesFile: `${figmaDir}/figma-captures.json`,
      tasks: reviewPlan.targets.map((target, index) => ({
        flowNodeId: target.flowNodeId,
        title: target.title,
        fileKey: target.figma.fileKey,
        nodeId: target.figma.nodeId,
        ...(target.figma.url ? { url: target.figma.url } : {}),
        screenshotPath: `${figmaDir}/${String(index + 1).padStart(3, '0')}-${sanitizeFlowFileId(target.flowNodeId)}.png`,
        metadataPath: `${figmaDir}/${String(index + 1).padStart(3, '0')}-${sanitizeFlowFileId(target.flowNodeId)}.metadata.json`,
        mcpTool: 'figma.get_screenshot',
      })),
    },
    fliwrightMcp: {
      runtimeCapture: {
        tool: 'fliwright_flow_review_capture_runtime',
        args: {
          ...(flowPath ? { path: flowPath } : {}),
          outputDir: runtimeDir,
          targetIds,
        },
      },
      report: {
        tool: 'fliwright_flow_review_report',
        args: {
          ...(flowPath ? { path: flowPath } : {}),
          outputPath: reportPath,
          autoCompare: true,
          runtimeCaptures: `${runtimeDir}/runtime-captures.json`,
          figmaCaptures: `${figmaDir}/figma-captures.json`,
        },
      },
    },
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}
