import { describe, it, expect } from 'vitest';
import { EventAggregator } from '../src/EventAggregator.js';
import type { RawInputEvent } from '../src/types.js';

// Timestamps are in microseconds (matching Dart's event.timeStamp.inMicroseconds).
const US = 1000;        // 1ms = 1000µs
const MS = 1000_000;    // 1s  = 1,000,000µs

describe('EventAggregator', () => {
  it('uses target instance identity instead of the inspector id for focused input', () => {
    const target = { targetId: 'target-1', id: 'element-hash-123', status: 'resolved' as const,
      type: 'TextField', candidates: [] };
    const operations = new EventAggregator().aggregate([
      { type: 'pointerEvent', kind: 'down', pointer: 1, position: { x: 10, y: 20 }, timestamp: 100, target },
      { type: 'pointerEvent', kind: 'up', pointer: 1, position: { x: 10, y: 20 }, timestamp: 200 },
      { type: 'textInput', text: 'value', action: 'replace', targetId: 'target-1', target,
        focusSessionId: 'focus-1', timestamp: 300 },
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: 'type', text: 'value', position: { x: 10, y: 20 } });
  });
  it('returns empty array for no events', () => {
    const agg = new EventAggregator();
    expect(agg.aggregate([])).toEqual([]);
  });

  it('recognizes a tap (down + up, short duration, small displacement)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100 * US, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('tap');
    expect(ops[0].position).toEqual({ x: 100, y: 200 });
  });

  it('recognizes a long press (down + up, long duration)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 2000 * US, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('longPress');
    expect(ops[0].duration).toBe(1000 * US);
  });

  it('recognizes a drag (down + moves + up, large displacement)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 150, y: 250 }, timestamp: 1050 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 200, y: 300 }, timestamp: 1100 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 200, y: 300 }, timestamp: 1200 * US, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('drag');
    expect(ops[0].delta).toEqual({ x: 100, y: 100 });
  });

  it('recognizes a type operation for the tapped input identity', () => {
    const ops = new EventAggregator().aggregate([...tap(1, 'field'), edit(3, 'hello')]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'type', text: 'hello', position: { x: 10, y: 20 }, action: 'replace' });
  });

  it('recognizes multiple taps as separate operations', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100 * US, buttons: 0 },
      { type: 'pointerEvent', kind: 'down', pointer: 1, position: { x: 300, y: 400 }, timestamp: 2000 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 1, position: { x: 300, y: 400 }, timestamp: 2100 * US, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(2);
    expect(ops[0].kind).toBe('tap');
    expect(ops[1].kind).toBe('tap');
    expect(ops[1].position).toEqual({ x: 300, y: 400 });
  });

  it('recognizes repeated gestures on the same pointer id', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100 * US, buttons: 0 },
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 300, y: 400 }, timestamp: 2000 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 300, y: 400 }, timestamp: 2100 * US, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(2);
    expect(ops[0].position).toEqual({ x: 100, y: 200 });
    expect(ops[1].position).toEqual({ x: 300, y: 400 });
  });

  it('associates text with the matching input rather than an earlier tap', () => {
    const ops = new EventAggregator().aggregate([
      ...tap(1, 'other'), ...tap(3, 'field'), edit(5, 'hello'),
    ]);
    expect(ops).toHaveLength(2);
    expect(ops[0].kind).toBe('tap');
    expect(ops[1]).toMatchObject({ kind: 'type', text: 'hello', recordedTarget: { targetId: 'field' } });
  });

  it('coalesces committed final values after one tap', () => {
    const ops = new EventAggregator().aggregate([...tap(1, 'field'), edit(3, 'he'), edit(4, 'hello')]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ text: 'hello', action: 'replace' });
  });

  it('handles standalone text input without preceding tap', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'textInput', text: 'hello', timestamp: 5000 * US },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('type');
    expect(ops[0].text).toBe('hello');
    expect(ops[0].position).toEqual({ x: 0, y: 0 });
  });

  it('preserves final replacement after deletion', () => {
    const ops = new EventAggregator().aggregate([...tap(1, 'field'), edit(3, 'abc'), edit(4, 'ab')]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'type', text: 'ab', action: 'replace' });
  });

  it('ignores move events without displacement', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1050 * US, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100 * US, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('tap');
  });
});

