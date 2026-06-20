import { describe, expect, it } from 'vitest';
import {
  CompactLogFormatter,
  JsonLogFormatter,
  MemoryLogSink,
  PrettyLogFormatter,
  StructuredLogger,
} from '../src/index.js';

describe('StructuredLogger', () => {
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
