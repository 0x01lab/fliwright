import { CodeGenerator } from './CodeGenerator.js';
import { EventAggregator } from './EventAggregator.js';
import { resolveSelector } from './SelectorResolver.js';
import type { CodegenOptions, RawInputEvent, RecordedOperation, WidgetInfo, SendRequest } from './types.js';

type OnEvent = (callback: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) => () => void;

export interface RecorderStartOptions {
  onOperation?: (operation: RecordedOperation, index: number) => void;
}

export class RecorderController {
  private rawEvents: RawInputEvent[] = [];
  private operations: RecordedOperation[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly sendRequest: SendRequest,
    private readonly onEvent: OnEvent,
  ) {}

  async start(options?: RecorderStartOptions): Promise<void> {
    this.rawEvents = [];
    this.operations = [];

    console.log('[fliwright] RecorderController.start() — subscribing to Extension stream');
    await this.ensureExtensionStream();
    this.unsubscribe = this.onEvent((event) => {
      console.log(`[fliwright] RecorderController received event: kind=${event.kind}`);
      if (event.kind === 'FliwrightRecording') {
        const prevCount = this.operations.length;
        this.rawEvents.push(event.data as unknown as RawInputEvent);
        this.operations = new EventAggregator().aggregate(this.rawEvents);
        console.log(`[fliwright] rawEvents=${this.rawEvents.length} operations=${this.operations.length}`);
        for (let i = prevCount; i < this.operations.length; i++) {
          options?.onOperation?.(this.operations[i], i);
        }
      }
    });

    console.log('[fliwright] calling ext.fliwright.startRecording');
    await this.sendRequest('ext.fliwright.startRecording', {});
    console.log('[fliwright] recording started on Dart side');
  }

  async stop(options?: CodegenOptions): Promise<string> {
    console.log('[fliwright] RecorderController.stop() — stopping recording');
    await this.sendRequest('ext.fliwright.stopRecording', {});
    console.log(`[fliwright] stopped: rawEvents=${this.rawEvents.length} operations=${this.operations.length}`);

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.operations = new EventAggregator().aggregate(this.rawEvents);
    const selectors = new Map<number, string>();
    for (let i = 0; i < this.operations.length; i++) {
      selectors.set(i, await this.resolveSelector(this.operations[i]));
    }

    return new CodeGenerator().generate(this.operations, selectors, options);
  }

  getOperations(): RecordedOperation[] {
    return [...this.operations];
  }

  getRawEvents(): RawInputEvent[] {
    return [...this.rawEvents];
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
}
