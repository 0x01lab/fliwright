import { randomUUID } from 'node:crypto';
import type { ManagedNativeGrant } from '@fliwright/cli/run';
import type { ManagedAppAttemptRequest } from '@fliwright/core';
import { MANAGED_APP_CONTROL_ENV, readManagedAppControl } from '@fliwright/core';
import { isAbsolute } from 'node:path';

/** Identity-only request to the owner retained by the supervisor. Never replay. */
export async function requestNativePreparation(project: string, request: ManagedAppAttemptRequest, signal: AbortSignal): Promise<void> {
  if (!process.connected || !process.send) throw new Error('Native attempt preparation requires a connected Worker supervisor.');
  signal.throwIfAborted();
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); process.removeListener('message', receive); process.removeListener('disconnect', disconnected); signal.removeEventListener('abort', aborted); };
    const cancel = () => {
      try { if (process.connected) process.send?.({ nativePreparationCancel: { id } }, () => {}); } catch { /* Disconnection already fences the request. */ }
    };
    const fail = (error: Error, notify = false) => { cleanup(); if (notify) cancel(); reject(error); };
    const disconnected = () => fail(new Error('Worker supervisor disconnected during native attempt preparation.'));
    const aborted = () => fail(new Error('Native attempt preparation cancelled.'), true);
    const receive = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('nativePreparationReply' in message)) return;
      const reply = message.nativePreparationReply as { id?: unknown; ok?: unknown } | null;
      if (!reply || reply.id !== id) return;
      cleanup();
      if (reply.ok !== true) { reject(new Error('Worker supervisor native preparation failed; start a new managed run.')); return; }
      resolve();
    };
    // The supervisor owns a 120s budget; allow its failure reply to arrive first.
    const timer = setTimeout(() => fail(new Error('Native attempt preparation exceeded its 120 second supervisor budget.'), true), 121000);
    process.on('message', receive); process.once('disconnect', disconnected); signal.addEventListener('abort', aborted, { once: true });
    try { process.send!({ nativePreparation: { id, project, request } }, error => { if (error) disconnected(); }); }
    catch { disconnected(); }
  });
}

/** The executor borrows ownership; the supervisor releases after process verification and reset. */
export async function requestNativeOwnership(project: string, signal: AbortSignal): Promise<ManagedNativeGrant | undefined> {
  if (!process.connected || !process.send) throw new Error('Native device preparation requires a connected Worker supervisor.');
  signal.throwIfAborted();
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); process.removeListener('message', receive); process.removeListener('disconnect', disconnected); signal.removeEventListener('abort', aborted); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const disconnected = () => fail(new Error('Worker supervisor disconnected while preparing native ownership.'));
    const aborted = () => fail(new Error('Native ownership preparation cancelled.'));
    const receive = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('nativeOwnershipReply' in message)) return;
      const reply = message.nativeOwnershipReply as { id?: unknown; ok?: unknown; grant?: ManagedNativeGrant };
      if (reply?.id !== id) return;
      cleanup();
      if (reply.ok !== true) { reject(new Error('Worker supervisor could not acquire native device ownership.')); return; }
      try { resolve(validateGrant(reply.grant)); }
      catch { reject(new Error('Worker supervisor returned an invalid native ownership grant.')); }
    };
    const timer = setTimeout(() => fail(new Error('Native ownership preparation exceeded its 120 second budget.')), 120_000);
    process.on('message', receive); process.once('disconnect', disconnected); signal.addEventListener('abort', aborted, { once: true });
    try { process.send!({ nativeOwnership: { id, project } }, error => { if (error) disconnected(); }); }
    catch { disconnected(); }
  });
}

function validateGrant(grant: ManagedNativeGrant | undefined): ManagedNativeGrant | undefined {
  if (grant === undefined) return;
  if (!grant || typeof grant !== 'object' || Object.keys(grant).some(key => !['delegation', 'managedAppControl'].includes(key))) throw new Error('Invalid grant.');
  const delegation = grant.delegation;
  if (!delegation || typeof delegation !== 'object' || Object.keys(delegation).some(key => !['rootDir', 'key', 'token'].includes(key))
    || typeof delegation.rootDir !== 'string' || !isAbsolute(delegation.rootDir) || delegation.rootDir.includes('\0')
    || !/^[a-f0-9]{64}$/.test(delegation.key) || !/^[a-f0-9]{64}$/.test(delegation.token)) throw new Error('Invalid grant.');
  const managedAppControl = grant.managedAppControl === undefined ? undefined
    : readManagedAppControl({ [MANAGED_APP_CONTROL_ENV]: JSON.stringify(grant.managedAppControl) });
  return { delegation: { ...delegation }, ...(managedAppControl ? { managedAppControl } : {}) };
}
