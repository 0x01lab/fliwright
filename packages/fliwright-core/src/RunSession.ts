import { AsyncLocalStorage } from 'node:async_hooks';
import { TimelineRecorder } from './timeline/TimelineRecorder.js';
import type { RecordingMode } from './RecordingConfig.js';
import type { EndpointLeaseManager } from './EndpointLease.js';

export type OperationKind = 'action' | 'assertion' | 'step' | 'raw';
export type OperationOutcome = 'running' | 'passed' | 'failed' | 'skipped' | 'interrupted';

export interface OperationDescriptor {
  kind: OperationKind;
  title: string;
  metadata?: Record<string, unknown>;
  /** Values used only for in-memory report redaction; never persisted. */
  sensitiveValues?: readonly string[];
}

export interface EvidenceRequest {
  kind: 'screenshot' | 'snapshot' | 'diagnostics';
  reason: 'start' | 'finish' | 'failure' | 'explicit';
  operationId?: string;
}

export interface EvidenceResult {
  status: 'captured' | 'unavailable' | 'timeout' | 'disabled';
  artifactPaths?: string[];
  error?: unknown;
}

export interface RunSessionOperation {
  operationId: string;
  parentId?: string;
  kind: OperationKind;
  title: string;
  outcome: OperationOutcome;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export interface RunSessionResult {
  runId: string;
  testId: string;
  testName: string;
  /** Project-relative source file, independent of the runner's opaque task ID. */
  testFile?: string;
  /** Suite names followed by the test title, excluding the source file. */
  testPath?: string[];
  /** Stable attempt identity assigned by the runner adapter. */
  attemptId?: string;
  /** Zero-based retry/repeat index for this attempt. */
  attemptIndex?: number;
  status: 'running' | 'passed' | 'failed' | 'skipped' | 'interrupted';
  attemptOutcome: RunSessionResult['status'];
  testOutcome: RunSessionResult['status'];
  expectedFailure: boolean;
  flaky: boolean;
  /** Relative to this attempt's artifact directory. */
  failureContextPath?: string;
  /** Append-only progress journal, relative to this attempt's directory. */
  eventsPath?: string;
  /** Written only after the runner has resolved retries and expected-failure semantics. */
  finalized?: boolean;
  evidenceIssues?: string[];
  runnerErrors?: Array<{ message: string; stack?: string; phase: string }>;
  evidenceStatus: 'complete' | 'partial' | 'disabled';
  operations: RunSessionOperation[];
  evidence: Array<EvidenceRequest & { result: EvidenceResult }>;
}

export interface RunSessionOptions {
  runId: string;
  testId: string;
  testName: string;
  testFile?: string;
  testPath?: string[];
  attemptId?: string;
  attemptIndex?: number;
  recorder?: TimelineRecorder;
  recordingMode?: RecordingMode;
  captureActionEvidence?: (request: EvidenceRequest) => Promise<EvidenceResult>;
  captureEvidence?: (request: EvidenceRequest) => Promise<EvidenceResult>;
}

export interface RunnerOutcome {
  status: RunSessionResult['status'];
  evidenceStatus: RunSessionResult['evidenceStatus'];
}

const operationContext = new AsyncLocalStorage<string | undefined>();

/** Operation currently executing in this async call chain, for projections such as Trace. */
export function getCurrentOperationId(): string | undefined {
  return operationContext.getStore();
}

export class RunSession {
  private recorder: TimelineRecorder;
  private ownsRecorder: boolean;
  private recordingMode: RecordingMode;
  private captureActionEvidence?: (request: EvidenceRequest) => Promise<EvidenceResult>;
  private readonly operations: RunSessionOperation[] = [];
  private readonly evidence: Array<EvidenceRequest & { result: EvidenceResult }> = [];
  private readonly sensitiveValues = new Set<string>();
  private endpointLease?: { manager: Pick<EndpointLeaseManager, 'run'>; endpoint: string };
  private counter = 0;
  private finished = false;
  private persistProgress?: (result: RunSessionResult) => Promise<void>;
  private readonly persistenceIssues = new Set<string>();

  constructor(private readonly options: RunSessionOptions) {
    this.recorder = options.recorder ?? new TimelineRecorder({
        runId: options.runId,
        testName: options.testName,
        mode: 'test',
      });
    this.ownsRecorder = options.recorder === undefined;
    this.recordingMode = options.recordingMode ?? 'standard';
    this.captureActionEvidence = options.captureActionEvidence;
  }

  /** Automatic evidence policy; explicit user checkpoints remain available when disabled. */
  get recordingEnabled(): boolean { return this.recordingMode !== 'off'; }

