import { resolve } from 'node:path';
import type { ManagedAppAttemptRequest } from '@fliwright/core';

/** One supervised executor channel; accepts identities only, never platform commands. */
export class NativePreparationIpc {
  private readonly lifetime = new AbortController();
  private readonly seen = new Set<string>();
  private active?: { id: string; controller: AbortController };
  private unusable = false;
  constructor(private readonly options: {
    project: string;
    signal?: AbortSignal;
    prepare?: (project: string, request: ManagedAppAttemptRequest, signal: AbortSignal) => Promise<void>;
    send(message: { nativePreparationReply: { id: string; ok: boolean } }): void;
  }) {}

  handle(message: unknown): boolean {
    if (!isObject(message)) return false;
    if ('nativePreparationCancel' in message) {
      const cancellation = message.nativePreparationCancel;
      if (this.active && isObject(cancellation) && Object.keys(cancellation).length === 1 && cancellation.id === this.active.id) {
        this.unusable = true;
        this.active?.controller.abort(new Error('Executor cancelled native preparation.'));
      }
      return true;
    }
    if (!('nativePreparation' in message)) return false;
    const input = message.nativePreparation;
    if (!isObject(input) || typeof input.id !== 'string' || !input.id || input.id.length > 100) return true;
    const id = input.id;
    if (this.unusable || this.active || this.lifetime.signal.aborted || this.options.signal?.aborted
      || this.seen.has(id) || this.seen.size >= 10000 || !this.options.prepare
      || Object.keys(input).some(key => !['id', 'project', 'request'].includes(key))
      || typeof input.project !== 'string' || resolve(input.project) !== resolve(this.options.project) || !validRequest(input.request)) {
      this.reply(id, false); return true;
    }
    this.seen.add(id);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal, ...(this.options.signal ? [this.options.signal] : [])]);
    const state = { id, controller }; this.active = state;
    const timeout = setTimeout(() => controller.abort(new Error('Native preparation exceeded its 120 second budget.')), 120000);
    // Active ownership survives an early cancellation reply until underlying work settles.
    const work = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      await this.options.prepare!(input.project as string, input.request as unknown as ManagedAppAttemptRequest, signal);
      signal.throwIfAborted();
    });
    void work.then(() => { if (this.active === state) this.active = undefined; }, () => { if (this.active === state) this.active = undefined; });
    let abort: (() => void) | undefined;
    void (async () => {
      try {
        await Promise.race([work, new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        })]);
        this.reply(id, true);
      } catch { this.unusable = true; this.reply(id, false); }
      finally { clearTimeout(timeout); if (abort) signal.removeEventListener('abort', abort); }
    })();
    return true;
  }

  dispose(): void { this.unusable = true; this.lifetime.abort(new Error('Executor native preparation channel closed.')); }
  private reply(id: string, ok: boolean): void {
    try { this.options.send({ nativePreparationReply: { id, ok } }); } catch { this.dispose(); }
  }
}

function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validRequest(value: unknown): boolean {
  if (!isObject(value) || Object.keys(value).some(key => !['attemptKey', 'scenarioName', 'scenarioFingerprint'].includes(key))
    || typeof value.attemptKey !== 'string' || !value.attemptKey || value.attemptKey.length > 512) return false;
  return (value.scenarioName === undefined && value.scenarioFingerprint === undefined)
    || (typeof value.scenarioName === 'string' && value.scenarioName.length > 0 && value.scenarioName.length <= 256
      && typeof value.scenarioFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.scenarioFingerprint));
}
