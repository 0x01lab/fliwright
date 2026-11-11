import { describe, expect, it } from 'vitest';
import {
  CompactLogFormatter,
  JsonLogFormatter,
  MemoryLogSink,
  PrettyLogFormatter,
  StructuredLogger,
  normalizeLogError,
} from '../src/index.js';

describe('StructuredLogger', () => {
  it('preserves serialized error fields in JSON logs', () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger({ runId: 'run-1', sinks: [sink] });
    const error = {
      name: 'LocatorError',
      message: 'No widget found matching selector',
      stack: 'LocatorError: No widget found\n    at scrollIntoView',
      code: 'WIDGET_NOT_FOUND',
      actionContext: { action: 'scrollIntoView', target: { key: 'assets.home.token' } },
    };

    logger.log({ kind: 'action', level: 'error', message: error.message, error });

    const event = JSON.parse(new JsonLogFormatter().format(sink.events[0]));
    expect(event.error).toEqual(error);
    expect(new PrettyLogFormatter().format(sink.events[0])).not.toContain('[object Object]');
  });

  it('filters events below the configured level', () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger({
      runId: 'run-1',
      testName: 'login',
      mode: 'test',
      level: 'warn',
      sinks: [sink],
    });

    logger.info('ignored');
    logger.warn('visible');

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      runId: 'run-1',
      testName: 'login',
      level: 'warn',
      message: 'visible',
    });
  });

  it('creates scoped child loggers', () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger({
      runId: 'run-1',
      mode: 'script',
      level: 'debug',
      sinks: [sink],
    });

    logger.child({ testName: 'seed', kind: 'script', timelineNodeId: 'step-1' }).debug('Preparing data');

    expect(sink.events[0]).toMatchObject({
      testName: 'seed',
      kind: 'script',
      timelineNodeId: 'step-1',
      message: 'Preparing data',
    });
  });
});

describe('normalizeLogError', () => {
  it('keeps object errors without a message inspectable', () => {
    const error = { code: 'WIDGET_NOT_FOUND', target: { key: 'assets.home.token' } };
    expect(normalizeLogError(error)).toEqual({ ...error, message: JSON.stringify(error) });
  });

  it('keeps native errors and primitive failures readable', () => {
    const error = new TypeError('Invalid selector');
    expect(normalizeLogError(error)).toEqual({ name: error.name, message: error.message, stack: error.stack });
    expect(normalizeLogError('Scroll failed')).toEqual({ message: 'Scroll failed' });
    expect(normalizeLogError(null)).toEqual({ message: 'null' });
  });
});

describe('log formatters', () => {
  const event = {
    version: 1 as const,
    id: 'log-1',
    runId: 'run-1',
    testName: 'login',
    mode: 'test' as const,
    level: 'success' as const,
    kind: 'assertion' as const,
    message: 'Dashboard is visible',
    timestamp: '2026-06-20T00:00:00.000Z',
    status: 'passed' as const,
    durationMs: 12,
  };

  it('formats jsonl events', () => {
    expect(JSON.parse(new JsonLogFormatter().format(event))).toMatchObject({
      id: 'log-1',
      message: 'Dashboard is visible',
    });
  });

  it('formats compact events', () => {
    expect(new CompactLogFormatter().format(event)).toContain('SUCCESS PASSED assertion login');
  });

  it('formats pretty events without color by default', () => {
    expect(new PrettyLogFormatter().format(event)).toBe('OK assertion login passed: Dashboard is visible 12ms');
  });
});
