import type { AppCapabilityDescriptor } from './AppInstance.js';
import type { RunSession } from './RunSession.js';

export type BiometricChallengeResult = 'match' | 'reject' | 'cancel' | 'lockout' | 'error';
export interface BiometricTestStatus {
  schemaVersion: 1;
  surface: 'app-test-seam';
  generation: string;
  pendingChallenges: string[];
  results: Record<string, BiometricChallengeResult>;
  /** Platform non-match callbacks; the challenge may remain pending. */
  rejections: Record<string, number>;
}
export interface BiometricTestApp {
  listCapabilities(): Promise<AppCapabilityDescriptor[]>;
  invoke(capability: string, method: string, input?: unknown): Promise<unknown>;
}
export interface BiometricTestOptions {
  runSession?: RunSession;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}
export interface BiometricWaitOptions { timeoutMs?: number; signal?: AbortSignal; }
interface Budget { deadline: number; signal: AbortSignal; }

/** Observes app-local biometric callbacks; platform events still require a verified device backend. */
export class BiometricTestController {
  private generation = '';
  private tail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private readonly lifetime = new AbortController();
  private readonly dispatched = new Set<string>();
  private eventOutcomeUnknown = false;

  private constructor(private readonly app: BiometricTestApp, private readonly options: BiometricTestOptions) {}

  static async create(app: BiometricTestApp, options: BiometricTestOptions = {}): Promise<BiometricTestController> {
    for (const value of [options.timeoutMs, options.pollIntervalMs]) if (value !== undefined) validateTimeout(value);
    const controller = new BiometricTestController(app, { ...options });
    await controller.schedule(async budget => {
      const capability = (await controller.bounded(() => app.listCapabilities(), budget)).find(item => item.name === 'biometricTest');
      if (!capability || ['reset', 'getStatus'].some(method => !capability.methods.includes(method))) {
        throw new Error('Register a complete biometricTest observer in the app test entrypoint before requesting biometricTest.');
      }
      const status = await controller.invoke('reset', budget, false);
      controller.generation = status.generation;
      if (status.pendingChallenges.length || Object.keys(status.results).length) throw new Error('Biometric reset did not produce an empty attempt.');
    });
    return controller;
  }

  getStatus(options: BiometricWaitOptions = {}): Promise<BiometricTestStatus> {
    return this.schedule(budget => this.invoke('getStatus', budget), options);
  }

  waitForChallenge(challengeId: string, options: BiometricWaitOptions = {}): Promise<{ challengeId: string }> {
    validateChallengeId(challengeId);
    return this.schedule(async budget => {
      await this.pending(challengeId, budget);
      return { challengeId };
    }, options);
  }

  waitForResult(challengeId: string, options: BiometricWaitOptions = {}): Promise<BiometricChallengeResult> {
    validateChallengeId(challengeId);
    return this.schedule(budget => this.result(challengeId, budget), options);
  }

  /** Dispatch exactly once after pending observation, then assert the app's callback result.
   * Pass the supplied signal and remaining timeout to device.biometrics.match/reject.
   * An acknowledged platform event alone never satisfies this assertion.
   */
  exerciseChallenge<T>(challengeId: string, event: (options: { signal: AbortSignal; timeout: number }) => Promise<T>,
    expected: BiometricChallengeResult, options: BiometricWaitOptions = {}): Promise<{ event: T; result: BiometricChallengeResult }> {
    validateChallengeId(challengeId);
    if (!isResult(expected) || typeof event !== 'function') return Promise.reject(new Error('A biometric event callback and expected result are required.'));
    return this.schedule(async budget => {
      if (this.dispatched.has(challengeId)) throw new Error('A biometric event was already dispatched for this challenge; it cannot be replayed.');
      if (this.eventOutcomeUnknown) throw new Error('A preceding biometric event outcome is unknown; prepare a new attempt.');
      await this.pending(challengeId, budget);
      // Fence retries before entering user/platform work, including synchronous throws.
      this.dispatched.add(challengeId);
      let acknowledgement: T;
      try {
        // Do not hold a RunSession endpoint operation while invoking a device operation.
        acknowledgement = await this.bounded(() => event({ signal: budget.signal, timeout: this.remaining(budget) }), budget);
      } catch (error) { this.eventOutcomeUnknown = true; throw error; }
      let result: BiometricChallengeResult;
      try { result = await this.result(challengeId, budget); }
      catch (error) { this.eventOutcomeUnknown = true; throw error; }
      const assertResult = async () => {
        if (result !== expected) throw new Error(`Biometric challenge '${challengeId}' reported '${result}', expected '${expected}'.`);
      };
      if (this.options.runSession) await this.options.runSession.perform({ kind: 'assertion', title: 'Biometric callback result',
        metadata: this.metadata({ challengeId, expected, result }) }, assertResult);
      else await assertResult();
      return { event: acknowledgement, result };
    }, options);
  }

