export interface VmServiceDiscoveryRequest {
  reason: string;
  interactive: boolean;
  forceReconnect?: boolean;
}

const RETRY_DELAYS_MS = [500, 1500, 3000];

/** Serializes connection changes and coalesces automatic discovery without starving it. */
export class VmServiceConnectionController {
  private tail: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: VmServiceDiscoveryRequest | undefined;
  private revision = 0;
  private disposed = false;

  constructor(
    private readonly connect: (request: VmServiceDiscoveryRequest) => Promise<boolean>,
    private readonly reportError: (error: unknown) => void,
  ) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  discover(request: VmServiceDiscoveryRequest): Promise<boolean> {
    this.cancelScheduled();
    return this.run(() => this.connect(request));
  }

  schedule(request: VmServiceDiscoveryRequest, delayMs = 0): void {
    if (this.disposed) return;
    this.revision++;
    const coalescing = Boolean(this.pending);
    this.pending = {
      ...request,
      forceReconnect: request.forceReconnect || this.pending?.forceReconnect,
    };
    // Keep the first deadline even when output arrives faster than the debounce interval.
    if (this.timer && coalescing) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const pending = this.pending;
      this.pending = undefined;
      if (pending) this.attempt(pending, this.revision, 0);
    }, delayMs);
  }

  cancelScheduled(): void {
    this.revision++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelScheduled();
  }

  private attempt(request: VmServiceDiscoveryRequest, revision: number, retry: number): void {
    void this.run(async () => {
      if (this.disposed || revision !== this.revision) return;
      let connected = false;
      try {
        connected = await this.connect(request);
      } catch (error) {
        this.reportError(error);
      }
      if (connected || this.disposed || revision !== this.revision) return;
      const delay = RETRY_DELAYS_MS[retry];
      if (delay === undefined) return;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.attempt(request, revision, retry + 1);
      }, delay);
    });
  }
}
