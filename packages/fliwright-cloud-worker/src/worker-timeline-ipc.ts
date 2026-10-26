import { randomUUID } from 'node:crypto';
import { workerTimelinePayloadSchema, workerRecordingIssueSchema, type WorkerTimelinePayload } from '@fliwright/cloud-protocol';
import type { ChildProcess } from 'node:child_process';
import type { WorkerTimelineRecorder } from './WorkerTimelineRecorder.js';
import { WorkerTimelineChannel } from './WorkerTimelineChannel.js';

/** Supervisor ingress shared by executor and reset children. */
export function recordWorkerTimelineMessage(child: ChildProcess, message: unknown, recording?: WorkerTimelineRecorder, source = 'executor') {
  if (!message || typeof message !== 'object') return;
  if ('timelineIssue' in message) {
    const issue = workerRecordingIssueSchema.safeParse(message.timelineIssue);
    if (issue.success) recording?.issue(issue.data);
  }
  if (!('timeline' in message) || !message.timeline || typeof message.timeline !== 'object') return;
  const value = message.timeline as { id?: unknown; payload?: unknown };
  if (typeof value.id !== 'string' || value.id.length > 100) return;
  const parsed = workerTimelinePayloadSchema.safeParse(value.payload);
  const recorded = parsed.success && !!recording?.record(parsed.data, source);
  try { if (child.connected) child.send({ timelineAck: value.id, recorded }, () => {}); } catch { /* Child disconnected after durable write. */ }
}

/** Each operation waits for the supervisor's durable ACK, with bounded degradation. */
export function executorTimeline() {
  const pending = new Map<string, { finish: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  const listener = (message: unknown) => {
    if (!message || typeof message !== 'object' || !('timelineAck' in message) || typeof message.timelineAck !== 'string') return;
    const entry = pending.get(message.timelineAck);
    if (entry) { clearTimeout(entry.timer); pending.delete(message.timelineAck); entry.finish('recorded' in message && message.recorded === true); }
  };
  process.on('message', listener);
  const channel = new WorkerTimelineChannel((payload: WorkerTimelinePayload) => new Promise<boolean>(resolve => {
    if (!process.connected || !process.send) { resolve(false); return; }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      if (process.connected) {
        try { process.send?.({ timelineIssue: 'ipc_timeout' }, () => {}); } catch { /* IPC may close between the check and send. */ }
      }
      resolve(false);
    }, 2000);
    pending.set(id, { finish: resolve, timer });
    try { process.send({ timeline: { id, payload } }, error => {
      if (error) { clearTimeout(timer); pending.delete(id); resolve(false); }
    }); } catch { clearTimeout(timer); pending.delete(id); resolve(false); }
  }));
  return { channel, dispose() {
    process.removeListener('message', listener);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.finish(false); }
    pending.clear();
  } };
}
