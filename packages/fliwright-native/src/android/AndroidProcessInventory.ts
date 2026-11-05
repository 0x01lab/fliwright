import { NativeError } from '@fliwright/core';

export interface AndroidProcess { uid: number; pid: number; name: string; }

/** Decode the numeric ps inventory before proving UID exit or binding a running app. */
export function parseAndroidProcessInventory(output: string): AndroidProcess[] {
  if (Buffer.byteLength(output) > 1024 * 1024) throw invalid();
  const lines = output.trim().split('\n');
  if (!/^[ \t]*UID[ \t]+PID[ \t]+NAME[ \t\r]*$/.test(lines.shift() ?? '')) throw invalid();
  const seen = new Set<number>();
  const processes = lines.map(line => {
    const match = /^[ \t]*(\d+)[ \t]+([1-9]\d*)[ \t]+([^\s\x00-\x1f\x7f]+)[ \t\r]*$/.exec(line);
    if (!match) throw invalid();
    const uid = Number(match[1]), pid = Number(match[2]);
    if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(pid) || seen.has(pid)) throw invalid();
    seen.add(pid);
    return { uid, pid, name: match[3] };
  });
  if (!processes.some(item => item.uid === 0 && item.pid === 1)) throw invalid();
  return processes;
}

function invalid(): NativeError {
  return new NativeError('protocol_mismatch', 'Android process inventory must contain valid numeric UID/PID/name records, unique PIDs and the root init process.');
}
