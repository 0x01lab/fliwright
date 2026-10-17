export type EvidenceChannel = 'screenshot' | 'snapshot' | 'diagnostics';
export type EvidenceChannelStatus = 'captured' | 'unavailable' | 'timeout' | 'disabled';

export interface EvidenceCaptureSources {
  screenshot?: () => Promise<unknown>;
  snapshot?: () => Promise<unknown>;
  diagnostics?: () => Promise<unknown>;
}

export interface EvidenceChannelResult {
  status: EvidenceChannelStatus;
  value?: unknown;
  error?: unknown;
}

export interface EvidenceCaptureResult {
  failureId: string;
  status: 'complete' | 'partial' | 'disabled';
  channels: Record<EvidenceChannel, EvidenceChannelResult>;
}

export interface EvidenceCaptureOptions {
  channelTimeoutMs?: number;
  totalBudgetMs?: number;
}

export class EvidenceCapture {
  private readonly captured = new Map<string, Promise<EvidenceCaptureResult>>();
  private readonly channelTimeoutMs: number;
  private readonly totalBudgetMs: number;

  constructor(options: EvidenceCaptureOptions = {}) {
    this.channelTimeoutMs = options.channelTimeoutMs ?? 1000;
    this.totalBudgetMs = options.totalBudgetMs ?? 3000;
  }

  async capture(failureId: string, sources: EvidenceCaptureSources, options: { signal?: AbortSignal } = {}): Promise<EvidenceCaptureResult> {
    const existing = this.captured.get(failureId);
    if (existing) return existing;
    // Cache the in-flight result as well as the completed one. All consumers
    // see the same channel errors and never manufacture complete evidence.
    const result = this.captureOnce(failureId, sources, options.signal);
    this.captured.set(failureId, result);
    return result;
  }

  private async captureOnce(failureId: string, sources: EvidenceCaptureSources, signal?: AbortSignal): Promise<EvidenceCaptureResult> {
    const deadline = Date.now() + this.totalBudgetMs;
    const channels = {} as Record<EvidenceChannel, EvidenceChannelResult>;
    for (const channel of ['screenshot', 'snapshot', 'diagnostics'] as const) {
      const source = sources[channel];
      if (!source) {
        channels[channel] = { status: 'disabled' };
        continue;
      }
      const remaining = Math.min(this.channelTimeoutMs, deadline - Date.now());
      if (remaining <= 0 || signal?.aborted) {
        channels[channel] = { status: 'timeout', error: signal?.reason ?? new EvidenceTimeoutError() };
        continue;
      }
      channels[channel] = await captureChannel(source, remaining, signal);
    }
    const statuses = Object.values(channels).map((channel) => channel.status);
    return {
      failureId,
      status: statuses.every((status) => status === 'disabled') ? 'disabled'
        : statuses.every((status) => status === 'captured' || status === 'disabled') ? 'complete' : 'partial',
      channels,
    };
  }
}

async function captureChannel(source: () => Promise<unknown>, timeoutMs: number, signal?: AbortSignal): Promise<EvidenceChannelResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(source),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new EvidenceTimeoutError()), timeoutMs); }),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal?.reason ?? new EvidenceTimeoutError());
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
    return { status: 'captured', value };
  } catch (error) {
    return { status: signal?.aborted || error instanceof EvidenceTimeoutError ? 'timeout' : 'unavailable', error };
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

class EvidenceTimeoutError extends Error {
  constructor() {
    super('Evidence capture timed out.');
    this.name = 'EvidenceTimeoutError';
  }
}
