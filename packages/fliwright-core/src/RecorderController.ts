import { CodeGenerator } from './CodeGenerator.js';
import { EventAggregator } from './EventAggregator.js';
import { resolveSelector } from './SelectorResolver.js';
import type {
  CodegenOptions,
  RawInputEvent,
  RecordedOperation,
  RecordingFrame,
  RecordingScreenshot,
  WidgetInfo,
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
  onOperation?: (operation: RecordedOperation, index: number) => void;
  captureScreenshots?: boolean;
  onFrame?: (frame: RecordingFrame, index: number) => void;
  screenshotSampleIntervalMs?: number;
  filterNoise?: boolean;
}

export class RecorderController {
  private static readonly defaultScreenshotSampleIntervalMs = 250;

  private rawEvents: RawInputEvent[] = [];
  private operations: RecordedOperation[] = [];
  private frames: RecordingFrame[] = [];
  private screenshotTasks: Promise<void>[] = [];
  private screenshotQueue: Promise<void> = Promise.resolve();
  private screenshotSampler: ReturnType<typeof setInterval> | null = null;
  private latestScreenshot: RecordingScreenshot | null = null;
  private latestScreenshotError: string | null = null;
  private isSamplingScreenshot = false;
  private screenshotSamplingActive = false;
  private unsubscribe: (() => void) | null = null;
  private activeOptions: RecorderStartOptions | undefined;
  private lastSelectors = new Map<number, string>();
  private lastCodegenOptions: CodegenOptions | undefined;

  constructor(
    private readonly sendRequest: SendRequest,
    private readonly onEvent: OnEvent,
  ) {}

  async start(options?: RecorderStartOptions): Promise<void> {
    this.rawEvents = [];
    this.operations = [];
    this.frames = [];
    this.screenshotTasks = [];
    this.screenshotQueue = Promise.resolve();
    this.latestScreenshot = null;
    this.latestScreenshotError = null;
    this.isSamplingScreenshot = false;
    this.screenshotSamplingActive = false;
    this.lastSelectors = new Map();
    this.lastCodegenOptions = undefined;
    this.activeOptions = options;

    console.log('[fliwright] RecorderController.start() — subscribing to Extension stream');
    await this.ensureExtensionStream();
    this.unsubscribe = this.onEvent((event) => {
      console.log(`[fliwright] RecorderController received event: kind=${event.kind}`);
      const rawEvent = normalizeRecordingEvent(event);
      if (!rawEvent) {
        if (event.streamId === 'Extension') {
          console.log(`[fliwright] RecorderController ignored Extension event kind=${event.kind} dataKeys=${Object.keys(event.data ?? {}).join(',')}`);
        }
        return;
      }
      this.captureFrameForRawEvent(rawEvent);
      const prevCount = this.operations.length;
      this.rawEvents.push(rawEvent);
      this.operations = this.aggregateOperations();
      this.syncFramesWithOperations();
      console.log(`[fliwright] rawEvents=${this.rawEvents.length} operations=${this.operations.length}`);
      for (let i = prevCount; i < this.operations.length; i++) {
        options?.onOperation?.(this.operations[i], i);
      }
    });

    console.log('[fliwright] calling ext.fliwright.startRecording');
    await this.sendRequest('ext.fliwright.startRecording', {});
    console.log('[fliwright] recording started on Dart side');
    await this.startScreenshotSampler(options);
  }

  async stop(options?: CodegenOptions): Promise<string> {
    console.log('[fliwright] RecorderController.stop() — stopping recording');
    this.stopScreenshotSampler();
    await this.sendRequest('ext.fliwright.stopRecording', {});
    console.log(`[fliwright] stopped: rawEvents=${this.rawEvents.length} operations=${this.operations.length}`);

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    await Promise.allSettled(this.screenshotTasks);
    this.operations = this.aggregateOperations();
    const selectors = new Map<number, string>();
    for (let i = 0; i < this.operations.length; i++) {
      const selector = await this.resolveSelector(this.operations[i]);
      selectors.set(i, selector);
      this.classifyOperationWithSelector(i, selector);
      this.setFrameSelector(i, selector);
    }
    this.lastSelectors = selectors;
    this.lastCodegenOptions = options;

    return this.generateCode();
  }

  getOperations(): RecordedOperation[] {
    return [...this.operations];
  }

