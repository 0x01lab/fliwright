import type { RawInputEvent, RecordedOperation } from './types.js';

// The bridge clock is in microseconds and positions are Flutter logical pixels.
const LONG_PRESS_DURATION_US = 500_000;
const TAP_MAX_DISPLACEMENT = 10;

export class EventAggregator {
  aggregate(events: RawInputEvent[]): RecordedOperation[] {
    const ordered = [...events].sort((a, b) =>
      a.sequence !== undefined && b.sequence !== undefined
        ? a.sequence - b.sequence
        : a.timestamp - b.timestamp);
    const gestures = collectGestures(ordered);
    const operations: RecordedOperation[] = [];
    let editableIndex: number | undefined;

    for (const event of ordered) {
      if (event.type === 'route') {
        editableIndex = undefined;
      } else if (event.type === 'focus') {
        const current = editableIndex === undefined ? undefined : operations[editableIndex];
        if (!event.focused || (current?.kind === 'type' && current.focusSessionId !== event.focusSessionId)
          || (event.targetId && current?.recordedTarget?.targetId !== event.targetId)) {
          editableIndex = undefined;
        }
      } else if (event.type === 'pointerEvent' && event.kind === 'down') {
        // Every new gesture ends the previous continuous editing segment.
        editableIndex = undefined;
        const operation = gestures.get(event);
        if (operation) {
          operations.push(operation);
          if (operation.kind === 'tap') editableIndex = operations.length - 1;
        }
      } else if (event.type === 'textInput' && event.text !== undefined) {
        const previous = editableIndex === undefined ? undefined : operations[editableIndex];
        const targetId = event.targetId ?? event.target?.targetId;
        const canMerge = previous && targetId && targetId === previous.recordedTarget?.targetId
          && event.focusSessionId && (previous.kind === 'tap' || previous.focusSessionId === event.focusSessionId);
        const operation: RecordedOperation = {
          kind: 'type',
          position: canMerge ? previous.position : { x: 0, y: 0 },
          text: event.sensitive ? '<masked>' : event.text,
          ...(event.sensitive ? { sensitive: true } : {}),
          action: 'replace',
          focusSessionId: event.focusSessionId,
          timestamp: canMerge ? previous.timestamp : event.timestamp,
          recordedTarget: canMerge ? previous.recordedTarget : event.target,
        };
        if (canMerge) {
          operations[editableIndex!] = operation;
        } else {
          operations.push(operation);
          editableIndex = operations.length - 1;
        }
      }
    }
    return operations;
  }
}

/** Pair first, then insert at down order, even if dispatch emits text before up. */
function collectGestures(events: RawInputEvent[]): Map<RawInputEvent, RecordedOperation> {
  const active = new Map<number, RawInputEvent>();
  const gestures = new Map<RawInputEvent, RecordedOperation>();
  for (const event of events) {
    if (event.type !== 'pointerEvent') continue;
    const pointer = event.pointer ?? 0;
    if (event.kind === 'down') {
      active.set(pointer, event);
      continue;
    }
    if (event.kind === 'cancel') {
      active.delete(pointer);
      continue;
    }
    if (event.kind !== 'up') continue;
    const down = active.get(pointer);
    active.delete(pointer);
    if (!down?.position || !event.position) continue;
    const duration = Math.max(0, event.timestamp - down.timestamp);
    const dx = event.position.x - down.position.x;
    const dy = event.position.y - down.position.y;
    const common = { position: { ...down.position }, timestamp: down.timestamp, recordedTarget: down.target };
    if (Math.hypot(dx, dy) > TAP_MAX_DISPLACEMENT) {
      gestures.set(down, {
        ...common, kind: 'drag', delta: { x: Math.round(dx), y: Math.round(dy) },
        duration, durationMs: duration / 1000,
      });
    } else if (duration >= LONG_PRESS_DURATION_US) {
      gestures.set(down, { ...common, kind: 'longPress', duration, durationMs: duration / 1000 });
    } else {
      gestures.set(down, { ...common, kind: 'tap' });
    }
  }
  return gestures;
}
