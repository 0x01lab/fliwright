import type { RawInputEvent, RecordedOperation } from './types.js';

const TAP_MAX_DURATION = 500;
const TAP_MAX_DISPLACEMENT = 10;
const TYPE_INPUT_WINDOW = 1000;

export class EventAggregator {
  aggregate(events: RawInputEvent[]): RecordedOperation[] {
    const pointerEvents = events.filter((e) => e.type === 'pointerEvent');
    const textEvents = events.filter((e) => e.type === 'textInput');

    const groups = new Map<number, RawInputEvent[]>();
    for (const event of pointerEvents) {
      const id = event.pointer ?? 0;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(event);
    }

    const operations: RecordedOperation[] = [];

    for (const [, group] of groups) {
      const down = group.find((e) => e.kind === 'down');
      const up = group.find((e) => e.kind === 'up');
      if (!down || !up || !down.position || !up.position) continue;

      const duration = up.timestamp - down.timestamp;
      const displacement = Math.sqrt(
        (up.position.x - down.position.x) ** 2 +
        (up.position.y - down.position.y) ** 2,
      );

      if (displacement > TAP_MAX_DISPLACEMENT) {
        operations.push({
          kind: 'drag',
          position: { x: down.position.x, y: down.position.y },
          delta: {
            x: Math.round(up.position.x - down.position.x),
            y: Math.round(up.position.y - down.position.y),
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
        const pos = { x: down.position.x, y: down.position.y };
        const textEvent = textEvents.find(
          (te) => te.timestamp >= down.timestamp && te.timestamp <= down.timestamp + TYPE_INPUT_WINDOW,
        );

        if (textEvent && textEvent.text) {
          operations.push({
            kind: 'type',
            position: pos,
            text: textEvent.text,
            timestamp: down.timestamp,
          });
        } else {
          operations.push({
            kind: 'tap',
            position: pos,
            timestamp: down.timestamp,
          });
        }
      }
    }

    operations.sort((a, b) => a.timestamp - b.timestamp);
    return operations;
  }
}