  getRawEvents(): RawInputEvent[] {
    return [...this.rawEvents];
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

  private async resolveSelector(op: RecordedOperation): Promise<string> {
    try {
      const result = await this.sendRequest('ext.fliwright.hitTest', {
        x: op.position.x,
        y: op.position.y,
      }) as { widget?: Partial<WidgetInfo> };

      const widget = result.widget;
      if (!widget?.type) return "{ type: 'Widget' }";
      return resolveSelector(widget);
    } catch {
      return "{ type: 'Widget' }";
    }
  }

  private aggregateOperations(): RecordedOperation[] {
    const operations = new EventAggregator().aggregate(this.rawEvents);
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
    const task = this.enqueueScreenshotForFrame(frame.index);
    this.screenshotTasks.push(task);
  }

  private async startScreenshotSampler(options?: RecorderStartOptions): Promise<void> {
    if (!options?.captureScreenshots) return;
    this.screenshotSamplingActive = true;
    const intervalMs = Math.max(
      100,
      options.screenshotSampleIntervalMs ?? RecorderController.defaultScreenshotSampleIntervalMs,
    );
    const sample = (): void => {
      const task = this.sampleScreenshot();
      this.screenshotTasks.push(task);
    };
    await this.sampleScreenshot();
    this.screenshotSampler = setInterval(sample, intervalMs);
  }

  private stopScreenshotSampler(): void {
    if (!this.screenshotSampler) return;
    clearInterval(this.screenshotSampler);
    this.screenshotSampler = null;
    this.screenshotSamplingActive = false;
  }

  private async sampleScreenshot(): Promise<void> {
    if (!this.screenshotSamplingActive) return;
    if (this.isSamplingScreenshot) return;
    this.isSamplingScreenshot = true;
    try {
      const screenshot = await this.requestScreenshot();
      if (!this.screenshotSamplingActive) return;
      this.latestScreenshot = screenshot;
      this.latestScreenshotError = null;
    } catch (error) {
      if (!this.screenshotSamplingActive) return;
      this.latestScreenshotError = error instanceof Error ? error.message : String(error);
    } finally {
      this.isSamplingScreenshot = false;
    }
  }

  private enqueueScreenshotForFrame(index: number): Promise<void> {
    const task = this.screenshotQueue
      .catch(() => undefined)
      .then(() => this.captureScreenshotForFrame(index));
    this.screenshotQueue = task;
    return task;
  }

  private async captureScreenshotForFrame(index: number): Promise<void> {
    try {
      const screenshot = await this.requestScreenshot();
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
      const frame = this.frames[index];
      if (!frame) return;
      this.latestScreenshotError = error instanceof Error ? error.message : String(error);
      this.frames[index] = {
        ...frame,
        status: 'error',
        screenshotError: error instanceof Error ? error.message : String(error),
      };
    }
    this.emitFrame(this.frames[index]);
  }

  private async requestScreenshot(): Promise<RecordingScreenshot> {
    await this.waitForStableFrame();
    const result = await this.sendRequest('ext.fliwright.screenshot', {
      pixelRatio: '1.0',
      mode: 'auto',
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

    return {
      base64: result.screenshot,
      format: 'png',
      width: toNumber(result.width),
      height: toNumber(result.height),
      pixelRatio: toNumber(result.pixelRatio),
    };
  }

  private async waitForStableFrame(): Promise<void> {
    try {
      await this.sendRequest('ext.fliwright.settle', {
        timeout: '1200',
        stableFrames: '2',
      });
    } catch {
      // Older bridges may not expose settle; screenshot capture still works.
    }
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
          action: op.action,
          duration: op.duration,
          operationStatus: op.status,
          ignoreReason: op.ignoreReason,
          confidence: op.confidence,
          screenshot: this.latestScreenshot ? { ...this.latestScreenshot } : undefined,
          synthetic: true,
        };
        this.frames.push(synthetic);
        this.emitFrame(synthetic);
        if (!this.latestScreenshot) {
          const task = this.enqueueScreenshotForFrame(synthetic.index);
          this.screenshotTasks.push(task);
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
        action: op.action,
        duration: op.duration,
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

  private classifyOperationWithSelector(operationIndex: number, selector: string): void {
    if (!this.activeOptions?.filterNoise) return;
    const operation = this.operations[operationIndex];
    if (!operation || operation.status === 'ignored') return;

    if (operation.kind === 'tap' && isGenericWidgetSelector(selector)) {
      this.operations[operationIndex] = {
        ...operation,
        status: 'ignored',
        ignoreReason: 'nonActionable',
        confidence: 0.25,
      };
      this.syncFramesWithOperations();
    }
  }

  private generateCode(): string {
    return new CodeGenerator().generate(this.operations, this.lastSelectors, this.lastCodegenOptions);
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

function isGenericWidgetSelector(selector: string): boolean {
  return selector.trim() === "{ type: 'Widget' }";
}

function normalizeRecordingEvent(event: { kind: string; data: Record<string, unknown> }): RawInputEvent | null {
  if (event.kind === 'FliwrightRecording') {
    return event.data as unknown as RawInputEvent;
  }

  const data = event.data as {
    extensionKind?: unknown;
    extensionData?: unknown;
    kind?: unknown;
    data?: unknown;
  };

  if (data.extensionKind === 'FliwrightRecording' && isObject(data.extensionData)) {
    return data.extensionData as unknown as RawInputEvent;
  }
  if (data.kind === 'FliwrightRecording' && isObject(data.data)) {
    return data.data as unknown as RawInputEvent;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
