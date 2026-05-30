import type { RawInputEvent, RecordedOperation } from './types.js';

const TAP_MAX_DURATION = 500;
const TAP_MAX_DISPLACEMENT = 10;
const TYPE_INPUT_WINDOW = 1000;

export class EventAggregator {
  aggregate(events: RawInputEvent[]): RecordedOperation[] {
    const pointerEvents = events
      .filter((e) => e.type === 'pointerEvent')
      .sort((a, b) => a.timestamp - b.timestamp);
    const textEvents = events
      .filter((e) => e.type === 'textInput')
      .sort((a, b) => a.timestamp - b.timestamp);

    const activePointers = new Map<number, RawInputEvent>();
    const operations: RecordedOperation[] = [];

    for (const event of pointerEvents) {
      const id = event.pointer ?? 0;
      if (event.kind === 'down') {
        activePointers.set(id, event);
        continue;
      }
      if (event.kind !== 'up') continue;

      const down = activePointers.get(id);
      activePointers.delete(id);
      if (!down?.position || !event.position) continue;

      const duration = event.timestamp - down.timestamp;
      const displacement = Math.sqrt(
        (event.position.x - down.position.x) ** 2 +
        (event.position.y - down.position.y) ** 2,
      );

      if (displacement > TAP_MAX_DISPLACEMENT) {
        operations.push({
          kind: 'drag',
          position: { x: down.position.x, y: down.position.y },
          delta: {
            x: Math.round(event.position.x - down.position.x),
            y: Math.round(event.position.y - down.position.y),
          },
          timestamp: down.timestamp,
        });
      } else if (duration >= TAP_MAX_DURATION) {
        operations.push({
          kind: 'longPress',
          position: { x: down.position.x, y: down.position.y },
          duration,
          timestamp: down.timestamp,
        });
      } else {
        operations.push({
          kind: 'tap',
          position: { x: down.position.x, y: down.position.y },
          timestamp: down.timestamp,
        });
      }
    }

    for (const textEvent of textEvents) {
      if (!textEvent.text) continue;
      const opIndex = findEditableOperationForTextInput(operations, textEvent);
      if (opIndex < 0) continue;
      const op = operations[opIndex];
      if (op.kind === 'type') {
        operations[opIndex] = {
          ...op,
          text: `${op.text ?? ''}${textEvent.text}`,
        };
      } else {
        operations[opIndex] = {
          kind: 'type',
          position: op.position,
          text: textEvent.text,
          timestamp: op.timestamp,
        };
      }
    }

    operations.sort((a, b) => a.timestamp - b.timestamp);
    return operations;
  }
}

function findEditableOperationForTextInput(operations: RecordedOperation[], textEvent: RawInputEvent): number {
  for (let i = operations.length - 1; i >= 0; i--) {
    const op = operations[i];
    if (op.kind !== 'tap' && op.kind !== 'type') continue;
    if (textEvent.timestamp < op.timestamp) continue;
    if (textEvent.timestamp > op.timestamp + TYPE_INPUT_WINDOW) continue;
    return i;
  }
  return -1;
}
