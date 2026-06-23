import { startVitest, type Vitest } from 'vitest/node';
import { focusAndRerun } from './FocusedRerunRecipe.js';
import { ResultReporter, type CollectedResult } from './ResultReporter.js';

export interface TestRunOutcome {
  status: 'red' | 'green';
  testName?: string;
  failure?: { message?: string };
}

export interface BootOptions {
  configRoot: string;
  vmServiceUrl?: string;
  driverProvider: () => Promise<unknown>;
}

export class PersistentTestExecutor {
  private vitest?: Vitest;
  private reporter?: ResultReporter;
  private previousVmServiceUrl?: string;
  private previousVmUrl?: string;
  private previousTddMode?: string;

  async boot(opts: BootOptions): Promise<void> {
    if (this.vitest) return;

    this.applyRuntimeEnv(opts.vmServiceUrl);
    this.reporter = new ResultReporter();
    this.vitest = await startVitest('test', [], {
      config: opts.configRoot,
      watch: true,
      reporters: [this.reporter],
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    });
    if (!this.vitest) throw new Error('Failed to start Vitest');

    // The provider is kept for same-process executor experiments. Vitest 2.1.9 workers cannot
    // receive live driver objects through process boundaries, so the production path also injects
    // FLIWRIGHT_VM_SERVICE_URL for ordinary @fliwright/vitest fixtures.
    void opts.driverProvider;
  }

  async rerun(file: string, testName?: string): Promise<TestRunOutcome> {
    if (!this.vitest || !this.reporter) throw new Error('PersistentTestExecutor not booted');

    this.reporter.drain();
    const nextRun = this.reporter.waitForNextRun();
    await focusAndRerun(this.vitest, file, testName);
    const files = await nextRun;
    const results = this.reporter.collectLatest();
    const picked = this.pickResult(results, testName);

    return {
      status: picked?.status ?? this.statusFromUnhandled(files),
      testName: picked?.testName ?? testName,
      failure: picked?.status === 'red' ? { message: picked.message } : undefined,
    };
  }

  async dispose(): Promise<void> {
    try {
      await this.vitest?.close();
    } finally {
      this.vitest = undefined;
      this.reporter = undefined;
      this.restoreRuntimeEnv();
    }
  }

  private pickResult(results: CollectedResult[], testName?: string): CollectedResult | undefined {
    if (!testName) return results.find((result) => result.status === 'red') ?? results[0];
    return results.find((result) => result.testName === testName)
      ?? results.find((result) => result.testName.includes(testName));
  }

  private statusFromUnhandled(files: unknown[]): 'red' | 'green' {
    return files.length > 0 ? 'red' : 'green';
  }

  private applyRuntimeEnv(vmServiceUrl: string | undefined): void {
    this.previousVmServiceUrl = process.env.FLIWRIGHT_VM_SERVICE_URL;
    this.previousVmUrl = process.env.FLIWRIGHT_VM_URL;
    this.previousTddMode = process.env.FLIWRIGHT_TDD_MODE;
    process.env.FLIWRIGHT_TDD_MODE = '1';
    if (vmServiceUrl) {
      process.env.FLIWRIGHT_VM_SERVICE_URL = vmServiceUrl;
      process.env.FLIWRIGHT_VM_URL = vmServiceUrl;
    }
  }

  private restoreRuntimeEnv(): void {
    restoreEnv('FLIWRIGHT_VM_SERVICE_URL', this.previousVmServiceUrl);
    restoreEnv('FLIWRIGHT_VM_URL', this.previousVmUrl);
    restoreEnv('FLIWRIGHT_TDD_MODE', this.previousTddMode);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
