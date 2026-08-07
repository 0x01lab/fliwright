import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  AiRuntime,
  DevAssistTraceStore,
  PassiveAgent,
  TimelineRecorder,
  buildChangeSetSnapshot,
  type AgentDiagnosis,
  type AgentVisibleFailure,
  type ChangeSetSnapshot,
  type DevAssistTrace,
  type JsonSchema,
} from '@fliwright/core';
import { generateRedFirstTest } from '../generator/RedFirstTestGenerator.js';
import { validateInteractionSpec, type InteractionSpec } from '../spec/InteractionSpec.js';
import type { CycleOpts, TddCycleResult } from '../types.js';
import type { ChangeSetFileStatus } from '@fliwright/core';

const execFileAsync = promisify(execFile);

export type DevAssistAction = 'start' | 'continue' | 'regenerate';
export type DevAssistStatus = 'green' | 'red' | 'needs_review' | 'needs_regeneration' | 'blocked';

export interface DevAssistCycleInput {
  request?: string;
  devAssistSessionId?: string;
  action?: DevAssistAction;
  files?: string[];
  baseRevision?: string;
  vmServiceUrl?: string;
  deviceId?: string;
  projectId?: string;
  target?: string;
}

export interface DevAssistCycleResult {
  status: DevAssistStatus;
  devAssistSessionId?: string;
  devAssistTracePath?: string;
  timelinePath?: string;
  timelineNodeId?: string;
  candidateTestPath?: string;
  changeSet?: ChangeSetSnapshot;
  sync?: { decision: 'none' | 'reload' | 'restart'; escalation?: boolean };
  diagnosis?: AgentDiagnosis;
  nextCall?: DevAssistCycleInput;
  reason?: string;
}

export interface DevAssistInferenceResult {
  testName: string;
  provider?: string;
  model?: string;
  spec: InteractionSpec;
}

export interface DevAssistRuntime {
  focus(file: string, testName?: string): Promise<unknown>;
  cycle(testName?: string, opts?: CycleOpts): Promise<TddCycleResult>;
}

export interface DevAssistCoordinatorDeps {
  cwd?: string;
  runtime?: DevAssistRuntime;
  aiRuntime?: AiRuntime;
  traceStore?: DevAssistTraceStore;
  changeSetProvider?: (input: DevAssistCycleInput) => Promise<ChangeSetSnapshot>;
  infer?: (input: {
    request?: string;
    changeSet: ChangeSetSnapshot;
  }) => Promise<DevAssistInferenceResult>;
  diagnose?: (result: TddCycleResult) => Promise<AgentDiagnosis | undefined>;
  createSessionId?: () => string;
  now?: () => Date;
}

export class DevAssistCoordinator {
  private readonly cwd: string;
  private readonly traceStore: DevAssistTraceStore;
  private readonly now: () => Date;

  constructor(private readonly deps: DevAssistCoordinatorDeps = {}) {
    this.cwd = resolve(deps.cwd ?? process.cwd());
    this.traceStore = deps.traceStore ?? new DevAssistTraceStore({ root: join(this.cwd, '.fliwright', 'devassist') });
    this.now = deps.now ?? (() => new Date());
  }

  async cycle(input: DevAssistCycleInput = {}): Promise<DevAssistCycleResult> {
    const action = input.action ?? (input.devAssistSessionId ? 'continue' : 'start');
    if (action === 'start') return await this.start(input);
    if (!input.devAssistSessionId) {
      return { status: 'blocked', reason: `DevAssist action '${action}' requires devAssistSessionId.` };
    }
    return await this.resume(input, action);
  }

  private async start(input: DevAssistCycleInput): Promise<DevAssistCycleResult> {
    if (!this.deps.runtime) {
      return { status: 'blocked', reason: 'Start the persistent TDD runtime before running a DevAssist cycle.' };
    }
    const changeSet = await this.captureChangeSet(input);
    const sessionId = this.deps.createSessionId?.() ?? randomUUID();
    return await this.generateAndRun({ input, changeSet, sessionId });
  }

