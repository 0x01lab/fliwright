import { cp, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { ensureFliwrightRunsRoot } from '@fliwright/core';
import { loadConfig } from '../config.js';

export interface ArtifactOptions {
  cwd?: string;
  runsRoot?: string;
  runId?: string;
}

export async function artifactsShowCommand(options: ArtifactOptions = {}) {
  const { runsRoot, runs } = await listRuns(options);
  const runId = options.runId ?? runs[0]?.runId;
  if (!runId) return { runsRoot, runs, report: null };
  const reportPath = join(runsRoot, runId, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
  return { runsRoot, runId, reportPath, report, runs };
}

export async function artifactsExportCommand(options: ArtifactOptions & { output: string }) {
  const shown = await artifactsShowCommand(options);
  if (!shown.runId) throw new Error('No Fliwright run artifacts found to export.');
  const source = join(shown.runsRoot, shown.runId);
  const output = resolve(options.cwd ?? process.cwd(), options.output);
  try {
    await stat(output);
    throw new Error(`Artifact export destination already exists: ${output}`);
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error;
    if (typeof error === 'object' && error && 'code' in error && error.code !== 'ENOENT') throw error;
  }
  await cp(source, output, { recursive: true, errorOnExist: true });
  return { runId: shown.runId, source, output };
}

async function listRuns(options: ArtifactOptions) {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(cwd);
  const runsRoot = await ensureFliwrightRunsRoot({ projectRoot: cwd, runsRoot: options.runsRoot ?? config.runsRoot });
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => ({
    runId: basename(entry.name),
    modifiedAt: (await stat(join(runsRoot, entry.name))).mtime.toISOString(),
  })));
  runs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return { runsRoot, runs };
}