  /** Observe a new non-match callback without requiring authentication to finish. */
  exerciseRejection<T>(challengeId: string, event: (options: { signal: AbortSignal; timeout: number }) => Promise<T>,
    options: BiometricWaitOptions = {}): Promise<{ event: T; rejectionSequence: number }> {
    validateChallengeId(challengeId);
    if (typeof event !== 'function') return Promise.reject(new Error('A biometric event callback is required.'));
    return this.schedule(async budget => {
      if (this.eventOutcomeUnknown) throw new Error('A preceding biometric event outcome is unknown; prepare a new attempt.');
      const before = await this.pending(challengeId, budget);
      const sequence = before.rejections[challengeId] ?? 0;
      const key = `reject:${challengeId}:${sequence}`;
      if (this.dispatched.has(challengeId) || this.dispatched.has(key)) throw new Error('A biometric event was already dispatched; it cannot be replayed.');
      this.dispatched.add(key);
      let acknowledgement: T;
      try { acknowledgement = await this.bounded(() => event({ signal: budget.signal, timeout: this.remaining(budget) }), budget); }
      catch (error) { this.eventOutcomeUnknown = true; throw error; }
      while (true) {
        let status: BiometricTestStatus;
        try { status = await this.invoke('getStatus', budget); }
        catch (error) { this.eventOutcomeUnknown = true; throw error; }
        if (Object.hasOwn(status.results, challengeId)) {
          throw new Error(`Biometric challenge '${challengeId}' completed with '${status.results[challengeId]}' instead of remaining pending after rejection.`);
        }
        const actual = status.rejections[challengeId] ?? 0;
        if (actual > sequence && status.pendingChallenges.includes(challengeId)) {
          const verify = async () => {};
          if (this.options.runSession) await this.options.runSession.perform({ kind: 'assertion', title: 'Biometric rejection callback',
            metadata: this.metadata({ challengeId, rejectionSequence: actual }) }, verify);
          return { event: acknowledgement, rejectionSequence: actual };
        }
        try { await this.pause(budget); }
        catch (error) { this.eventOutcomeUnknown = true; throw error; }
      }
    }, options);
  }

  /** Invalidates observations even when an unresolved challenge makes cleanup fail.
   * Reset does not dismiss the platform prompt; the owned device lifecycle must stop it.
   */
  dispose(options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.closing) return this.closing;
    this.lifetime.abort(new Error('Biometric test controller is closed.'));
    return this.closing = this.enqueue(async budget => {
      const errors: unknown[] = [];
      if (this.eventOutcomeUnknown) errors.push(new Error('Biometric event completion was not confirmed; the owned device lifecycle must stop its work.'));
      try {
        const status = await this.invoke('getStatus', budget);
        if (status.pendingChallenges.length) errors.push(new Error(`Biometric test has ${status.pendingChallenges.length} unresolved challenge(s).`));
      } catch (error) { errors.push(error); }
      try { await this.invoke('reset', budget, false); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Biometric challenge verification and generation cleanup failed.');
    }, options, true);
  }

  private async pending(id: string, budget: Budget): Promise<BiometricTestStatus> {
    while (true) {
      const status = await this.invoke('getStatus', budget);
      if (Object.hasOwn(status.results, id)) throw new Error(`Biometric challenge '${id}' already completed before event dispatch.`);
      if (status.pendingChallenges.includes(id)) return status;
      await this.pause(budget);
    }
  }

  private async result(id: string, budget: Budget): Promise<BiometricChallengeResult> {
    while (true) {
      const status = await this.invoke('getStatus', budget);
      if (Object.hasOwn(status.results, id)) return status.results[id];
      await this.pause(budget);
    }
  }