  private async resume(input: DevAssistCycleInput, action: Exclude<DevAssistAction, 'start'>): Promise<DevAssistCycleResult> {
    if (!this.deps.runtime) {
      return { status: 'blocked', reason: 'Start the persistent TDD runtime before running a DevAssist cycle.' };
    }
    let trace: DevAssistTrace;
    try {
      trace = await this.traceStore.read(input.devAssistSessionId!);
    } catch {
      return { status: 'blocked', reason: `DevAssist session '${input.devAssistSessionId}' was not found.` };
    }
    const changeSet = await this.captureChangeSet(input);
    if (action === 'regenerate') {
      if (trace.cycles.at(-1)?.status !== 'needs_regeneration') {
        return {
          status: 'needs_review',
          devAssistSessionId: trace.devAssistSessionId,
          candidateTestPath: trace.candidate.path,
          changeSet,
          reason: 'Regeneration is available only after the candidate becomes invalid.',
        };
      }
      return await this.generateAndRun({
        input: { ...input, request: input.request ?? trace.request },
        changeSet,
        sessionId: trace.devAssistSessionId,
        previousTrace: trace,
      });
    }

    const candidatePath = trace.candidate.path;
    const candidateSource = await readFile(candidatePath, 'utf8').catch(() => undefined);
    if (!candidateSource || hash(candidateSource) !== trace.candidate.hash) {
      return await this.persistNeedsRegeneration(trace, changeSet, 'The generated candidate changed or is missing. Regenerate explicitly to replace its test intent.');
    }
    return await this.runCandidate(trace, changeSet);
  }

