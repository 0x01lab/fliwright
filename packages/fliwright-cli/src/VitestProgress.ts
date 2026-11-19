import { watchFile, unwatchFile } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  eventsPath: string;
  onOutput: (chunk: string) => void;
  dispose: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'fliwright-test-progress-'));
  const reporterPath = join(directory, 'reporter.mjs');
  const eventsPath = join(directory, 'events.jsonl');
  try {
    await writeFile(eventsPath, '');
    await writeFile(reporterPath, `export default class {
      emit(test, status) {
        if (test.meta().fliwrightProgressDirect) return;
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
  const deliver = (line: string): void => {
    let event: unknown;
    try { event = JSON.parse(line); } catch { return; }
    if (isTestProgress(event)) onProgress(event);
  };
  let pending = '';
  const onOutput = (chunk: string): void => {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.startsWith(marker)) continue;
        deliver(line.slice(marker.length));
      }
      // Unrelated user output can be arbitrarily long without a newline.
      if (pending.length > 1024 * 1024) pending = '';
  };
  let offset = 0;
  let filePending = '';
  let reading = Promise.resolve();
  const decoder = new StringDecoder('utf8');
  const drain = (): Promise<void> => {
    reading = reading.then(async () => {
      const data = await readFile(eventsPath);
      const chunk = decoder.write(data.subarray(offset));
      offset = data.length;
      // Worker events use their own file, independent of Vitest's task batching.
      filePending += chunk;
      let end: number;
      while ((end = filePending.indexOf('\n')) >= 0) {
        const line = filePending.slice(0, end);
        filePending = filePending.slice(end + 1);
        deliver(line);
      }
    }).catch(() => {});
    return reading;
  };
  watchFile(eventsPath, { interval: 20, persistent: false }, drain);
  return {
    path: reporterPath,
    eventsPath,
    onOutput,
    async dispose() {
      unwatchFile(eventsPath, drain);
      await drain();
      await rm(directory, { recursive: true, force: true });
    },
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