const field = (id = 'field') => ({ targetId: id, status: 'resolved' as const, type: 'TextField', candidates: [] });
const edit = (sequence: number, text: string, overrides: Partial<RawInputEvent> = {}): RawInputEvent => ({
  type: 'textInput', sequence, timestamp: sequence * US, text,
  targetId: 'field', target: field(), focusSessionId: 'editing-1', action: 'replace', ...overrides,
});
const tap = (sequence: number, targetId: string): RawInputEvent[] => [
  { type: 'pointerEvent', sequence, timestamp: sequence * US, kind: 'down', pointer: 1,
    position: { x: 10, y: 20 }, targetId, target: field(targetId) },
  { type: 'pointerEvent', sequence: sequence + 1, timestamp: (sequence + 1) * US, kind: 'up', pointer: 1,
    position: { x: 10, y: 20 } },
];

describe('focused final-value aggregation', () => {
  it('coalesces a continuous edit beyond one second and keeps a final clear', () => {
    const operations = new EventAggregator().aggregate([
      ...tap(1, 'field'), edit(3, 'first'), edit(4, 'pasted value', { timestamp: 8 * MS }),
      edit(5, '', { timestamp: 12 * MS }),
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: 'type', text: '', action: 'replace', focusSessionId: 'editing-1' });
  });

  it('uses sequence for input and submit order even if timestamps disagree', () => {
    const events = [
      edit(1, 'before', { timestamp: 10 * MS }),
      ...tap(2, 'submit'),
      edit(4, 'after', { timestamp: 0 }),
    ];
    const operations = new EventAggregator().aggregate([events[3], events[2], events[0], events[1]]);
    expect(operations.map((op) => [op.kind, op.text])).toEqual([
      ['type', 'before'], ['tap', undefined], ['type', 'after'],
    ]);
  });

  it.each([
    { type: 'route' as const, route: '/next' },
    { type: 'focus' as const, focused: false, focusSessionId: 'editing-1' },
    { type: 'focus' as const, focused: true, focusSessionId: 'editing-2' },
  ])('does not merge input across $type boundary', (boundary) => {
    const operations = new EventAggregator().aggregate([
      edit(1, 'before'), { ...boundary, sequence: 2, timestamp: 2 * US }, edit(3, 'after'),
    ]);
    expect(operations.map((op) => op.text)).toEqual(['before', 'after']);
  });

  it('does not guess a tap target from timing when input identity is missing', () => {
    const operations = new EventAggregator().aggregate([
      ...tap(1, 'submit'), { type: 'textInput', text: 'unresolved', sequence: 3, timestamp: 3 * US },
    ]);
    expect(operations.map((op) => op.kind)).toEqual(['tap', 'type']);
    expect(operations[1].recordedTarget).toBeUndefined();
  });

  it('treats every text event as a final value rather than an append chunk', () => {
    const operations = new EventAggregator().aggregate([
      edit(1, 'he', { action: undefined }), edit(2, 'hello', { action: undefined }),
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ text: 'hello', action: 'replace' });
  });

  it('keeps a sensitive final value masked and preserves a subsequent clear', () => {
    const operations = new EventAggregator().aggregate([
      edit(1, '<masked>', { sensitive: true }), edit(2, '<masked>', { sensitive: true }),
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ text: '<masked>', sensitive: true, action: 'replace' });
    const cleared = new EventAggregator().aggregate([
      edit(1, '<masked>', { sensitive: true }), edit(2, ''),
    ]);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ text: '', action: 'replace' });
    expect(cleared[0].sensitive).not.toBe(true);
  });

  it('does not complete a cancelled pointer as a tap', () => {
    const events = tap(1, 'field');
    const operations = new EventAggregator().aggregate([
      events[0], { ...events[1], kind: 'cancel' }, { ...events[1], sequence: 3 },
    ]);
    expect(operations).toEqual([]);
  });
});
