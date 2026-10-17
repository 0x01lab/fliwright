import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingEventStore } from '../src/RecordingEventStore.js';
import { EventAggregator } from '../src/EventAggregator.js';
import type { RawInputEvent } from '../src/types.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function store(options: { maxBufferedEvents?: number; maxBufferedBytes?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'recording-event-store-test-'));
  directories.push(directory);
  return new RecordingEventStore({ directory, ...options });
}
const target = { targetId: 'field', status: 'resolved' as const, candidates: [] };
function event(sequence: number, fields: Partial<RawInputEvent>): RawInputEvent {
  return { type: 'pointerEvent', timestamp: sequence * 1000, sequence, ...fields };
}
const down = (sequence: number): RawInputEvent => event(sequence, { kind: 'down', pointer: 1, position: { x: 10, y: 20 }, target });
const up = (sequence: number): RawInputEvent => event(sequence, { kind: 'up', pointer: 1, position: { x: 10, y: 20 } });
const text = (sequence: number, value: string): RawInputEvent => event(sequence, {
  type: 'textInput', targetId: 'field', target, focusSessionId: 'focus-1', text: value, action: 'replace',
});

describe('recording event archive and aggregation window', () => {
  it('archives 1000 complete gestures without retaining their raw payloads', () => {
    const recorder = store({ maxBufferedEvents: 8, maxBufferedBytes: 4096 });
    for (let index = 0; index < 1000; index++) {
      recorder.append(down(index * 2 + 1));
      recorder.append(up(index * 2 + 2));
    }
    expect(recorder.getOperations()).toHaveLength(1000);
    expect(recorder.stats()).toMatchObject({ eventCount: 2000, archivedEvents: 2000 });
    expect(recorder.stats().peakBufferedEvents).toBeLessThanOrEqual(8);
    expect(recorder.stats().peakBufferedBytes).toBeLessThanOrEqual(4096);
    const archived = readFileSync(recorder.path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(archived.map((entry) => entry.sequence)).toEqual(Array.from({ length: 2000 }, (_, index) => index + 1));
    expect(recorder.issues).toEqual([]);
  });

  it('compacts long continuous editing while archiving every value including clear', () => {
    const recorder = store({ maxBufferedEvents: 6, maxBufferedBytes: 2048 });
    recorder.append(down(1)); recorder.append(up(2));
    for (let sequence = 3; sequence <= 2000; sequence++) recorder.append(text(sequence, `edit-${sequence}`));
    recorder.append(text(2001, ''));
    expect(recorder.getOperations()).toEqual([expect.objectContaining({ kind: 'type', text: '', position: { x: 10, y: 20 } })]);
    expect(recorder.stats().peakBufferedEvents).toBeLessThanOrEqual(6);
    expect(recorder.stats().peakBufferedBytes).toBeLessThanOrEqual(2048);
    expect(recorder.readEvents()).toHaveLength(2001);
    expect(recorder.issues).toEqual([]);
  });

  it('preserves text-before-up, moves, focus boundaries and submit order', () => {
    const recorder = store();
    const events = [down(1), text(2, 'initial'), up(3), text(4, ''),
      event(5, { type: 'focus', focused: false, focusSessionId: 'focus-1' }),
      text(6, 'new segment'), event(7, { type: 'route', route: '/next' }),
      down(8), event(9, { kind: 'move', pointer: 1, position: { x: 20, y: 30 } }),
      event(10, { kind: 'up', pointer: 1, position: { x: 40, y: 60 } }), text(11, 'after drag')];
    for (const entry of events) recorder.append(entry);
    expect(recorder.getOperations()).toEqual(new EventAggregator().aggregate(events));
    expect(recorder.readEvents()).toEqual(events);
  });

  it('keeps cancelled pointers and multiple pointer ordering equivalent to batch aggregation', () => {
    const recorder = store();
    const events = [down(1), { ...down(2), pointer: 2 }, text(3, 'during multitouch'),
      { ...up(4), pointer: 2 }, event(5, { kind: 'cancel', pointer: 1 }), down(6), up(7)];
    for (const entry of events) recorder.append(entry);
    expect(recorder.getOperations()).toEqual(new EventAggregator().aggregate(events));
    expect(recorder.unsupportedGestures).toEqual(['multi-pointer gesture']);
  });

  it('matches batch semantics across deterministic mixed input and gesture segments', () => {
    const recorder = store();
    const events: RawInputEvent[] = [];
    const emit = (fields: Partial<RawInputEvent>) => events.push(event(events.length + 1, fields));
    for (let index = 0; index < 200; index++) {
      const field = { ...target, targetId: `field-${index % 3}` };
      const focusSessionId = `focus-${index}`;
      emit({ kind: 'down', pointer: 1, position: { x: index, y: 20 }, target: field });
      if (index % 2 === 0) emit({ type: 'textInput', text: 'before up', target: field, targetId: field.targetId, focusSessionId });
      emit({ kind: 'up', pointer: 1, position: { x: index + (index % 5 === 0 ? 30 : 0), y: 20 } });
      emit({ type: 'focus', focused: true, targetId: field.targetId, focusSessionId });
      emit({ type: 'textInput', text: 'value', target: field, targetId: field.targetId, focusSessionId });
      emit({ type: 'textInput', text: '', target: field, targetId: field.targetId, focusSessionId });
      if (index % 3 === 0) emit({ type: 'route', route: `/route-${index}` });
      if (index % 4 === 0) emit({ type: 'focus', focused: false, focusSessionId });
    }
    for (const entry of events) recorder.append(entry);
    expect(recorder.getOperations()).toEqual(new EventAggregator().aggregate(events));
    expect(recorder.issues).toEqual([]);
  });

  it('reports initialization failure without preventing valid operation aggregation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'recording-event-store-test-'));
    directories.push(directory);
    const blocked = join(directory, 'file');
    writeFileSync(blocked, 'occupied');
    const recorder = new RecordingEventStore({ directory: blocked });
    recorder.append(down(1)); recorder.append(up(2));
    expect(recorder.getOperations()).toHaveLength(1);
    expect(recorder.issues.join(' ')).toMatch(/archive initialization failed/i);
    expect(recorder.stats()).toMatchObject({ eventCount: 2, archivedEvents: 0 });
  });

  it('reports window exhaustion while preserving the complete archive and completed operations', () => {
    const recorder = store({ maxBufferedEvents: 4, maxBufferedBytes: 4096 });
    const events = [down(1), ...Array.from({ length: 8 }, (_, index) => event(index + 2, {
      type: 'route', route: `/page-${index}`,
    })), up(10), down(11), up(12)];
    for (const entry of events) recorder.append(entry);
    expect(recorder.stats().peakBufferedEvents).toBeLessThanOrEqual(4);
    expect(recorder.issues.join(' ')).toMatch(/buffer.*budget/i);
    expect(recorder.readEvents()).toEqual(events);
    expect(recorder.getOperations().at(-1)).toMatchObject({ kind: 'tap', timestamp: 11000 });
  });

  it('retains business operations and reports archive write failure without retaining failed raw events', () => {
    const recorder = store({ maxBufferedEvents: 4 });
    recorder.append(down(1)); recorder.append(up(2));
    rmSync(recorder.path); // Make the next append fail deterministically.
    writeFileSync(join(recorder.path, '..', 'unrelated.txt'), 'unchanged');
    // An existing directory at the file path fails on every supported platform.
    mkdirSync(recorder.path);
    recorder.append(down(3)); recorder.append(up(4));
    expect(recorder.getOperations()).toHaveLength(2);
    expect(recorder.issues.join(' ')).toMatch(/archive/i);
    expect(recorder.stats()).toMatchObject({ eventCount: 4, archivedEvents: 2 });
  });
});