  /** Bind the session to the fixture's shared timeline recorder. */
  bindRecorder(recorder: TimelineRecorder): void {
    if (this.operations.length > 0) {
      throw new Error('RunSession recorder cannot be rebound after an operation has started.');
    }
    this.recorder = recorder;
    this.ownsRecorder = false;
  }

  configureRecording(options: {
    mode: RecordingMode;
    captureEvidence?: (request: EvidenceRequest) => Promise<EvidenceResult>;
  }): void {
    if (this.operations.length > 0) {
      throw new Error('RunSession recording cannot be configured after an operation has started.');
    }
    this.recordingMode = options.mode;
    this.captureActionEvidence = options.captureEvidence;
  }

  /** Serialize the complete logical action, including its evidence capture, per app endpoint. */
  configureEndpointLease(manager: Pick<EndpointLeaseManager, 'run'>, endpoint: string): void {
    if (this.operations.length > 0) throw new Error('RunSession endpoint lease cannot be configured after an operation has started.');
    this.endpointLease = { manager, endpoint };
  }

  /** Persist completed facts before returning an action/evidence result to its caller. */
  configureProgressPersistence(persist: (result: RunSessionResult) => Promise<void>): void {
    if (this.operations.length > 0) throw new Error('RunSession persistence cannot be configured after an operation has started.');
    this.persistProgress = persist;
  }

  async perform<T>(operation: OperationDescriptor, execute: () => Promise<T>): Promise<T> {
    if (this.finished) throw new Error('RunSession is already finished.');
    for (const value of operation.sensitiveValues ?? []) if (value) this.sensitiveValues.add(value);
    const operationId = `${operation.kind}-${++this.counter}`;
    const parentId = operationContext.getStore();
    const record: RunSessionOperation = {
      operationId,
      ...(parentId ? { parentId } : {}),
      kind: operation.kind,
      title: operation.title,
      outcome: 'running',
      startedAt: new Date().toISOString(),
      ...(operation.metadata ? { metadata: { ...operation.metadata } } : {}),
    };
    this.operations.push(record);
    const run = async (): Promise<T> => {
      const node = this.recorder.startNode(operation.kind === 'assertion' ? 'assertion' : 'action', operation.title, {
        parentId,
        metadata: { operationId, kind: operation.kind, ...operation.metadata },
      });
      await this.flushProgress();
      try {
        if (operation.kind === 'action' && this.recordingMode === 'full') {
          await this.captureOperationEvidence({ kind: 'screenshot', reason: 'start', operationId }, node.id);
          await this.captureOperationEvidence({ kind: 'snapshot', reason: 'start', operationId }, node.id);
        }
        const value = await operationContext.run(operationId, execute);
        if (operation.kind === 'action' && this.recordingMode !== 'off') {
          await this.captureOperationEvidence({ kind: 'screenshot', reason: 'finish', operationId }, node.id);
        }
        record.outcome = 'passed';
        record.endedAt = new Date().toISOString();
        record.durationMs = elapsedMs(record.startedAt);
        this.recorder.passNode(node.id);
        await this.flushProgress();
        return value;
      } catch (error) {
        if (operation.kind === 'action' && this.recordingMode !== 'off') {
          await this.captureOperationEvidence({ kind: 'screenshot', reason: 'failure', operationId }, node.id);
          await this.captureOperationEvidence({ kind: 'snapshot', reason: 'failure', operationId }, node.id);
        }
        record.outcome = 'failed';
        record.endedAt = new Date().toISOString();
        record.durationMs = elapsedMs(record.startedAt);
        const reportError = this.redactReport(error);
        record.error = reportError;
        this.recorder.failNode(node.id, {
          code: operation.kind === 'assertion' ? 'assertion_failed' : 'step_failed',
          title: operation.title,
          message: reportError instanceof Error ? reportError.message : String(reportError),
          recoveryHints: [{ kind: 'observe', description: 'Inspect the recorded operation evidence.' }],
          cause: reportError,
        });
        await this.flushProgress();
        throw error;
      }
    };
    return this.endpointLease
      ? this.endpointLease.manager.run(this.endpointLease.endpoint, run)
      : run();
  }

