import { CodeGenerator } from './CodeGenerator.js';
import { EventAggregator } from './EventAggregator.js';
import type { CodegenOptions, RawInputEvent, RecordedOperation, WidgetInfo } from './types.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type OnEvent = (callback: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) => () => void;

export class RecorderController {
  private rawEvents: RawInputEvent[] = [];
  private operations: RecordedOperation[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly sendRequest: SendRequest,
    private readonly onEvent: OnEvent,
  ) {}

  async start(): Promise<void> {
    this.rawEvents = [];
    this.operations = [];

    await this.ensureExtensionStream();
    this.unsubscribe = this.onEvent((event) => {
      if (event.kind === 'FliwrightRecording') {
        this.rawEvents.push(event.data as unknown as RawInputEvent);
      }
    });

    await this.sendRequest('ext.fliwright.startRecording', {});
  }

  async stop(options?: CodegenOptions): Promise<string> {
    await this.sendRequest('ext.fliwright.stopRecording', {});

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
      if (widget.text) return `{ text: '${escapeSelectorValue(widget.text)}' }`;
      if (widget.key) return `{ key: '${escapeSelectorValue(widget.key)}' }`;
      return `{ type: '${escapeSelectorValue(widget.type)}' }`;
    } catch {
      return "{ type: 'Widget' }";
    }
  }
}

function escapeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
