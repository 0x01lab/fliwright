import { CodeGenerator } from './CodeGenerator.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordingEventEnvelopeSchema, recordingHandshakeSchema,
  recordingStartResponseSchema, recordingStopResponseSchema,
} from './RunContracts.js';
import type { RecordingEventEnvelope } from './RunContracts.js';
import { RecordingEventStore } from './RecordingEventStore.js';
import type { RecordingEventCacheStats } from './RecordingEventStore.js';
import { RecordingArtifactStore } from './RecordingArtifacts.js';
import type { RecordingBinaryCacheStats } from './RecordingArtifacts.js';
import { AssertionSuggester } from './AssertionSuggester.js';
import { RecordedSelectorResolver } from './RecordedSelectorResolver.js';
import { serializeSelectorQuery } from './SelectorSerializer.js';
import type {
  CodegenOptions,
  RawInputEvent,
  RecordedOperation,
  RecordingFrame,
  RecordingScreenshot,
  ResolvedSelector,
  SendRequest,
} from './types.js';

type RecorderStreamEvent = {
  kind: string;
  timestamp: number;
  data: Record<string, unknown>;
  streamId?: string;
};

type OnEvent = (callback: (event: RecorderStreamEvent) => void) => () => void;

export interface RecorderStartOptions {
  /** Owned recording artifacts; each session uses an independent subdirectory. */
  artifactDirectory?: string;
  eventCache?: {
    maxBufferedEvents?: number;
    maxBufferedBytes?: number;
    maxPendingEvents?: number;
    maxPendingBytes?: number;
  };
  onOperation?: (operation: RecordedOperation, index: number) => void;
  captureScreenshots?: boolean;
  onFrame?: (frame: RecordingFrame, index: number) => void;
  screenshotSampleIntervalMs?: number;
  filterNoise?: boolean;
  /** Maximum time to wait for the bridge's flushed lastSequence after stop. */
  stopFlushTimeoutMs?: number;
  /** Bound bridge requests and pending screenshot work during capture/cleanup. */
  requestTimeoutMs?: number;
  /** Bound simultaneous/queued screenshot work, including the periodic sampler. */
  maxPendingScreenshots?: number;
  /** Maximum decoded size of one screenshot (default 8 MiB). History stays on disk. */
  maxScreenshotBytes?: number;
}

export type RecordingCaptureStatus = 'recording' | 'stopping' | 'captured' | 'partial' | 'failed';

export interface RecordingResult {
  status: Exclude<RecordingCaptureStatus, 'recording' | 'stopping'>;
  sessionId?: string;
  lastSequence?: number;
  receivedSequences: number[];
  missingSequences: number[];
  operations: RecordedOperation[];
  frames: RecordingFrame[];
  code: string;
  issues: string[];
  rawEventsFile?: string;
  binaryCache?: RecordingBinaryCacheStats;
  eventCache?: RecordingEventCacheStats & {
    peakPendingEvents: number;
    peakPendingBytes: number;
    maxPendingEvents: number;
    maxPendingBytes: number;
  };
  screenshotQueue?: { pendingTasks: number; peakPendingTasks: number; maxPendingTasks: number };
}

export class RecorderController {
  private static readonly defaultScreenshotSampleIntervalMs = 250;

  private eventStore: RecordingEventStore | undefined;
  private artifactStore: RecordingArtifactStore | undefined;
  private operations: RecordedOperation[] = [];
  private frames: RecordingFrame[] = [];
  private screenshotTasks = new Set<Promise<void>>();
  private peakScreenshotTasks = 0;
  private screenshotQueue: Promise<void> = Promise.resolve();
  private screenshotSampler: ReturnType<typeof setInterval> | null = null;
  private latestScreenshot: RecordingScreenshot | null = null;
  private latestScreenshotError: string | null = null;
  private isSamplingScreenshot = false;
  private screenshotSamplingActive = false;
  private unsubscribe: (() => void) | null = null;
  private activeOptions: RecorderStartOptions | undefined;
  private lastSelectors = new Map<number, ResolvedSelector>();
  private lastCodegenOptions: CodegenOptions | undefined;
  private captureStatus: RecordingCaptureStatus = 'failed';
  private sessionId: string | undefined;
  private lastSequence = 0;
  private receivedSequences = new Set<number>();
  private missingSequences: number[] = [];
  private unsupportedGestures: string[] = [];
  private stopFlushIncomplete = false;
  private captureIssues: string[] = [];
  private stopTask: Promise<RecordingResult> | undefined;
  private generation = 0;
  private contiguousSequence = 0;
  private pendingEvents = new Map<number, RawInputEvent>();
  private pendingBytes = 0;
  private peakPendingEvents = 0;
  private peakPendingBytes = 0;
  private readonly resolver: RecordedSelectorResolver;

