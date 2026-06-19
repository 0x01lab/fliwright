export type TimelineRunMode = 'script' | 'test';

export type TimelineNodeKind =
  | 'script'
  | 'page'
  | 'frame'
  | 'step'
  | 'branch'
  | 'optional'
  | 'assertion'
  | 'action'
  | 'mock'
  | 'ai-call'
  | 'failure';

export type TimelineNodeStatus = 'running' | 'passed' | 'failed' | 'skipped';

export type TimelineRunStatus = 'running' | 'passed' | 'failed';

export interface CodeRef {
  file: string;
  line: number;
  column?: number;
}

export interface TimelineArtifactRef {
  kind: 'screenshot' | 'snapshot' | 'diagnostics' | 'log' | 'ai-artifact' | string;
  path: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentVisibleFailure {
  code:
    | 'selector_not_found'
    | 'actionability_failed'
    | 'assertion_failed'
    | 'navigation_failed'
    | 'step_failed'
    | 'ai_call_failed'
    | 'unknown';
  title: string;
  message: string;
  timelineNodeId?: string;
  scriptLocation?: {
    file: string;
    line: number;
    column?: number;
    stepTitle?: string;
  };
  appState?: {
    route?: string;
    screenshotPath?: string;
    snapshotPath?: string;
    diagnosticsPath?: string;
  };
  actionContext?: {
    action?: string;
    target?: unknown;
    valueMasked?: boolean;
  };
  recoveryHints: Array<{
    kind: 'observe' | 'retry' | 'close-overlay' | 'change-selector' | 'wait' | 'manual';
    description: string;
  }>;
  cause?: unknown;
}

export interface TimelineNode {
  id: string;
  parentId?: string;
  kind: TimelineNodeKind;
  title: string;
  status: TimelineNodeStatus;
  startedAt: string;
  endedAt?: string;
  route?: string;
  codeRef?: CodeRef;
  artifacts?: TimelineArtifactRef[];
  metadata?: Record<string, unknown>;
  error?: AgentVisibleFailure;
}

export interface TimelineData {
  version: 1;
  runId: string;
  testName: string;
  mode: TimelineRunMode;
  status: TimelineRunStatus;
  startedAt: string;
  endedAt?: string;
  nodes: TimelineNode[];
  agentVisibleFailures?: AgentVisibleFailure[];
}

export interface AgentPolicy {
  passive?: boolean;
  onFailure?: 'diagnose' | 'none';
  requireAssertions?: boolean;
  autoRetry?: boolean;
  autoRepair?: false | 'runtime-only';
  allowCodePatch?: boolean;
  maxRetriesPerStep?: number;
}

export interface TimelineRecorderOptions {
  runId: string;
  testName: string;
  mode?: TimelineRunMode;
  startedAt?: string;
}

export interface TimelineNodeStartOptions {
  route?: string;
  codeRef?: CodeRef;
  artifacts?: TimelineArtifactRef[];
  metadata?: Record<string, unknown>;
  parentId?: string;
}
