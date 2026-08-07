import { TIMELINE_ARTIFACT_KIND_SCREENSHOT } from './constants.js';
import type { AgentVisibleFailure, TimelineData, TimelineNode } from './types.js';

export interface TimelineSummary {
  mode: TimelineData['mode'];
  nodeCount: number;
  pages: number;
  stepsPassed: number;
  stepsFailed: number;
  screenshots: number;
  firstFailure?: AgentVisibleFailure;
}

export function parseTimelineData(source: string): TimelineData | undefined {
  try {
    const parsed = JSON.parse(source) as unknown;
    return isTimelineData(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function summarizeTimeline(timeline: TimelineData): TimelineSummary {
  const nodes = timeline.nodes;
  return {
    mode: timeline.mode,
    nodeCount: nodes.length,
    pages: nodes.filter((node) => node.kind === 'page').length,
    stepsPassed: nodes.filter((node) => node.kind === 'step' && node.status === 'passed').length,
    stepsFailed: nodes.filter((node) => node.kind === 'step' && node.status === 'failed').length,
    screenshots: nodes.reduce((count, node) => count + screenshotCount(node), 0),
    firstFailure: timeline.agentVisibleFailures?.[0],
  };
}

function isTimelineData(value: unknown): value is TimelineData {
  return isRecord(value) && Array.isArray(value.nodes);
}

function screenshotCount(node: TimelineNode): number {
  return node.artifacts?.filter((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SCREENSHOT).length ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