  private async generateAndRun(options: {
    input: DevAssistCycleInput;
    changeSet: ChangeSetSnapshot;
    sessionId: string;
    previousTrace?: DevAssistTrace;
  }): Promise<DevAssistCycleResult> {
    const inference = await this.infer({ request: options.input.request, changeSet: options.changeSet });
    const validation = validateInteractionSpec(inference.spec);
    const candidatePath = join(this.cwd, '.fliwright', 'generated', `${options.sessionId}.test.ts`);
    const now = this.now().toISOString();
    if (!validation.ok) {
      const trace = this.newTrace(options, inference, {
        path: candidatePath,
        hash: '',
        testName: inference.testName,
        validation: { eligible: false, reason: validation.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ') },
      }, now);
      const devAssistTracePath = await this.traceStore.write(trace);
      return {
        status: 'needs_review',
        devAssistSessionId: options.sessionId,
        devAssistTracePath,
        changeSet: options.changeSet,
        reason: trace.candidate.validation.reason,
      };
    }

    if (!hasSupportedAssertion(validation.spec)) {
      const trace = this.newTrace(options, inference, {
        path: candidatePath,
        hash: '',
        testName: inference.testName,
        validation: { eligible: false, reason: 'The inferred candidate has no supported assertion.' },
      }, now);
      const devAssistTracePath = await this.traceStore.write(trace);
      return {
        status: 'needs_review',
        devAssistSessionId: options.sessionId,
        devAssistTracePath,
        changeSet: options.changeSet,
        reason: trace.candidate.validation.reason,
      };
    }

    const rendered = generateRedFirstTest(validation.spec, { testName: inference.testName });
    if (rendered.warnings.length > 0) {
      const trace = this.newTrace(options, inference, {
        path: candidatePath,
        hash: '',
        testName: inference.testName,
        validation: { eligible: false, reason: rendered.warnings.join(' ') },
      }, now);
      const devAssistTracePath = await this.traceStore.write(trace);
      return {
        status: 'needs_review',
        devAssistSessionId: options.sessionId,
        devAssistTracePath,
        changeSet: options.changeSet,
        reason: trace.candidate.validation.reason,
      };
    }

    await mkdir(join(candidatePath, '..'), { recursive: true });
    await writeFile(candidatePath, rendered.testCode, 'utf8');
    const trace = this.newTrace(options, inference, {
      path: candidatePath,
      hash: hash(rendered.testCode),
      testName: rendered.testName,
      validation: { eligible: true },
    }, now);
    return await this.runCandidate(trace, options.changeSet);
  }

  private newTrace(
    options: { input: DevAssistCycleInput; changeSet: ChangeSetSnapshot; sessionId: string; previousTrace?: DevAssistTrace },
    inference: DevAssistInferenceResult,
    candidate: DevAssistTrace['candidate'],
    now: string,
  ): DevAssistTrace {
    return {
      version: 1,
      devAssistSessionId: options.sessionId,
      ...(options.input.request ? { request: options.input.request } : options.previousTrace?.request ? { request: options.previousTrace.request } : {}),
      changeSets: [...(options.previousTrace?.changeSets ?? []), options.changeSet],
      inference: {
        promptTemplateVersion: 'devassist-v1',
        provider: inference.provider ?? 'configured-ai',
        ...(inference.model ? { model: inference.model } : {}),
        evidence: {
          changeFiles: options.changeSet.files.map((file) => file.path),
          validation: candidate.validation,
        },
      },
      candidate,
      cycles: [...(options.previousTrace?.cycles ?? [])],
      createdAt: options.previousTrace?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private async runCandidate(trace: DevAssistTrace, changeSet: ChangeSetSnapshot): Promise<DevAssistCycleResult> {
    const runtime = this.deps.runtime!;
    await runtime.focus(trace.candidate.path, trace.candidate.testName);
    const cycle = await runtime.cycle(trace.candidate.testName, {
      sync: 'auto',
      changes: changeSet.files.map((file) => file.path),
      autoEscalate: true,
    });
    const diagnosis = cycle.status === 'red' ? await this.diagnose(cycle) : undefined;
    const timelinePath = cycle.timelinePath ?? cycle.failureContext?.artifacts?.timelinePath;
    const timelineNodeId = cycle.timelineNodeId ?? cycle.failureContext?.artifacts?.timelineNodeId;
    const candidateInvalid = cycle.failureContext?.kind === 'test-error';
    const status: DevAssistStatus = candidateInvalid ? 'needs_regeneration' : cycle.status;
    const artifacts = artifactReferences(cycle);
    const nextTrace: DevAssistTrace = {
      ...trace,
      changeSets: trace.changeSets.at(-1)?.hash === changeSet.hash ? trace.changeSets : [...trace.changeSets, changeSet],
      cycles: [...trace.cycles, {
        changeSet,
        status,
        sync: { decision: cycle.lastSync, ...(cycle.syncEscalated ? { escalation: true } : {}) },
        ...(timelinePath ? { timelinePath } : {}),
        ...(timelineNodeId ? { timelineNodeId } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(diagnosis ? { diagnosis: diagnosisReference(diagnosis) } : {}),
        ...(cycle.failure?.message ? { reason: cycle.failure.message } : {}),
        completedAt: this.now().toISOString(),
      }],
      updatedAt: this.now().toISOString(),
    };
    const devAssistTracePath = await this.traceStore.write(nextTrace);
    return {
      status,
      devAssistSessionId: trace.devAssistSessionId,
      devAssistTracePath,
      candidateTestPath: trace.candidate.path,
      changeSet,
      sync: { decision: cycle.lastSync, ...(cycle.syncEscalated ? { escalation: true } : {}) },
      ...(timelinePath ? { timelinePath } : {}),
      ...(timelineNodeId ? { timelineNodeId } : {}),
      ...(diagnosis ? { diagnosis } : {}),
      nextCall: candidateInvalid
        ? { action: 'regenerate', devAssistSessionId: trace.devAssistSessionId }
        : { action: 'continue', devAssistSessionId: trace.devAssistSessionId },
    };
  }

  private async persistNeedsRegeneration(
    trace: DevAssistTrace,
    changeSet: ChangeSetSnapshot,
    reason: string,
  ): Promise<DevAssistCycleResult> {
    const updated: DevAssistTrace = {
      ...trace,
      changeSets: [...trace.changeSets, changeSet],
      cycles: [...trace.cycles, {
        changeSet,
        status: 'needs_regeneration',
        sync: { decision: 'none' },
        reason,
        completedAt: this.now().toISOString(),
      }],
      updatedAt: this.now().toISOString(),
    };
    const devAssistTracePath = await this.traceStore.write(updated);
    return {
      status: 'needs_regeneration',
      devAssistSessionId: trace.devAssistSessionId,
      devAssistTracePath,
      candidateTestPath: trace.candidate.path,
      changeSet,
      sync: { decision: 'none' },
      reason,
      nextCall: { action: 'regenerate', devAssistSessionId: trace.devAssistSessionId },
    };
  }

  private async infer(input: { request?: string; changeSet: ChangeSetSnapshot }): Promise<DevAssistInferenceResult> {
    if (this.deps.infer) return await this.deps.infer(input);
    const aiRuntime = this.deps.aiRuntime ?? new AiRuntime();
    const result = await aiRuntime.generate<DevAssistInferenceResult>({
      prompt: [
        'Produce one Fliwright DevAssist candidate as JSON.',
        'Use only supported InteractionSpec actions and assertions. The candidate must contain an observable assertion and must not authorize side effects.',
        `Developer request: ${input.request ?? 'Infer one focused behavior from the changed files.'}`,
        `Change set: ${JSON.stringify({ baseRevision: input.changeSet.baseRevision, files: input.changeSet.files.map((file) => file.path) })}`,
      ].join('\n'),
      schema: inferenceSchema,
    });
    return result;
  }

  private async diagnose(cycle: TddCycleResult): Promise<AgentDiagnosis | undefined> {
    if (this.deps.diagnose) return await this.deps.diagnose(cycle);
    const failure = toAgentVisibleFailure(cycle);
    if (!failure) return undefined;
    try {
      const passiveAgent = new PassiveAgent({
        aiRuntime: this.deps.aiRuntime ?? new AiRuntime(),
        recorder: new TimelineRecorder({ runId: `devassist-${Date.now()}`, testName: cycle.testName ?? 'DevAssist candidate' }),
        passive: true,
      });
      return (await passiveAgent.diagnose(failure, {
        allowedTools: ['fliwright_timeline_get', 'fliwright_snap', 'fliwright_observe'],
        screenshotPath: cycle.failureContext?.artifacts?.screenshotPath,
        snapshotPath: cycle.failureContext?.artifacts?.timelinePath,
      })) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async captureChangeSet(input: DevAssistCycleInput): Promise<ChangeSetSnapshot> {
    if (this.deps.changeSetProvider) return await this.deps.changeSetProvider(input);
    const files = input.files
      ? input.files.map((path) => ({ path, status: 'modified' as const }))
      : await changedFiles(this.cwd);
    const snapshots = await Promise.all(files.map(async (file) => {
      const content = await readFile(resolve(this.cwd, file.path), 'utf8').catch(() => undefined);
      return {
        path: file.path,
        status: content === undefined ? 'deleted' as const : file.status,
        content,
      };
    }));
    return buildChangeSetSnapshot({
      baseRevision: input.baseRevision ?? await currentRevision(this.cwd),
      files: snapshots,
    });
  }
}

const inferenceSchema: JsonSchema = {
  type: 'object',
  properties: {
    testName: { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    spec: { type: 'object' },
  },
  required: ['testName', 'spec'],
};

async function changedFiles(cwd: string): Promise<Array<{ path: string; status: ChangeSetFileStatus }>> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], { cwd });
    const records = stdout.split('\0').filter(Boolean);
    const files: Array<{ path: string; status: ChangeSetFileStatus }> = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.length <= 3) continue;
      const marker = record.slice(0, 2);
      files.push({ path: record.slice(3), status: statusFromPorcelain(marker) });
      if (marker.includes('R') || marker.includes('C')) index += 1;
    }
    return files
      .filter((file, index, candidates) => candidates.findIndex((candidate) => candidate.path === file.path) === index)
      .sort((left, right) => left.path.localeCompare(right.path));
  } catch {
    return [];
  }
}

async function currentRevision(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function statusFromPorcelain(marker: string): ChangeSetFileStatus {
  if (marker === '??') return 'untracked';
  if (marker.includes('D')) return 'deleted';
  if (marker.includes('A') || marker.includes('C')) return 'added';
  return 'modified';
}

function hasSupportedAssertion(spec: InteractionSpec): boolean {
  return Boolean(spec.assertions?.length) || spec.flows.some((flow) => Boolean(flow.expectedOutcome?.length));
}

function diagnosisReference(diagnosis: AgentDiagnosis): NonNullable<DevAssistTrace['cycles'][number]['diagnosis']> {
  return {
    summary: diagnosis.summary,
    rootCause: diagnosis.rootCause,
    suggestedActions: [...diagnosis.suggestedActions],
    confidence: diagnosis.confidence,
  };
}

function artifactReferences(cycle: TddCycleResult): Array<{ kind: string; path: string }> {
  const artifacts = cycle.failureContext?.artifacts;
  return [
    cycle.timelinePath ?? artifacts?.timelinePath ? { kind: 'trace', path: cycle.timelinePath ?? artifacts!.timelinePath! } : undefined,
    artifacts?.failureContextPath ? { kind: 'diagnostics', path: artifacts.failureContextPath } : undefined,
    artifacts?.screenshotPath ? { kind: 'screenshot', path: artifacts.screenshotPath } : undefined,
  ].filter((artifact): artifact is { kind: string; path: string } => Boolean(artifact));
}

function toAgentVisibleFailure(cycle: TddCycleResult): AgentVisibleFailure | undefined {
  const context = cycle.failureContext;
  if (!context) return undefined;
  const codeByKind: Record<typeof context.kind, AgentVisibleFailure['code']> = {
    'missing-element': 'selector_not_found',
    'ambiguous-element': 'actionability_failed',
    'wrong-text': 'assertion_failed',
    'navigation-failed': 'navigation_failed',
    'mock-not-called': 'assertion_failed',
    'state-mismatch': 'assertion_failed',
    timeout: 'step_failed',
    disconnected: 'step_failed',
    'test-error': 'step_failed',
  };
  return {
    code: codeByKind[context.kind],
    title: context.testName ?? cycle.testName ?? 'DevAssist candidate failed',
    message: context.message,
    timelineNodeId: context.artifacts?.timelineNodeId,
    recoveryHints: (context.recoveryHints ?? []).map((hint) => ({
      kind: 'manual' as const,
      description: hint.message,
    })),
  };
}
