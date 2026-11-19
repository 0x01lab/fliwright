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
    await writeFile(reporterPath, `import { writeFile } from 'node:fs/promises';
      import { createRequire } from 'node:module';
      import { isAbsolute, resolve, join, dirname } from 'node:path';
      import { pathToFileURL } from 'node:url';
      export default class {
        async onInit(context) {
          for (const [index, project] of context.projects.entries()) {
            const require = createRequire(join(project.config.root, 'package.json'));
            const original = project.config.runner;
            const modulePath = original
              ? isAbsolute(original) ? original : original.startsWith('.') ? resolve(project.config.root, original) : require.resolve(original)
              : join(dirname(require.resolve('vitest/package.json')), 'dist/index.js');
            const source = (original ? 'import Base from ' : 'import { TestRunner as Base } from ')
              + JSON.stringify(pathToFileURL(modulePath).href) + ';\\n'
              + "import { appendFile } from 'node:fs/promises';\\n"
              + 'const target = ' + ${JSON.stringify(JSON.stringify(eventsPath))} + ';\\n'
              + ${JSON.stringify(progressRunnerBody)};
            const runner = join(${JSON.stringify(directory)}, 'runner-' + index + '.mjs');
            await writeFile(runner, source);
            project.config.runner = runner;
          }
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

const progressRunnerBody = String.raw`async function emit(task, status) {
  const titlePath = [task.name];
  for (let suite = task.suite; suite && suite !== task.file; suite = suite.suite) titlePath.unshift(suite.name);
  const event = { filePath: task.file.filepath, titlePath, status, durationMs: task.result?.duration,
    error: status === 'failed' ? task.result?.errors?.map(error => error.stack || error.message).join('\n') : undefined };
  await appendFile(target, JSON.stringify(event) + '\n').catch(() => {});
}
function outcome(task) {
  return task.result?.state === 'pass' ? 'passed' : task.result?.state === 'skip' || task.mode === 'skip' || task.mode === 'todo' ? 'skipped' : 'failed';
}
export default class extends Base {
  async onBeforeRunTask(task) {
    if (task.mode === 'run' || task.mode === 'queued') await emit(task, 'running');
    await Base.prototype.onBeforeRunTask?.call(this, task);
    if (task.mode !== 'run' && task.mode !== 'queued' || task.result?.state === 'fail') await emit(task, outcome(task));
  }
  async onAfterRetryTask(task, options) {
    await Base.prototype.onAfterRetryTask?.call(this, task, options);
    if (task.result?.state === 'skip') await emit(task, 'skipped');
  }
  async onAfterRunTask(task) {
    await Base.prototype.onAfterRunTask?.call(this, task);
    await emit(task, outcome(task));
  }
}
`;
