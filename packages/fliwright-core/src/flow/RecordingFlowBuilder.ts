import type { RecordedOperation, RecordingFrame } from '../types.js';
import type {
  FliwrightFlowDocument,
  FliwrightFlowEdge,
  FliwrightFlowNode,
  RecordingToFlowInput,
  RecordingToFlowOptions,
} from './types.js';

const DEFAULT_NODE_X_GAP = 328;
const DEFAULT_NODE_Y = 112;

export function buildFlowFromRecording(
  input: RecordingToFlowInput,
  options: RecordingToFlowOptions = {},
): FliwrightFlowDocument {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const updatedAt = options.updatedAt ?? createdAt;
  const flowId = options.flowId ?? createFlowId(input);
  const frames = normalizeFrames(input.frames, options);
  const nodes = frames.map((frame, index) => frameToNode(frame, input.operations, {
    x: index * (options.nodeXGap ?? DEFAULT_NODE_X_GAP),
    y: options.nodeY ?? DEFAULT_NODE_Y,
  }));

  return {
    version: 1,
    id: flowId,
    ...(options.title ?? input.testName ? { title: options.title ?? input.testName } : {}),
    createdAt,
    updatedAt,
    source: {
      kind: 'recording',
      ...(input.recordingId ? { recordingId: input.recordingId } : {}),
      ...(input.testName ? { testName: input.testName } : {}),
      ...(input.targetFile ? { targetFile: input.targetFile } : {}),
    },
    nodes,
    edges: buildLinearEdges(nodes),
    metadata: {
      operationCount: input.operations?.length ?? inferOperationCount(input.frames),
      frameCount: input.frames.length,
      includedFrameCount: frames.length,
    },
  };
}

function normalizeFrames(frames: RecordingFrame[], options: RecordingToFlowOptions): RecordingFrame[] {
  return frames
    .filter((frame) => frame.kind !== 'pending')
    .filter((frame) => options.includeIgnored || frame.operationStatus !== 'ignored')
    .slice()
    .sort((a, b) => a.index - b.index);
}

function frameToNode(
  frame: RecordingFrame,
  operations: RecordedOperation[] | undefined,
  position: { x: number; y: number },
): FliwrightFlowNode {
  const operation = operationForFrame(frame, operations);
  const kind = operation?.kind ?? recordedKindForFrame(frame);
  const operationStatus = operation?.status ?? frame.operationStatus;
  const ignoreReason = operation?.ignoreReason ?? frame.ignoreReason;
  const confidence = operation?.confidence ?? frame.confidence;
  const actionPosition = operation?.position ?? frame.position;
  const actionDelta = operation?.delta ?? frame.delta;
  const actionText = operation?.text ?? frame.text;
  const actionValue = operation?.action ?? frame.action;
  const actionDuration = operation?.duration ?? frame.duration;
  const actionTimestamp = operation?.timestamp ?? frame.timestamp;
  return {
    id: nodeIdForFrame(frame),
    type: 'action',
    title: titleForFrame(frame),
    position,
    selector: frame.selector,
    recordingFrameId: frame.id,
    ...(frame.operationIndex != null ? { operationIndex: frame.operationIndex } : {}),
    operation: {
      kind,
      position: { x: actionPosition.x, y: actionPosition.y },
      ...(actionDelta ? { delta: { x: actionDelta.x, y: actionDelta.y } } : {}),
      ...(actionText ? { text: actionText } : {}),
      ...(actionValue ? { action: actionValue } : {}),
      ...(actionDuration != null ? { duration: actionDuration } : {}),
      timestamp: actionTimestamp,
      ...(operationStatus ? { status: operationStatus } : {}),
      ...(ignoreReason ? { ignoreReason } : {}),
      ...(confidence != null ? { confidence } : {}),
    },
    ...(frame.screenshot ? {
      screenshot: {
        source: 'recording-frame',
        recordingFrameId: frame.id,
        format: frame.screenshot.format,
        width: frame.screenshot.width,
        height: frame.screenshot.height,
        pixelRatio: frame.screenshot.pixelRatio,
      },
    } : {}),
    metadata: {
      frameIndex: frame.index,
      frameStatus: frame.status,
      ...(frame.synthetic ? { synthetic: true } : {}),
      ...(frame.screenshotError ? { screenshotError: frame.screenshotError } : {}),
    },
  };
}

function recordedKindForFrame(frame: RecordingFrame): RecordedOperation['kind'] {
  if (frame.kind === 'pending') {
    throw new Error(`Cannot build a flow node from pending recording frame: ${frame.id}`);
  }
  return frame.kind;
}

function operationForFrame(
  frame: RecordingFrame,
  operations: RecordedOperation[] | undefined,
): RecordedOperation | undefined {
  if (frame.operationIndex == null) return undefined;
  return operations?.[frame.operationIndex];
}

function buildLinearEdges(nodes: FliwrightFlowNode[]): FliwrightFlowEdge[] {
  const edges: FliwrightFlowEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const source = nodes[i - 1];
    const target = nodes[i];
    edges.push({
      id: `edge-${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      label: `${i} -> ${i + 1}`,
    });
  }
  return edges;
}

function titleForFrame(frame: RecordingFrame): string {
  if (frame.selector) return `${frame.kind}: ${frame.selector}`;
  if (frame.kind === 'type') {
    const text = frame.text ? ` "${truncate(frame.text, 24)}"` : '';
    return `type${text}`;
  }
  if (frame.kind === 'drag' && frame.delta) {
    return `drag (${frame.delta.x}, ${frame.delta.y})`;
  }
  return frame.kind;
}

function nodeIdForFrame(frame: RecordingFrame): string {
  return `recording-${sanitizeId(frame.id)}`;
}

function createFlowId(input: RecordingToFlowInput): string {
  if (input.recordingId) return `flow-${sanitizeId(input.recordingId)}`;
  if (input.testName) return `flow-${sanitizeId(input.testName)}`;
  return 'flow-recording';
}

function sanitizeId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'item';
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function inferOperationCount(frames: RecordingFrame[]): number {
  const indexes = frames
    .map((frame) => frame.operationIndex)
    .filter((index): index is number => typeof index === 'number');
  return indexes.length ? Math.max(...indexes) + 1 : 0;
}
