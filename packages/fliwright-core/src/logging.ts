import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type FliwrightLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'success';

export type FliwrightLogKind =
  | 'run'
  | 'test'
  | 'script'
  | 'step'
  | 'action'
  | 'assertion'
  | 'mock'
  | 'ai'
  | 'artifact'
  | 'diagnostic'
  | 'user';

export type FliwrightLogMode = 'test' | 'script';

export type FliwrightLogStatus = 'running' | 'passed' | 'failed' | 'skipped';

export interface FliwrightLogError {
  name?: string;
  message: string;
  stack?: string;
}

export interface FliwrightLogEvent {
  version: 1;
  id: string;
  runId: string;
  testName?: string;
  mode: FliwrightLogMode;
  level: FliwrightLogLevel;
  kind: FliwrightLogKind;
  message: string;
  timestamp: string;
  durationMs?: number;
  status?: FliwrightLogStatus;
  timelineNodeId?: string;
  data?: Record<string, unknown>;
  error?: FliwrightLogError;
}

export interface FliwrightLogInput {
  level?: FliwrightLogLevel;
  kind?: FliwrightLogKind;
  message: string;
  status?: FliwrightLogStatus;
  durationMs?: number;
  timelineNodeId?: string;
  data?: Record<string, unknown>;
  error?: unknown;
}

export interface FliwrightLogger {
  log(input: FliwrightLogInput): void;
  trace(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
  success(message: string, data?: Record<string, unknown>): void;
  child(context: Partial<Pick<FliwrightLogEvent, 'runId' | 'testName' | 'mode' | 'kind' | 'timelineNodeId'>>): FliwrightLogger;
}

export interface LogFormatter {
  format(event: FliwrightLogEvent): string;
}

export interface LogSink {
  write(event: FliwrightLogEvent): void | Promise<void>;
  flush?(): void | Promise<void>;
}

export interface FliwrightLoggerOptions {
  runId: string;
  testName?: string;
  mode?: FliwrightLogMode;
  kind?: FliwrightLogKind;
  level?: FliwrightLogLevel;
  sinks?: LogSink[];
  context?: Partial<Pick<FliwrightLogEvent, 'timelineNodeId'>>;
}

const levelWeight: Record<FliwrightLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  success: 35,
  warn: 40,
  error: 50,
};

let eventCounter = 0;

export class StructuredLogger implements FliwrightLogger {
  private readonly level: FliwrightLogLevel;
  private readonly sinks: LogSink[];

  constructor(private readonly options: FliwrightLoggerOptions) {
    this.level = options.level ?? 'info';
    this.sinks = options.sinks ?? [];
  }

  log(input: FliwrightLogInput): void {
    const level = input.level ?? 'info';
    if (levelWeight[level] < levelWeight[this.level]) return;

    const event: FliwrightLogEvent = {
      version: 1,
      id: nextEventId(),
      runId: this.options.runId,
      ...(this.options.testName ? { testName: this.options.testName } : {}),
      mode: this.options.mode ?? 'test',
      level,
      kind: input.kind ?? this.options.kind ?? 'user',
      message: input.message,
      timestamp: new Date().toISOString(),
      ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.timelineNodeId ?? this.options.context?.timelineNodeId ? {
        timelineNodeId: input.timelineNodeId ?? this.options.context?.timelineNodeId,
      } : {}),
      ...(input.data ? { data: input.data } : {}),
      ...(input.error ? { error: normalizeLogError(input.error) } : {}),
    };

    for (const sink of this.sinks) {
      void sink.write(event);
    }
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'trace', message, data });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'debug', message, data });
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'info', message, data });
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'warn', message, data });
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    this.log({ level: 'error', message, error, data });
  }

  success(message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'success', message, data });
  }

  child(context: Partial<Pick<FliwrightLogEvent, 'runId' | 'testName' | 'mode' | 'kind' | 'timelineNodeId'>>): FliwrightLogger {
    return new StructuredLogger({
      ...this.options,
      ...context,
      runId: context.runId ?? this.options.runId,
      testName: context.testName ?? this.options.testName,
      mode: context.mode ?? this.options.mode,
      kind: context.kind ?? this.options.kind,
      level: this.level,
      sinks: this.sinks,
      context: {
        ...this.options.context,
        ...(context.timelineNodeId ? { timelineNodeId: context.timelineNodeId } : {}),
      },
    });
  }
}

