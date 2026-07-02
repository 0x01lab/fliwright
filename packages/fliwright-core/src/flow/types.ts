import type { TimelineData } from '../timeline/types.js';
import type { RecordedOperation, RecordingFrame } from '../types.js';

export type FliwrightFlowSourceKind = 'recording' | 'timeline' | 'script' | 'manual';

export type FliwrightFlowNodeType =
  | 'screen'
  | 'action'
  | 'decision'
  | 'figma'
  | 'note'
  | 'mock'
  | 'assertion'
  | 'agent';

export interface FliwrightFlowPosition {
  x: number;
  y: number;
}

export interface FliwrightFlowSource {
  kind: FliwrightFlowSourceKind;
  recordingId?: string;
  runId?: string;
  testName?: string;
  targetFile?: string;
}

export interface FliwrightFigmaBinding {
  fileKey: string;
  nodeId: string;
  name?: string;
  url?: string;
  codeConnectId?: string;
  componentName?: string;
  variant?: Record<string, string>;
}

export interface FliwrightFlowScreenshotRef {
  source: 'recording-frame' | 'figma' | 'runtime';
  recordingFrameId?: string;
  path?: string;
  format?: 'png' | string;
  width?: number;
  height?: number;
  pixelRatio?: number;
}

export interface FliwrightFlowDecisionRule {
  id: string;
  label?: string;
  when: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export interface FliwrightFlowNode {
  id: string;
  type: FliwrightFlowNodeType;
  title: string;
  description?: string;
  position?: FliwrightFlowPosition;
  route?: string;
  selector?: string;
  recordingFrameId?: string;
  operationIndex?: number;
  operation?: Pick<RecordedOperation, 'kind' | 'position' | 'delta' | 'text' | 'action' | 'duration' | 'timestamp' | 'status' | 'ignoreReason' | 'confidence'>;
  screenshot?: FliwrightFlowScreenshotRef;
  figma?: FliwrightFigmaBinding;
  decisionRules?: FliwrightFlowDecisionRule[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface FliwrightFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
  metadata?: Record<string, unknown>;
}

export interface FliwrightFlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FliwrightFlowDocument {
  version: 1;
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  source?: FliwrightFlowSource;
  nodes: FliwrightFlowNode[];
  edges: FliwrightFlowEdge[];
  viewport?: FliwrightFlowViewport;
  metadata?: Record<string, unknown>;
}

export interface RecordingToFlowInput {
  frames: RecordingFrame[];
  operations?: RecordedOperation[];
  recordingId?: string;
  testName?: string;
  targetFile?: string;
}

export interface RecordingToFlowOptions {
  flowId?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  includeIgnored?: boolean;
  nodeXGap?: number;
  nodeY?: number;
}

export interface TimelineToFlowInput {
  timeline: TimelineData;
  targetFile?: string;
}

export interface TimelineToFlowOptions {
  flowId?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  includeFailures?: boolean;
  nodeXGap?: number;
  nodeY?: number;
}
