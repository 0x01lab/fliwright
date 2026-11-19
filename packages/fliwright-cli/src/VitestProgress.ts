import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Live Vitest case identity uses separate titles so delimiters in names stay intact. */
export interface TestProgress {
  filePath: string;
  titlePath: string[];
  status: 'running' | 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}

const marker = 'FLIWRIGHT_TEST_PROGRESS=';

/** Create a standalone reporter usable by both CLI and editor subprocesses. Dispose after stdio closes. */
export async function createVitestProgressReporter(onProgress: (progress: TestProgress) => void): Promise<{
  path: string;
  onOutput: (chunk: string) => void;
  dispose: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'fliwright-test-progress-'));
  const reporterPath = join(directory, 'reporter.mjs');
  try {
    await writeFile(reporterPath, `export default class {
      emit(test, status) {
        const titlePath = [test.name];
        for (let parent = test.parent; parent.type === 'suite'; parent = parent.parent) titlePath.unshift(parent.name);
        const result = test.result();
        const event = { filePath: test.module.moduleId, titlePath, status,
          durationMs: test.diagnostic()?.duration,
          error: status === 'failed' ? result.errors?.map(error => error.stack || error.message).join('\\n') : undefined };
        process.stdout.write('\\n${marker}' + JSON.stringify(event) + '\\n');
      }
      onTestCaseReady(test) { if (test.result().state !== 'skipped') this.emit(test, 'running'); }
      onTestCaseResult(test) {
        const status = test.result().state;
        if (status !== 'pending') this.emit(test, status);
      }
    }`);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  let pending = '';
  return {
    path: reporterPath,
    onOutput(chunk) {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.startsWith(marker)) continue;
        let event: unknown;
        try { event = JSON.parse(line.slice(marker.length)); } catch { continue; }
        if (isTestProgress(event)) onProgress(event);
      }
      // Unrelated user output can be arbitrarily long without a newline.
      if (pending.length > 1024 * 1024) pending = '';
    },
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}

function isTestProgress(value: unknown): value is TestProgress {
  if (!value || typeof value !== 'object') return false;
  const event = value as TestProgress;
  return typeof event.filePath === 'string'
    && Array.isArray(event.titlePath) && event.titlePath.length > 0
    && event.titlePath.every(title => typeof title === 'string')
    && ['running', 'passed', 'failed', 'skipped'].includes(event.status)
    && (event.durationMs === undefined || (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)))
    && (event.error === undefined || typeof event.error === 'string');
}
