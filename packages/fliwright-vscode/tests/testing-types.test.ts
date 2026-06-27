import { describe, expect, it } from 'vitest';
import { testNodeId, aggregateStatus } from '../src/testing/types.js';

describe('testing node utils', () => {
  it('builds ids from ancestor chain', () => {
    expect(testNodeId('tests/a.test.ts', ['suite'], 'case')).toBe('tests/a.test.ts::suite/case');
  });
  it('aggregates: any failed -> failed', () => {
    expect(aggregateStatus(['passed', 'failed'])).toBe('failed');
  });
  it('aggregates: no failed, some passed -> passed', () => {
    expect(aggregateStatus(['unknown', 'passed'])).toBe('passed');
  });
  it('aggregates: all unknown -> unknown', () => {
    expect(aggregateStatus(['unknown'])).toBe('unknown');
  });
  it('aggregates: running overrides stored results', () => {
    expect(aggregateStatus(['passed', 'running', 'failed'])).toBe('running');
  });
});