  constructor(
    private readonly sendRequest: SendRequest,
    private readonly onEvent: OnEvent,
  ) {
    this.resolver = new RecordedSelectorResolver();
  }

  async start(options?: RecorderStartOptions): Promise<void> {
    if (this.captureStatus === 'recording' || this.captureStatus === 'stopping') {
      throw new Error('A recording session is already active.');
    }
    for (const [name, value] of Object.entries(options?.eventCache ?? {})) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
        throw new Error(`recording.eventCache.${name} must be a positive safe integer.`);
      }
    }
    for (const name of ['maxPendingScreenshots', 'maxScreenshotBytes'] as const) {
      const value = options?.[name];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
        throw new Error(`recording.${name} must be a positive safe integer.`);
      }
    }
    this.generation++;
    this.captureIssues = [];
    this.stopTask = undefined;
    this.eventStore = undefined;
    this.artifactStore = undefined;
    this.operations = [];
    this.frames = [];
    this.screenshotTasks = new Set();
    this.peakScreenshotTasks = 0;
    this.screenshotQueue = Promise.resolve();
    this.latestScreenshot = null;
    this.latestScreenshotError = null;
    this.isSamplingScreenshot = false;
    this.screenshotSamplingActive = false;
    this.lastSelectors = new Map();
    this.lastCodegenOptions = undefined;
    this.activeOptions = options;
    this.captureStatus = 'recording';
    this.sessionId = randomUUID();
    this.contiguousSequence = 0;
    this.pendingEvents = new Map();
    this.pendingBytes = 0;
    this.peakPendingEvents = 0;
    this.peakPendingBytes = 0;
    this.lastSequence = 0;
    this.receivedSequences = new Set();
    this.missingSequences = [];
    this.unsupportedGestures = [];
    this.stopFlushIncomplete = false;

    let startSent = false;
    try {
      const handshake = await this.withRequestTimeout(
        this.sendRequest('ext.fliwright.handshake', { protocolVersion: '2' }), 'Recording handshake',
      );
      if (!recordingHandshakeSchema.safeParse(handshake).success) {
        throw new Error('Reliable recording requires protocol v2, FliwrightRecordingBinding before dispatch, and focused-input controller capabilities. Upgrade the bridge and initialize the recording binding before runApp.');
      }
      await this.withRequestTimeout(this.ensureExtensionStream(), 'Recording stream subscription');
      this.unsubscribe = this.onEvent((event) => this.receiveRecordingEvent(event));

      startSent = true;
      const startResponse = await this.withRequestTimeout(this.sendRequest('ext.fliwright.startRecording', {
        protocolVersion: '2', sessionId: this.sessionId,
      }), 'Recording start') as {
        success?: boolean;
        error?: string;
      };
      if (startResponse?.success === false || startResponse?.error) {
        throw new Error(startResponse.error ?? 'Recording could not be started reliably.');
      }
      const started = recordingStartResponseSchema.parse(startResponse);
      if (started.sessionId !== this.sessionId) throw new Error('Recording start returned a different session id.');
      await this.startScreenshotSampler(options);
    } catch (error) {
      this.captureStatus = 'failed';
      this.captureIssues.push(error instanceof Error ? error.message : String(error));
      if (startSent) {
        try {
          await this.withRequestTimeout(this.sendRequest('ext.fliwright.stopRecording', { sessionId: this.sessionId }), 'Recording start cleanup');
        } catch (cleanupError) {
          this.captureIssues.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
        }
      }
      this.releaseListeners();
      throw error;
    }
  }

  stop(options?: CodegenOptions): Promise<RecordingResult> {
    if (this.captureStatus === 'captured' || this.captureStatus === 'partial' || this.captureStatus === 'failed') {
      return Promise.resolve(this.buildRecordingResult(this.captureStatus));
    }
    if (this.stopTask) return this.stopTask;
    this.captureStatus = 'stopping';
    this.stopTask = this.finishCapture(options);
    return this.stopTask;
  }

  private async finishCapture(options?: CodegenOptions): Promise<RecordingResult> {
    this.stopScreenshotSampler();
    try {
      const stopResponse = await this.withRequestTimeout(this.sendRequest('ext.fliwright.stopRecording', { sessionId: this.sessionId }), 'Recording stop') as {
        sessionId?: string; lastSequence?: number; success?: boolean; error?: string;
      };
      if (stopResponse.success === false || stopResponse.error) {
        throw new Error(stopResponse.error ?? 'Recording stop failed.');
      }
      const stopped = recordingStopResponseSchema.parse(stopResponse);
      if (stopped.sessionId !== this.sessionId) throw new Error('Recording stop returned a different session id.');
      this.stopFlushIncomplete = !await this.waitForSequence(stopped.lastSequence, this.activeOptions?.stopFlushTimeoutMs ?? 1000);
      if (this.lastSequence > stopped.lastSequence) {
        this.captureIssues.push('Recording events exceed the bridge lastSequence.');
      }
      this.lastSequence = Math.max(this.lastSequence, stopped.lastSequence);
      this.missingSequences = [];
      for (let sequence = 1; sequence <= this.lastSequence; sequence++) {
        if (!this.receivedSequences.has(sequence)) this.missingSequences.push(sequence);
      }
      // Keep out-of-order data as a reviewable draft when a gap never arrives.
      for (const [, event] of [...this.pendingEvents].sort(([a], [b]) => a - b)) this.appendRawEvent(event);
      this.pendingEvents.clear();
      this.pendingBytes = 0;

      this.releaseListeners();

      await this.withRequestTimeout(Promise.allSettled([...this.screenshotTasks]), 'Recording screenshots');
      this.unsupportedGestures = this.eventStore?.unsupportedGestures ?? [];
      this.operations = this.aggregateOperations();
      const selectors = new Map<number, ResolvedSelector>();
      for (let i = 0; i < this.operations.length; i++) {
        const resolved = await this.withRequestTimeout(this.resolver.resolveUniqueSelector(this.operations[i]), 'Recording selector');
        if (!resolved) continue;
        selectors.set(i, resolved);
        const display = serializeSelectorQuery(resolved.query);
        this.setFrameSelector(i, display);
      }
      this.lastSelectors = selectors;
      this.lastCodegenOptions = {
        ...options,
        recordingFrames: this.getFrames(),
        assertionSuggestions: new AssertionSuggester().suggest(this.operations),
      };

      const status = this.captureIssues.length > 0 || (this.eventStore?.issues.length ?? 0) > 0 || this.missingSequences.length > 0 || this.latestScreenshotError != null || this.unsupportedGestures.length > 0 || this.stopFlushIncomplete
        ? 'partial'
        : 'captured';
      this.captureStatus = status;
    } catch (error) {
      this.captureStatus = 'failed';
      this.captureIssues.push(error instanceof Error ? error.message : String(error));
    } finally {
      this.releaseListeners();
      // Any late screenshot must not mutate this result or a subsequent session.
      this.generation++;
    }
    return this.buildRecordingResult(this.captureStatus as RecordingResult['status']);
  }

  private receiveRecordingEvent(event: RecorderStreamEvent): void {
    const payload = recordingPayload(event);
    if (payload === undefined) return;
    if (isObject(payload) && typeof payload.sessionId === 'string' && payload.sessionId !== this.sessionId) return;
    const parsed = recordingEventEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = 'Invalid recording protocol v2 event envelope.';
      if (!this.captureIssues.includes(issue)) this.captureIssues.push(issue);
      return;
    }
    const envelope = parsed.data;
    if (this.receivedSequences.has(envelope.sequence)) return;
    this.receivedSequences.add(envelope.sequence);
    this.lastSequence = Math.max(this.lastSequence, envelope.sequence);
    const raw = rawRecordingEvent(envelope);
    this.ensureEventStore().archive(raw);
    // A late event behind a budget-forced draft boundary remains in the archive.
    if (envelope.sequence <= this.contiguousSequence) return;
    const rawBytes = Buffer.byteLength(JSON.stringify(raw));
    const maxPendingEvents = this.activeOptions?.eventCache?.maxPendingEvents ?? 128;
    const maxPendingBytes = this.activeOptions?.eventCache?.maxPendingBytes ?? 1024 * 1024;
    if (this.pendingEvents.size + 1 > maxPendingEvents || this.pendingBytes + rawBytes > maxPendingBytes) {
      const issue = 'Recording out-of-order event buffer budget exhausted; aggregation continues as a partial draft. Raw events remain archived when writable.';
      if (!this.captureIssues.includes(issue)) this.captureIssues.push(issue);
      for (const [sequence, event] of [...this.pendingEvents].sort(([a], [b]) => a - b)) {
        this.appendRawEvent(event);
        this.contiguousSequence = Math.max(this.contiguousSequence, sequence);
      }
      this.pendingEvents.clear();
      this.pendingBytes = 0;
      if (envelope.sequence <= this.contiguousSequence) return;
    }
    if (rawBytes > maxPendingBytes) {
      this.appendRawEvent(raw);
      this.contiguousSequence = envelope.sequence;
      return;
    }
    this.pendingEvents.set(envelope.sequence, raw);
    this.pendingBytes += rawBytes;
    this.peakPendingEvents = Math.max(this.peakPendingEvents, this.pendingEvents.size);
    this.peakPendingBytes = Math.max(this.peakPendingBytes, this.pendingBytes);
    while (this.pendingEvents.has(this.contiguousSequence + 1)) {
      this.contiguousSequence++;
      const next = this.pendingEvents.get(this.contiguousSequence)!;
      this.pendingEvents.delete(this.contiguousSequence);
      this.pendingBytes -= Buffer.byteLength(JSON.stringify(next));
      this.appendRawEvent(next);
    }
  }

  private appendRawEvent(event: RawInputEvent): void {
    this.captureFrameForRawEvent(event);
    const previousCount = this.operations.length;
    this.ensureEventStore().consume(event);
    this.operations = this.aggregateOperations();
    this.syncFramesWithOperations();
    for (let index = previousCount; index < this.operations.length; index++) {
      this.activeOptions?.onOperation?.(this.operations[index], index);
    }
  }

  getStatus(): RecordingCaptureStatus { return this.captureStatus; }

  private buildRecordingResult(
    status: 'captured' | 'partial' | 'failed',
  ): RecordingResult {
    const code = this.lastCodegenOptions ? this.generateCode() : '';
    return {
      status,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.lastSequence ? { lastSequence: this.lastSequence } : {}),
      receivedSequences: [...this.receivedSequences].sort((a, b) => a - b),
      missingSequences: [...this.missingSequences],
      operations: this.getOperations(),
      frames: this.getFrames(),
      ...(this.eventStore?.hasArchive ? { rawEventsFile: 'events.jsonl' } : {}),
      ...(this.artifactStore ? { binaryCache: this.artifactStore.stats() } : {}),
      code,
      issues: [
        ...this.captureIssues,
        ...(this.eventStore?.issues ?? []),
        ...(this.missingSequences.length ? [`Recording sequence gap: ${this.missingSequences.join(', ')}`] : []),
        ...(this.latestScreenshotError ? [`Screenshot capture incomplete: ${this.latestScreenshotError}`] : []),
        ...this.unsupportedGestures.map((gesture) => `Unsupported gesture: ${gesture}`),
        ...(this.stopFlushIncomplete ? ['Recording stop flush did not receive the bridge lastSequence.'] : []),
      ],
      ...(this.eventStore ? { eventCache: {
        ...this.eventStore.stats(), peakPendingEvents: this.peakPendingEvents, peakPendingBytes: this.peakPendingBytes,
        maxPendingEvents: this.activeOptions?.eventCache?.maxPendingEvents ?? 128,
        maxPendingBytes: this.activeOptions?.eventCache?.maxPendingBytes ?? 1024 * 1024,
      } } : {}),
      ...(this.activeOptions?.captureScreenshots ? { screenshotQueue: {
        pendingTasks: this.screenshotTasks.size, peakPendingTasks: this.peakScreenshotTasks,
        maxPendingTasks: this.activeOptions.maxPendingScreenshots ?? 8,
      } } : {}),
    };
  }

  private releaseListeners(): void {
    this.stopScreenshotSampler();
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    try {
      unsubscribe?.();
    } catch (error) {
      this.captureIssues.push(error instanceof Error ? error.message : String(error));
    }
  }

  private async withRequestTimeout<T>(request: Promise<T>, title: string): Promise<T> {
    const budget = this.activeOptions?.requestTimeoutMs ?? 3000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${title} timed out after ${budget}ms.`)), budget);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  getOperations(): RecordedOperation[] {
    return [...this.operations];
  }

  /** Explicit full diagnostic read from disk; normal capture never reloads history. */
  getRawEvents(): RawInputEvent[] {
    return this.eventStore?.readEvents() ?? [];
  }

  /** Cheap progress counters never reload the full diagnostic archive. */
  getRawEventCount(): number { return this.eventStore?.stats().eventCount ?? 0; }

  getRawEventsPath(): string | undefined { return this.eventStore?.path; }

  /** Runtime location, kept outside the portable RecordingResult. */
  getArtifactDirectory(): string | undefined {
    if (!this.sessionId) return undefined;
    return this.activeOptions?.artifactDirectory
      ? join(this.activeOptions.artifactDirectory, this.sessionId)
      : join(tmpdir(), `fliwright-recording-${this.sessionId}`);
  }

  private ensureEventStore(): RecordingEventStore {
    return this.eventStore ??= new RecordingEventStore({
      directory: this.getArtifactDirectory()!,
      maxBufferedEvents: this.activeOptions?.eventCache?.maxBufferedEvents,
      maxBufferedBytes: this.activeOptions?.eventCache?.maxBufferedBytes,
    });
  }

  getFrames(): RecordingFrame[] {
    return this.frames.map(cloneFrame);
  }

  setOperationIncluded(operationIndex: number, included: boolean): string {
    const operation = this.operations[operationIndex];
    if (!operation) {
      throw new Error(`No recorded operation at index ${operationIndex}.`);
    }
    this.operations[operationIndex] = included
      ? {
          ...operation,
          status: 'included',
          ignoreReason: undefined,
          confidence: Math.max(operation.confidence ?? defaultConfidence(operation), 0.7),
        }
      : {
          ...operation,
          status: 'ignored',
          ignoreReason: operation.ignoreReason ?? 'noEffect',
          confidence: Math.min(operation.confidence ?? 0.25, 0.25),
        };
    this.syncFramesWithOperations();
    return this.generateCode();
  }

  private async ensureExtensionStream(): Promise<void> {
    try {
      await this.sendRequest('streamListen', { streamId: 'Extension' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalized = message.toLowerCase();
      if (!normalized.includes('already') && !normalized.includes('subscrib')) {
        throw error;
      }
    }
  }

  private async waitForSequence(expected: number, timeoutMs: number): Promise<boolean> {
    if (this.contiguousSequence >= expected) return true;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline && this.contiguousSequence < expected) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.contiguousSequence >= expected;
  }

  private aggregateOperations(): RecordedOperation[] {
    const operations = this.eventStore?.getOperations() ?? [];
    if (!this.activeOptions?.filterNoise) {
      return operations;
    }
    return applyRealtimeNoiseFilter(operations);
  }

  private captureFrameForRawEvent(event: RawInputEvent): void {
    if (!this.activeOptions?.captureScreenshots) return;
    if (event.type !== 'pointerEvent' || event.kind !== 'down' || !event.position) return;

    const frame: RecordingFrame = {
      id: `frame-${event.timestamp}-${event.pointer ?? 0}-${this.frames.length}`,
      index: this.frames.length,
      kind: 'pending',
      status: this.latestScreenshot ? 'ready' : 'capturing',
      timestamp: event.timestamp,
      pointer: event.pointer,
      position: { ...event.position },
      screenshot: this.latestScreenshot ? { ...this.latestScreenshot } : undefined,
      screenshotError: this.latestScreenshot ? undefined : this.latestScreenshotError ?? undefined,
    };
    this.frames.push(frame);
    this.emitFrame(frame);

    if (this.latestScreenshot) return;
    this.enqueueScreenshotForFrame(frame.index);
  }

  private async startScreenshotSampler(options?: RecorderStartOptions): Promise<void> {
    if (!options?.captureScreenshots) return;
    this.screenshotSamplingActive = true;
    const intervalMs = Math.max(
      100,
      options.screenshotSampleIntervalMs ?? RecorderController.defaultScreenshotSampleIntervalMs,
    );
    const sample = (): void => {
      if (this.isSamplingScreenshot) return;
      if (this.screenshotTasks.size >= (this.activeOptions?.maxPendingScreenshots ?? 8)) {
        this.reportScreenshotQueueExhaustion();
        return;
      }
      this.trackScreenshotTask(this.sampleScreenshot());
    };
    await this.trackScreenshotTask(this.sampleScreenshot());
    if (this.screenshotSamplingActive) this.screenshotSampler = setInterval(sample, intervalMs);
  }

  private stopScreenshotSampler(): void {
    if (this.screenshotSampler) clearInterval(this.screenshotSampler);
    this.screenshotSampler = null;
    this.screenshotSamplingActive = false;
  }

  private async sampleScreenshot(): Promise<void> {
    if (!this.screenshotSamplingActive) return;
    if (this.isSamplingScreenshot) return;
    this.isSamplingScreenshot = true;
    const generation = this.generation;
    try {
      const screenshot = await this.withRequestTimeout(this.requestScreenshot(), 'Recording screenshot');
      if (!this.screenshotSamplingActive || generation !== this.generation) return;
      this.latestScreenshot = screenshot;
      this.latestScreenshotError = null;
    } catch (error) {
      if (!this.screenshotSamplingActive || generation !== this.generation) return;
      this.latestScreenshotError = error instanceof Error ? error.message : String(error);
      if (!this.captureIssues.includes(this.latestScreenshotError)) this.captureIssues.push(this.latestScreenshotError);
    } finally {
      if (generation === this.generation) this.isSamplingScreenshot = false;
    }
  }

  private enqueueScreenshotForFrame(index: number): void {
    if (this.screenshotTasks.size >= (this.activeOptions?.maxPendingScreenshots ?? 8)) {
      const error = this.reportScreenshotQueueExhaustion();
      this.frames[index] = { ...this.frames[index], status: 'error', screenshotError: error };
      this.emitFrame(this.frames[index]);
      return;
    }
    const generation = this.generation;
    const task = this.screenshotQueue
      .catch(() => undefined)
      .then(() => generation === this.generation ? this.captureScreenshotForFrame(index, generation) : undefined);
    this.screenshotQueue = task;
    this.trackScreenshotTask(task);
  }

  private trackScreenshotTask(work: Promise<void>): Promise<void> {
    const tasks = this.screenshotTasks;
    const generation = this.generation;
    const task = work.catch((error: unknown) => {
      if (generation !== this.generation) return;
      const issue = error instanceof Error ? error.message : String(error);
      if (!this.captureIssues.includes(issue)) this.captureIssues.push(issue);
    }).finally(() => { tasks.delete(task); });
    tasks.add(task);
    this.peakScreenshotTasks = Math.max(this.peakScreenshotTasks, tasks.size);
    return task;
  }

  private reportScreenshotQueueExhaustion(): string {
    const issue = 'Recording screenshot queue budget exhausted; affected evidence is partial.';
    if (!this.captureIssues.includes(issue)) this.captureIssues.push(issue);
    return issue;
  }

  private async captureScreenshotForFrame(index: number, generation: number): Promise<void> {
    try {
      const screenshot = await this.withRequestTimeout(this.requestScreenshot(), 'Recording screenshot');
      if (generation !== this.generation) return;
      const frame = this.frames[index];
      if (!frame) return;
      this.latestScreenshot = screenshot;
      this.latestScreenshotError = null;
      this.frames[index] = {
        ...frame,
        status: 'ready',
        screenshot,
        screenshotError: undefined,
      };
    } catch (error) {
      if (generation !== this.generation) return;
      const frame = this.frames[index];
      if (!frame) return;
      this.latestScreenshotError = error instanceof Error ? error.message : String(error);
      if (!this.captureIssues.includes(this.latestScreenshotError)) this.captureIssues.push(this.latestScreenshotError);
      this.frames[index] = {
        ...frame,
        status: 'error',
        screenshotError: error instanceof Error ? error.message : String(error),
      };
    }
    this.emitFrame(this.frames[index]);
  }

  private async requestScreenshot(): Promise<RecordingScreenshot> {
    const generation = this.generation;
    const deadline = Date.now() + (this.activeOptions?.requestTimeoutMs ?? 3000);
    const checkActive = () => {
      if (generation !== this.generation) throw new Error('Recording screenshot belongs to a finished session.');
      if (Date.now() >= deadline) throw new Error('Recording screenshot timed out; late evidence was discarded.');
    };
    // The sampler records the latest composited frame, including animations.
    // Waiting for global quiescence delays history precisely while the user acts.
    const result = await this.sendRequest('ext.fliwright.screenshot', {
      pixelRatio: '1.0',
      waitForFrame: 'false',
    }) as {
      success?: boolean;
      format?: string;
      screenshot?: string;
      width?: number;
      height?: number;
      pixelRatio?: number;
      error?: string;
    };

    if (!result?.screenshot) {
      throw new Error(result?.error ?? 'Screenshot did not return image data');
    }
    checkActive();
    const store = this.artifactStore ??= new RecordingArtifactStore(this.getArtifactDirectory()!, this.activeOptions?.maxScreenshotBytes);
    return store.screenshot(result.screenshot, {
      format: 'png',
      width: toNumber(result.width),
      height: toNumber(result.height),
      pixelRatio: toNumber(result.pixelRatio),
    });
  }

  private syncFramesWithOperations(): void {
    for (let i = 0; i < this.operations.length; i++) {
      const op = this.operations[i];
      let frameIndex = this.findFrameIndexForOperation(op, i);
      if (frameIndex < 0) {
        // Operation has no captured frame (e.g. standalone text input with no
        // preceding pointer-down). Synthesize one so every operation stays
        // visible in the canvas. Gated on captureScreenshots like real frames.
        if (!this.activeOptions?.captureScreenshots) continue;
        const synthetic: RecordingFrame = {
          id: `frame-synthetic-${op.timestamp}-${i}`,
          index: this.frames.length,
          kind: op.kind,
          status: this.latestScreenshot ? 'ready' : 'capturing',
          timestamp: op.timestamp,
          operationIndex: i,
          position: { x: op.position.x, y: op.position.y },
          delta: op.delta ? { x: op.delta.x, y: op.delta.y } : undefined,
          text: op.text,
          sensitive: op.sensitive,
          action: op.action,
          duration: op.duration,
          durationMs: op.durationMs,
          operationStatus: op.status,
          ignoreReason: op.ignoreReason,
          confidence: op.confidence,
          screenshot: this.latestScreenshot ? { ...this.latestScreenshot } : undefined,
          synthetic: true,
        };
        this.frames.push(synthetic);
        this.emitFrame(synthetic);
        if (!this.latestScreenshot) {
          this.enqueueScreenshotForFrame(synthetic.index);
        }
        continue;
      }
      const frame = this.frames[frameIndex];
      const updated: RecordingFrame = {
        ...frame,
        kind: op.kind,
        operationIndex: i,
        delta: op.delta,
        text: op.text,
        sensitive: op.sensitive,
        action: op.action,
        duration: op.duration,
        durationMs: op.durationMs,
        operationStatus: op.status,
        ignoreReason: op.ignoreReason,
        confidence: op.confidence,
      };
      if (!sameFrame(frame, updated)) {
        this.frames[frameIndex] = updated;
        this.emitFrame(updated);
      }
    }
  }

  private findFrameIndexForOperation(op: RecordedOperation, fallbackIndex: number): number {
    const exactIndex = this.frames.findIndex((frame) => (
      frame.operationIndex == null &&
      frame.timestamp === op.timestamp &&
      frame.position.x === op.position.x &&
      frame.position.y === op.position.y
    ));
    if (exactIndex >= 0) return exactIndex;

    const previousIndex = this.frames.findIndex((frame) => frame.operationIndex === fallbackIndex);
    if (previousIndex >= 0) return previousIndex;

    return fallbackIndex < this.frames.length ? fallbackIndex : -1;
  }

  private setFrameSelector(operationIndex: number, selector: string): void {
    const frameIndex = this.frames.findIndex((frame) => frame.operationIndex === operationIndex);
    if (frameIndex < 0) return;
    this.frames[frameIndex] = { ...this.frames[frameIndex], selector };
    this.emitFrame(this.frames[frameIndex]);
  }

  private generateCode(): string {
    return new CodeGenerator().generate(this.operations, this.lastSelectors, this.lastCodegenOptions);
  }

  getSelectors(): ReadonlyMap<number, ResolvedSelector> {
    return new Map(this.lastSelectors);
  }

  private emitFrame(frame: RecordingFrame | undefined): void {
    if (!frame) return;
    this.activeOptions?.onFrame?.(cloneFrame(frame), frame.index);
  }
}

function cloneFrame(frame: RecordingFrame): RecordingFrame {
  return {
    ...frame,
    position: { ...frame.position },
    delta: frame.delta ? { ...frame.delta } : undefined,
    screenshot: frame.screenshot ? { ...frame.screenshot } : undefined,
  };
}

function sameFrame(a: RecordingFrame, b: RecordingFrame): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function applyRealtimeNoiseFilter(operations: RecordedOperation[]): RecordedOperation[] {
  const filtered: RecordedOperation[] = [];
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    const previous = findPreviousIncludedOperation(filtered);
    if (
      operation.kind === 'tap' &&
      previous?.kind === 'tap' &&
      operation.timestamp - previous.timestamp <= 500_000 &&
      distance(operation.position, previous.position) <= 12
    ) {
      filtered.push({
        ...operation,
        status: 'ignored',
        ignoreReason: 'duplicate',
        confidence: 0.2,
      });
      continue;
    }

    filtered.push({
      ...operation,
      status: operation.status ?? 'included',
      confidence: operation.confidence ?? defaultConfidence(operation),
    });
  }
  return filtered;
}

function findPreviousIncludedOperation(operations: RecordedOperation[]): RecordedOperation | undefined {
  for (let i = operations.length - 1; i >= 0; i--) {
    if (operations[i].status !== 'ignored') return operations[i];
  }
  return undefined;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function defaultConfidence(operation: RecordedOperation): number {
  if (operation.kind === 'type') return 0.95;
  if (operation.kind === 'drag') return 0.85;
  if (operation.kind === 'longPress') return 0.8;
  return 0.7;
}

function recordingPayload(event: RecorderStreamEvent): unknown {
  if (event.kind === 'FliwrightRecording') return event.data;
  if (event.data.extensionKind === 'FliwrightRecording') return event.data.extensionData;
  if (event.data.kind === 'FliwrightRecording') return event.data.data;
  return undefined;
}

function rawRecordingEvent(envelope: RecordingEventEnvelope): RawInputEvent {
  const { payload, ...metadata } = envelope;
  const common = { ...metadata, timestamp: envelope.elapsedUs };
  switch (payload.kind) {
    case 'pointer': return {
      ...common, type: 'pointerEvent', kind: payload.phase, pointer: payload.pointer,
      position: { x: payload.x, y: payload.y },
      viewport: { width: payload.viewportWidth, height: payload.viewportHeight, pixelRatio: payload.pixelRatio },
    };
    case 'text': return {
      ...common, type: 'textInput', text: payload.value, action: 'replace', focusSessionId: payload.focusSessionId,
      ...(payload.sensitive ? { sensitive: true } : {}),
    };
    case 'focus': return {
      ...common, type: 'focus', focused: payload.focused, focusSessionId: payload.focusSessionId,
    };
    case 'route': return { ...common, type: 'route', route: payload.route };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