export class MemoryLogSink implements LogSink {
  readonly events: FliwrightLogEvent[] = [];

  write(event: FliwrightLogEvent): void {
    this.events.push(event);
  }
}

export class ConsoleLogSink implements LogSink {
  constructor(
    private readonly formatter: LogFormatter = new PrettyLogFormatter(),
    private readonly stream: Pick<NodeJS.WriteStream, 'write'> = process.stderr,
  ) {}

  write(event: FliwrightLogEvent): void {
    this.stream.write(`${this.formatter.format(event)}\n`);
  }
}

export class FileLogSink implements LogSink {
  constructor(
    private readonly path: string,
    private readonly formatter: LogFormatter = new PrettyLogFormatter({ color: false }),
  ) {}

  write(event: FliwrightLogEvent): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${this.formatter.format(event)}\n`, 'utf8');
  }
}

export class JsonlLogSink extends FileLogSink {
  constructor(path: string) {
    super(path, new JsonLogFormatter());
  }
}

export class MultiLogSink implements LogSink {
  constructor(private readonly sinks: LogSink[]) {}

  write(event: FliwrightLogEvent): void {
    for (const sink of this.sinks) {
      void sink.write(event);
    }
  }

  async flush(): Promise<void> {
    for (const sink of this.sinks) {
      await sink.flush?.();
    }
  }
}

export class JsonLogFormatter implements LogFormatter {
  format(event: FliwrightLogEvent): string {
    return JSON.stringify(event);
  }
}

export class CompactLogFormatter implements LogFormatter {
  format(event: FliwrightLogEvent): string {
    const status = event.status ? `${event.status.toUpperCase()} ` : '';
    const duration = event.durationMs != null ? ` ${event.durationMs}ms` : '';
    const testName = event.testName ? ` ${event.testName}` : '';
    return `${event.level.toUpperCase()} ${status}${event.kind}${testName}: ${event.message}${duration}`;
  }
}

export interface PrettyLogFormatterOptions {
  color?: boolean;
  includeTimestamp?: boolean;
}

export class PrettyLogFormatter implements LogFormatter {
  constructor(private readonly options: PrettyLogFormatterOptions = {}) {}

  format(event: FliwrightLogEvent): string {
    const color = this.options.color ?? false;
    const marker = levelMarker(event.level, color);
    const timestamp = this.options.includeTimestamp ? `${event.timestamp} ` : '';
    const status = event.status && event.status !== 'running' ? ` ${event.status}` : '';
    const duration = event.durationMs != null ? ` ${event.durationMs}ms` : '';
    const scope = event.testName ? ` ${event.testName}` : '';
    const detail = event.error ? ` - ${event.error.message}` : '';
    return `${timestamp}${marker} ${event.kind}${scope}${status}: ${event.message}${duration}${detail}`;
  }
}

export function createNoopLogger(overrides: Partial<FliwrightLoggerOptions> = {}): FliwrightLogger {
  return new StructuredLogger({
    runId: overrides.runId ?? 'run',
    testName: overrides.testName,
    mode: overrides.mode ?? 'test',
    kind: overrides.kind,
    level: 'error',
    sinks: [],
  });
}

export function normalizeLogError(error: unknown): FliwrightLogError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { message: String(error) };
}

function nextEventId(): string {
  eventCounter += 1;
  return `log-${eventCounter}`;
}

function levelMarker(level: FliwrightLogLevel, color: boolean): string {
  const marker = {
    trace: '.',
    debug: '>',
    info: '*',
    success: 'OK',
    warn: '!',
    error: 'ERR',
  }[level];
  if (!color) return marker;
  const code = {
    trace: 90,
    debug: 36,
    info: 37,
    success: 32,
    warn: 33,
    error: 31,
  }[level];
  return `\u001b[${code}m${marker}\u001b[0m`;
}
