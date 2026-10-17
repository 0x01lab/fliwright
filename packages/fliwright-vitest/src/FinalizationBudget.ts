/** One time allowance shared by Fliwright-owned teardown stages, excluding project hooks. */
export class FinalizationBudget {
  private deadline?: number;
  private availableMs: number;
  private active = 0;

  constructor(readonly timeoutMs: number) { this.availableMs = timeoutMs; }

  begin(): void {
    this.deadline ??= performance.now() + this.availableMs;
  }

  pause(): void {
    if (this.active !== 0 || this.deadline === undefined) return;
    this.availableMs = this.remainingMs;
    this.deadline = undefined;
  }

  get remainingMs(): number {
    return this.deadline === undefined ? this.availableMs : Math.max(0, this.deadline - performance.now());
  }

  async run<T>(stage: string, work: (signal: AbortSignal) => Promise<T>, reserveMs = 0): Promise<T> {
    this.begin();
    const remaining = this.remainingMs - reserveMs;
    const timeout = new FinalizationTimeoutError(stage, this.timeoutMs);
    if (remaining <= 0) {
      this.pause();
      throw timeout;
    }
    this.active++;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => work(controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(timeout);
            reject(timeout);
          }, Math.ceil(remaining));
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.active--;
      this.pause();
    }
  }
}

export class FinalizationTimeoutError extends Error {
  constructor(stage: string, budgetMs: number) {
    super(`${stage} exceeded the ${budgetMs}ms test finalization budget.`);
    this.name = 'FinalizationTimeoutError';
  }
}
