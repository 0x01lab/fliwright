import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TimelineArtifactRef } from '../timeline/types.js';

export type ChangeSetFileStatus = 'added' | 'modified' | 'deleted' | 'untracked';

export interface ChangeSetInputFile {
  path: string;
  status: ChangeSetFileStatus;
  content?: string;
}

export interface ChangeSetFile {
  path: string;
  status: ChangeSetFileStatus;
  hash: string;
}

export interface ChangeSetSnapshot {
  baseRevision?: string;
  files: ChangeSetFile[];
  hash: string;
}

export interface InferenceEvidence {
  changeFiles: string[];
  existingTests?: string[];
  applicationSemantics?: string[];
  validation?: {
    eligible: boolean;
    reason?: string;
  };
}

export interface DevAssistInference {
  promptTemplateVersion: string;
  provider: string;
  model?: string;
  evidence: InferenceEvidence;
}

export interface GeneratedTestCandidateMetadata {
  path: string;
  hash: string;
  testName: string;
  validation: {
    eligible: boolean;
    reason?: string;
  };
}

export interface DevAssistCycleTrace {
  changeSet: ChangeSetSnapshot;
  status: 'green' | 'red' | 'needs_review' | 'needs_regeneration' | 'blocked';
  sync: {
    decision: 'none' | 'reload' | 'restart';
    escalation?: boolean;
  };
  timelinePath?: string;
  timelineNodeId?: string;
  artifacts?: TimelineArtifactRef[];
  diagnosis?: {
    summary: string;
    rootCause: string;
    suggestedActions: string[];
    confidence: number;
  };
  reason?: string;
  completedAt: string;
}

export interface DevAssistTrace {
  version: 1;
  devAssistSessionId: string;
  request?: string;
  changeSets: ChangeSetSnapshot[];
  inference: DevAssistInference;
  candidate: GeneratedTestCandidateMetadata;
  cycles: DevAssistCycleTrace[];
  createdAt: string;
  updatedAt: string;
}

export interface DevAssistTraceStoreOptions {
  root: string;
}

export class DevAssistTraceStore {
  constructor(private readonly options: DevAssistTraceStoreOptions) {}

  pathFor(sessionId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      throw new Error('DevAssist session ids may contain only letters, numbers, underscores, and hyphens.');
    }
    return join(this.options.root, `${sessionId}.json`);
  }

  async write(trace: DevAssistTrace): Promise<string> {
    const path = this.pathFor(trace.devAssistSessionId);
    await mkdir(this.options.root, { recursive: true });
    await writeFile(path, stableJsonStringify(redactDevAssistTrace(trace)), 'utf8');
    return path;
  }

  async read(sessionId: string): Promise<DevAssistTrace> {
    return JSON.parse(await readFile(this.pathFor(sessionId), 'utf8')) as DevAssistTrace;
  }
}

export function buildChangeSetSnapshot(input: {
  baseRevision?: string;
  files: ChangeSetInputFile[];
}): ChangeSetSnapshot {
  const files = input.files
    .map((file) => ({
      path: file.path,
      status: file.status,
      hash: sha256(file.content ?? ''),
    }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.status.localeCompare(right.status));
  return {
    ...(input.baseRevision ? { baseRevision: input.baseRevision } : {}),
    files,
    hash: sha256(stableJsonStringify({ baseRevision: input.baseRevision, files })),
  };
}

export function redactDevAssistTrace(trace: DevAssistTrace): DevAssistTrace {
  return redactValue(trace) as DevAssistTrace;
}

export function stableJsonStringify(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactValue(child)]));
  }
  return value;
}

function redactText(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
