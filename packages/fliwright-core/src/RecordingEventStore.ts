import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EventAggregator } from './EventAggregator.js';
import type { RawInputEvent, RecordedOperation } from './types.js';

export interface RecordingEventStoreOptions {
  directory: string;
  maxBufferedEvents?: number;
  maxBufferedBytes?: number;
}

export interface RecordingEventCacheStats {
  eventCount: number;
  archivedEvents: number;
  bufferedEvents: number;
  bufferedBytes: number;
  peakBufferedEvents: number;
  peakBufferedBytes: number;
  maxBufferedEvents: number;
  maxBufferedBytes: number;
}

/** Archive raw events immediately; only the current gesture/edit segment stays hot. */
export class RecordingEventStore {
  readonly path: string;
  readonly issues: string[] = [];
  private buffer: RawInputEvent[] = [];
  private completed: RecordedOperation[] = [];
  private activePointers = new Set<number>();
  private unsupported = new Set<string>();
  private eventCount = 0;
  private archivedEvents = 0;
  private peakBufferedEvents = 0;
  private peakBufferedBytes = 0;
  private readonly maxBufferedEvents: number;
  private readonly maxBufferedBytes: number;
  private archiveFailed = false;

  constructor(options: RecordingEventStoreOptions) {
    this.maxBufferedEvents = positiveInteger(options.maxBufferedEvents ?? 128, 'maxBufferedEvents');
    this.maxBufferedBytes = positiveInteger(options.maxBufferedBytes ?? 1024 * 1024, 'maxBufferedBytes');
    this.path = join(options.directory, 'events.jsonl');
    try {
      mkdirSync(options.directory, { recursive: true });
      writeFileSync(this.path, '', { flag: 'wx' });
    } catch (error) {
      this.archiveFailed = true;
      this.issue(`Recording event archive initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  append(event: RawInputEvent): void {
    this.archive(event);
    this.consume(event);
  }

  /** Receipt order is preserved on disk; sequence ordering is a caller concern. */
  archive(event: RawInputEvent): void {
    this.eventCount++;
    // No unbounded promise queue: archive the event before retaining its compact
    // aggregate. Disk errors remain explicit while business operations continue.
    if (!this.archiveFailed) {
      try {
        appendFileSync(this.path, `${JSON.stringify(event)}\n`, 'utf8');
        this.archivedEvents++;
      } catch (error) {
        this.archiveFailed = true;
        this.issue(`Recording event archive write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

  }

  /** Consume an already archived, ordered event without retaining prior raw events. */
  consume(event: RawInputEvent): void {
    if (this.activePointers.size === 0 && this.endsSegment(event)) this.flushSegment();

    if (event.type === 'pointerEvent') {
      const pointer = event.pointer ?? 0;
      if (event.kind === 'down') {
        this.activePointers.add(pointer);
        if (this.activePointers.size > 1) this.unsupported.add('multi-pointer gesture');
      } else if (event.kind === 'up' || event.kind === 'cancel') {
        this.activePointers.delete(pointer);
      }
      // Current gesture recognition uses down/up coordinates, not move samples.
      // The complete trajectory remains in the archive for review/diagnosis.
      if (event.kind === 'move') return;
    }

    const last = this.buffer.at(-1);
    const compactText = event.type === 'textInput' && last?.type === 'textInput'
      && sameEditingSession(last, event);
    const next = compactText
      ? [...this.buffer.slice(0, -1), { ...event, timestamp: last.timestamp, sequence: last.sequence }]
      : [...this.buffer, event];
    if (next.length > this.maxBufferedEvents || bytes(next) > this.maxBufferedBytes) {
      this.issue('Recording event buffer budget exhausted; unfinished gesture/edit segment is partial. Full raw events remain in the archive when writable.');
      this.flushSegment();
      this.activePointers.clear();
      if (bytes([event]) > this.maxBufferedBytes) {
        // Preserve a valid standalone business operation without retaining the
        // oversized raw event in the aggregation window.
        this.completed.push(...new EventAggregator().aggregate([event]));
        return;
      }
      this.buffer = [event];
      if (event.type === 'pointerEvent' && event.kind === 'down') this.activePointers.add(event.pointer ?? 0);
    } else {
      this.buffer = next;
    }
    this.peakBufferedEvents = Math.max(this.peakBufferedEvents, this.buffer.length);
    this.peakBufferedBytes = Math.max(this.peakBufferedBytes, bytes(this.buffer));
  }

  getOperations(): RecordedOperation[] {
    return [...this.completed, ...new EventAggregator().aggregate(this.buffer)];
  }

  get unsupportedGestures(): string[] { return [...this.unsupported]; }

  get hasArchive(): boolean {
    try { return statSync(this.path).isFile(); } catch { return false; }
  }

  /** Explicit diagnostic read; the archive is never loaded by normal aggregation. */
  readEvents(): RawInputEvent[] {
    return readFileSync(this.path, 'utf8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as RawInputEvent)
      .sort((a, b) => (a.sequence ?? a.timestamp) - (b.sequence ?? b.timestamp));
  }

  stats(): RecordingEventCacheStats {
    return {
      eventCount: this.eventCount, archivedEvents: this.archivedEvents,
      bufferedEvents: this.buffer.length, bufferedBytes: bytes(this.buffer),
      peakBufferedEvents: this.peakBufferedEvents, peakBufferedBytes: this.peakBufferedBytes,
      maxBufferedEvents: this.maxBufferedEvents, maxBufferedBytes: this.maxBufferedBytes,
    };
  }

  private endsSegment(event: RawInputEvent): boolean {
    if (event.type === 'route') return true;
    if (event.type === 'pointerEvent') return event.kind === 'down';
    const current = new EventAggregator().aggregate(this.buffer).at(-1);
    if (event.type === 'focus') {
      return !event.focused || (current?.kind === 'type' && current.focusSessionId !== event.focusSessionId)
        || !!(event.targetId && current?.recordedTarget?.targetId !== event.targetId);
    }
    if (event.type === 'textInput') {
      const targetId = event.targetId ?? event.target?.targetId;
      return !(current && targetId && targetId === current.recordedTarget?.targetId && event.focusSessionId
        && (current.kind === 'tap' || current.focusSessionId === event.focusSessionId));
    }
    return false;
  }

  private flushSegment(): void {
    this.completed.push(...new EventAggregator().aggregate(this.buffer));
    this.buffer = [];
  }

  private issue(message: string): void {
    const portable = message.split(dirname(this.path)).join('<recording-artifacts>');
    if (!this.issues.includes(portable)) this.issues.push(portable);
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
  return value;
}

function bytes(events: RawInputEvent[]): number {
  return events.reduce((total, event) => total + Buffer.byteLength(JSON.stringify(event), 'utf8'), 0);
}

function sameEditingSession(a: RawInputEvent, b: RawInputEvent): boolean {
  const targetId = a.targetId ?? a.target?.targetId;
  return !!(targetId && targetId === (b.targetId ?? b.target?.targetId)
    && a.focusSessionId && a.focusSessionId === b.focusSessionId);
}
