import { describe, it, expect } from 'vitest';
import { EventAggregator } from '../src/EventAggregator.js';
import type { RawInputEvent } from '../src/types.js';

describe('EventAggregator', () => {
  it('returns empty array for no events', () => {
    const agg = new EventAggregator();
    expect(agg.aggregate([])).toEqual([]);
  });

  it('recognizes a tap (down + up, short duration, small displacement)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('tap');
    expect(ops[0].position).toEqual({ x: 100, y: 200 });
  });

  it('recognizes a long press (down + up, long duration)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 2000, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('longPress');
    expect(ops[0].duration).toBe(1000);
  });

  it('recognizes a drag (down + moves + up, large displacement)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 150, y: 250 }, timestamp: 1050, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 200, y: 300 }, timestamp: 1100, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 200, y: 300 }, timestamp: 1200, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('drag');
    expect(ops[0].delta).toEqual({ x: 100, y: 100 });
  });

  it('recognizes a type operation (tap followed by textInput)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
      { type: 'textInput', text: 'hello', timestamp: 1500 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('type');
    expect(ops[0].text).toBe('hello');
    expect(ops[0].position).toEqual({ x: 100, y: 200 });
  });

  it('recognizes multiple taps as separate operations', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
      { type: 'pointerEvent', kind: 'down', pointer: 1, position: { x: 300, y: 400 }, timestamp: 2000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 1, position: { x: 300, y: 400 }, timestamp: 2100, buttons: 0 },
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
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 300, y: 400 }, timestamp: 2000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 300, y: 400 }, timestamp: 2100, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(2);
    expect(ops[0].position).toEqual({ x: 100, y: 200 });
    expect(ops[1].position).toEqual({ x: 300, y: 400 });
  });

  it('associates text input with only the nearest preceding tap', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
      { type: 'pointerEvent', kind: 'down', pointer: 1, position: { x: 300, y: 400 }, timestamp: 1300, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 1, position: { x: 300, y: 400 }, timestamp: 1400, buttons: 0 },
      { type: 'textInput', text: 'hello', timestamp: 1500 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(2);
    expect(ops[0].kind).toBe('tap');
    expect(ops[1]).toMatchObject({ kind: 'type', text: 'hello', position: { x: 300, y: 400 } });
  });

  it('coalesces multiple text input chunks after one tap', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
      { type: 'textInput', text: 'he', timestamp: 1200 },
      { type: 'textInput', text: 'llo', timestamp: 1300 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toEqual([
      { kind: 'type', position: { x: 100, y: 200 }, text: 'hello', timestamp: 1000 },
    ]);
  });

  it('ignores move events without displacement', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1050, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('tap');
  });
});