  private schedule<T>(work: (budget: Budget) => Promise<T>, options: BiometricWaitOptions = {}): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Biometric test controller is closed.'));
    return this.enqueue(work, options);
  }

  private enqueue<T>(work: (budget: Budget) => Promise<T>, options: BiometricWaitOptions, cleanup = false): Promise<T> {
    const timeout = options.timeoutMs ?? this.options.timeoutMs ?? 5000;
    validateTimeout(timeout);
    const timeoutController = new AbortController();
    const signal = AbortSignal.any([timeoutController.signal, ...(!cleanup ? [this.lifetime.signal] : []),
      ...(!cleanup && this.options.signal ? [this.options.signal] : []), ...(options.signal ? [options.signal] : [])]);
    const budget = { deadline: Date.now() + timeout, signal };
    const timer = setTimeout(() => timeoutController.abort(new Error('Biometric challenge timeout: operation timed out.')), timeout);
    const queued = this.tail.then(() => { signal.throwIfAborted(); return work(budget); });
    this.tail = queued.catch(() => undefined);
    return this.bounded(() => queued, budget).finally(() => {
      clearTimeout(timer);
      timeoutController.abort(new Error('Biometric operation completed.'));
    });
  }

  private async invoke(method: 'reset' | 'getStatus', budget: Budget, sameGeneration = true): Promise<BiometricTestStatus> {
    const read = async () => {
      const status = validateStatus(await this.bounded(() => this.app.invoke('biometricTest', method,
        this.generation ? { generation: this.generation } : {}), budget));
      if (sameGeneration && status.generation !== this.generation) throw new Error('Biometric test generation belongs to a different attempt.');
      return status;
    };
    return this.options.runSession ? this.options.runSession.perform({ kind: 'raw', title: `Biometric test ${method}`,
      metadata: this.metadata() }, read) : read();
  }

  private metadata(extra: Record<string, unknown> = {}) {
    return { surface: 'flutter', coverage: 'app-test-seam', testSeam: 'biometric', generation: this.generation || undefined, ...extra };
  }
  private remaining(budget: Budget): number {
    budget.signal.throwIfAborted();
    const remaining = budget.deadline - Date.now();
    if (remaining <= 0) throw new Error('Biometric challenge timeout: operation timed out.');
    return remaining;
  }
  private async pause(budget: Budget): Promise<void> {
    const duration = Math.min(this.options.pollIntervalMs ?? 100, this.remaining(budget));
    await this.bounded(() => new Promise<void>(resolve => {
      const timer = setTimeout(done, duration);
      function done() { clearTimeout(timer); budget.signal.removeEventListener('abort', done); resolve(); }
      budget.signal.addEventListener('abort', done, { once: true });
    }), budget);
  }
  private async bounded<T>(work: () => Promise<T>, budget: Budget): Promise<T> {
    const timeout = this.remaining(budget);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([Promise.resolve().then(() => { this.remaining(budget); return work(); }), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Biometric challenge timeout: operation timed out.')), timeout);
        abort = () => reject(budget.signal.reason);
        budget.signal.addEventListener('abort', abort, { once: true });
        if (budget.signal.aborted) abort();
      })]);
    } finally { clearTimeout(timer); if (abort) budget.signal.removeEventListener('abort', abort); }
  }
}

const reference = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function validateChallengeId(value: string): void {
  if (typeof value !== 'string' || !reference.test(value)) throw new Error('Biometric challenge ID must be a portable reference.');
}
function validateTimeout(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 600000) throw new Error('Biometric test budgets must be positive integers at most 600000ms.');
}
function isResult(value: unknown): value is BiometricChallengeResult {
  return typeof value === 'string' && ['match', 'reject', 'cancel', 'lockout', 'error'].includes(value);
}
function validateStatus(value: unknown): BiometricTestStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid biometric test status protocol.');
  const status = value as Record<string, unknown>;
  if (Object.keys(status).some(key => !['schemaVersion', 'surface', 'generation', 'pendingChallenges', 'results', 'rejections'].includes(key))
    || status.schemaVersion !== 1 || status.surface !== 'app-test-seam' || typeof status.generation !== 'string' || !status.generation || status.generation.length > 256
    || !Array.isArray(status.pendingChallenges) || !status.results || typeof status.results !== 'object' || Array.isArray(status.results)
    || !status.rejections || typeof status.rejections !== 'object' || Array.isArray(status.rejections)) {
    throw new Error('Invalid biometric test status protocol.');
  }
  const pending = Array.from(status.pendingChallenges);
  const results = Object.entries(status.results);
  const rejections = Object.entries(status.rejections);
  if (pending.length + results.length > 16 || new Set(pending).size !== pending.length
    || pending.some(id => typeof id !== 'string' || !reference.test(id))
    || results.some(([id, result]) => !reference.test(id) || !isResult(result) || pending.includes(id))
    || rejections.length > 16 || rejections.some(([id, count]) => !reference.test(id) || typeof count !== 'number' || !Number.isSafeInteger(count)
      || count < 1 || count > 32 || (!pending.includes(id) && !Object.hasOwn(status.results!, id)))) {
    throw new Error('Invalid biometric test result protocol.');
  }
  return { schemaVersion: 1, surface: 'app-test-seam', generation: status.generation,
    pendingChallenges: pending as string[], results: Object.fromEntries(results) as Record<string, BiometricChallengeResult>,
    rejections: Object.fromEntries(rejections) as Record<string, number> };
}
