import type { CodegenOptions, ResolvedSelector } from './types.js';
import type { RecorderStartOptions, RecordingResult } from './RecorderController.js';

export interface RecordingCaptureRecorder {
  start(options?: RecorderStartOptions): Promise<void>;
  stop(options?: CodegenOptions): Promise<RecordingResult>;
  getSelectors(): ReadonlyMap<number, ResolvedSelector>;
  getArtifactDirectory(): string | undefined;
}

/** A connection owned by the capture. Borrowed IDE connections supply a no-op dispose. */
export interface RecordingCaptureResource {
  recorder: RecordingCaptureRecorder;
  /** Cleanup receives cancellation when the capture's disposal budget expires. */
  dispose(options?: { signal?: AbortSignal }): Promise<void>;
}

export interface RecordingCaptureOptions {
  open(): Promise<RecordingCaptureResource>;
  start?: RecorderStartOptions;
  generate?: CodegenOptions;
  signal?: AbortSignal;
  durationMs?: number;
  /** The adapter owns and removes any platform signal listener in this callback. */
  waitForStop?: (signal: AbortSignal) => Promise<void>;
  cleanupTimeoutMs?: number;
}

export interface RecordingCaptureResult {
  /** Local runtime base for relative evidence references; never serialize into the capture. */
  artifactDirectory?: string;
  recording: RecordingResult;
  selectors: ReadonlyMap<number, ResolvedSelector>;
  stopReason: 'duration' | 'requested' | 'cancelled';
}

/** Own start → wait/cancel → stop/flush → dispose for CLI and editor captures. */
export async function captureRecording(options: RecordingCaptureOptions): Promise<RecordingCaptureResult> {
  if (options.signal?.aborted) throw new Error('Recording cancelled.');
  if (!options.waitForStop && options.durationMs === undefined) {
    throw new Error('Recording requires a duration or an explicit stop source.');
  }
  if (options.durationMs !== undefined && (!Number.isFinite(options.durationMs) || options.durationMs < 0)) {
    throw new Error('Recording duration must be a finite, nonnegative number.');
  }
  const connection = await options.open();
  const budget = options.cleanupTimeoutMs ?? 5000;
  let stop: Promise<RecordingResult> | undefined;
  let captured: RecordingCaptureResult | undefined;
  const stopOnce = () => stop ??= withTimeout(
    Promise.resolve().then(() => connection.recorder.stop(options.generate)),
    budget,
    'Recording stop',
  );
  try {
    await withTimeout(connection.recorder.start(options.start), budget, 'Recording start');
    const stopReason = await waitForStop(options);
    const recording = await stopOnce();
    captured = {
      artifactDirectory: connection.recorder.getArtifactDirectory(),
      recording: stopReason === 'cancelled'
        ? { ...recording, status: recording.status === 'failed' ? 'failed' : 'partial', issues: [...recording.issues, 'Recording cancelled.'] }
        : recording,
      selectors: new Map(connection.recorder.getSelectors()),
      stopReason,
    };
    return captured;
  } finally {
    // A start/wait error is still the caller's error even if cleanup also fails.
    try { await stopOnce(); } catch { /* The original error remains authoritative. */ }
    try {
      const disposal = new AbortController();
      await withTimeout(
        Promise.resolve().then(() => connection.dispose({ signal: disposal.signal })),
        budget,
        'Recording disposal',
        disposal,
      );
    } catch (error) {
      if (captured) {
        captured.recording = {
          ...captured.recording,
          status: captured.recording.status === 'failed' ? 'failed' : 'partial',
          issues: [...captured.recording.issues, error instanceof Error ? error.message : String(error)],
        };
      }
    }
  }
}

/** Open a dedicated driver; always close it after capture, including connect failure. */
export async function openRecordingCapture(vmServiceUrl: string): Promise<RecordingCaptureResource> {
  const { FliwrightDriver } = await import('./Driver.js');
  const driver = new FliwrightDriver();
  try {
    await driver.connect(vmServiceUrl);
    return { recorder: driver.recorder, dispose: (options) => driver.dispose(options) };
  } catch (error) {
    try { await driver.dispose(); } catch { /* Keep the connect error. */ }
    throw error;
  }
}

function waitForStop(options: RecordingCaptureOptions): Promise<RecordingCaptureResult['stopReason']> {
  if (options.signal?.aborted) return Promise.resolve('cancelled');
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waiter = new AbortController();
    const finish = (reason: RecordingCaptureResult['stopReason'], error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      waiter.abort();
      if (error !== undefined) reject(error);
      else resolve(reason);
    };
    const onAbort = () => finish('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.durationMs !== undefined) timer = setTimeout(() => finish('duration'), options.durationMs);
    if (options.waitForStop) {
      Promise.resolve().then(() => options.waitForStop!(waiter.signal))
        .then(() => finish('requested'), (error: unknown) => finish('requested', error));
    }
  });
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, title: string, cancellation?: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${title} timed out after ${timeoutMs}ms.`);
          cancellation?.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