  /** Redact presentation data without changing exceptions received by the caller. */
  redactReport<T>(value: T): T {
    if (this.sensitiveValues.size === 0) return value;
    const seen = new WeakMap<object, unknown>();
    const visit = (item: unknown): unknown => {
      if (typeof item === 'string') {
        for (const secret of this.sensitiveValues) item = (item as string).split(secret).join('<masked>');
        return item;
      }
      if (!item || typeof item !== 'object') return item;
      if (seen.has(item)) return seen.get(item);
      if (Buffer.isBuffer(item)) return item;
      const clone = Array.isArray(item) ? [] : Object.create(Object.getPrototypeOf(item)) as object;
      seen.set(item, clone);
      for (const name of Object.getOwnPropertyNames(item)) {
        if (Array.isArray(item) && name === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
        if ('value' in descriptor) Object.defineProperty(clone, name, { ...descriptor, value: visit(descriptor.value) });
      }
      return clone;
    };
    return visit(value) as T;
  }

  async checkpoint(request: EvidenceRequest): Promise<EvidenceResult> {
    if (!this.recordingEnabled && request.reason !== 'explicit') return { status: 'disabled' };
    const capture = async (): Promise<EvidenceResult> => {
      const operationId = request.operationId ?? operationContext.getStore();
      const normalized = { ...request, ...(operationId ? { operationId } : {}) };
      let result: EvidenceResult;
      try {
        result = await (
          this.captureActionEvidence?.(normalized)
          ?? this.options.captureEvidence?.(normalized)
          ?? Promise.resolve({ status: 'disabled' as const })
        );
      } catch (error) {
        result = { status: 'unavailable', error };
      }
      this.evidence.push({ ...normalized, result });
      await this.flushProgress();
      return result;
    };
    return this.endpointLease
      ? this.endpointLease.manager.run(this.endpointLease.endpoint, capture)
      : capture();
  }

  private async captureOperationEvidence(request: EvidenceRequest, nodeId: string): Promise<void> {
    const result = await this.checkpoint(requestWithOperation(request, request.operationId));
    if (result.artifactPaths?.length) {
      const kind: 'screenshot' | 'snapshot' | 'diagnostics' = request.kind === 'screenshot'
        ? 'screenshot'
        : request.kind === 'snapshot' ? 'snapshot' : 'diagnostics';
      this.recorder.addArtifacts(nodeId, result.artifactPaths.map((path) => ({
        kind,
        path,
        ...(kind === 'screenshot' ? { mimeType: 'image/png' } : { mimeType: 'application/json' }),
      })));
    }
  }

  private async flushProgress(): Promise<void> {
    await this.recorder.flushProgress();
    try {
      await this.persistProgress?.(this.snapshot());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.persistenceIssues.add(this.redactReport(`Progress persistence failed: ${message}`));
    }
  }

  async finish(outcome: RunnerOutcome): Promise<RunSessionResult> {
    if (this.finished) throw new Error('RunSession is already finished.');
    this.finished = true;
    if (this.ownsRecorder) {
      this.recorder.complete(outcome.status);
    }
    return this.snapshot(outcome);
  }

  /** A serializable copy of facts flushed so far; it does not finalize the session. */
  snapshot(outcome: RunnerOutcome = { status: 'running', evidenceStatus: 'complete' }): RunSessionResult {
    const evidenceStatus = this.recordingMode === 'off'
      ? 'disabled' as const
      : this.persistenceIssues.size > 0 || this.evidence.some(({ result }) => (
      result.status === 'unavailable' || result.status === 'timeout'
    ))
      ? 'partial' as const
      : outcome.evidenceStatus;
    return {
      runId: this.options.runId,
      testId: this.options.testId,
      testName: this.options.testName,
      ...(this.options.testFile ? { testFile: this.options.testFile } : {}),
      ...(this.options.testPath ? { testPath: [...this.options.testPath] } : {}),
      ...(this.options.attemptId ? { attemptId: this.options.attemptId } : {}),
      ...(this.options.attemptIndex === undefined ? {} : { attemptIndex: this.options.attemptIndex }),
      status: outcome.status,
      attemptOutcome: outcome.status,
      testOutcome: outcome.status,
      expectedFailure: false,
      flaky: false,
      evidenceStatus,
      ...(this.persistenceIssues.size ? { evidenceIssues: [...this.persistenceIssues] } : {}),
      operations: (this.recordingEnabled ? this.operations : []).map((operation) => ({ ...operation,
        ...(operation.error === undefined ? {} : { error: serializeError(operation.error) }),
      })),
      evidence: this.evidence.map((item) => ({ ...item, result: { ...item.result,
        ...(item.result.error === undefined ? {} : { error: serializeError(item.result.error) }),
      } })),
    };
  }
}

function elapsedMs(startedAt: string): number {
  return Math.max(0, Date.now() - Date.parse(startedAt));
}

function requestWithOperation(request: EvidenceRequest, operationId: string | undefined): EvidenceRequest {
  return operationId ? { ...request, operationId } : request;
}

function serializeError(error: unknown): unknown {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
}
