import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { resolveProjectConfig } from '../config.js';
import { readFile } from 'node:fs/promises';
import { isAbsolute, dirname, resolve, relative } from 'node:path';
import { AiRuntime, PassiveAgent, TimelineRecorder, buildFlowFromTimeline, resolveAiConfig, type TimelineData, type AgentVisibleFailure } from '@fliwright/core';
import { artifactPathIssue, artifactsShowCommand, type ArtifactOptions } from './artifacts.js';
import type { CliRunResult } from '../reporter.js';

export async function artifactsFailuresCommand(options: ArtifactOptions & { testName?: string }) {
  const shown = await artifactsShowCommand(options);
  const report = shown.report as CliRunResult | null;
  let entries = report?.failures ?? [];
  if (!report && shown.runId && shown.manifest) {
    const root = resolve(shown.runsRoot, shown.runId);
    const manifest = shown.manifest as { tests?: Array<{ attempts: Array<{ resultPath: string }> }> };
    entries = [];
    for (const attempt of manifest.tests?.flatMap((test) => test.attempts) ?? []) {
      const resultPath = resolve(root, attempt.resultPath);
      if (await artifactPathIssue(root, resultPath)) continue;
      const result = JSON.parse(await readFile(resultPath, 'utf8'));
      if (!result.failureContextPath) continue;
      const path = resolve(dirname(resultPath), result.failureContextPath);
      if (await artifactPathIssue(dirname(resultPath), path)) continue;
      entries.push(...JSON.parse(await readFile(path, 'utf8')));
    }
  }
  const failures = entries.filter((failure) => !options.testName || failure.testName === options.testName);
  return { runId: shown.runId, failures, runnerErrors: report?.runnerErrors ?? [], evidenceStatus: (shown.manifest as { evidenceStatus?: string } | null)?.evidenceStatus };
}
export async function artifactsTimelineCommand(options: ArtifactOptions & { path?: string; testId?: string; attemptId?: string; nodeId?: string; includeArtifacts?: boolean; includeFlow?: boolean }) {
  let path: string;
  if (options.path) path = resolve(options.cwd ?? process.cwd(), options.path);
  else {
    const shown = await artifactsShowCommand(options);
    if (!shown.runId) throw new Error('No run is available. Specify runId or path.');
    const root = resolve(shown.runsRoot, shown.runId);
    const manifest = shown.manifest as { tests?: Array<{ testId: string; attempts: Array<{ attemptId: string; resultPath: string; timelinePath?: string }> }> } | null;
    const candidates = manifest?.tests?.filter((test) => !options.testId || test.testId === options.testId)
      .flatMap((test) => test.attempts.filter((attempt) => !options.attemptId || attempt.attemptId === options.attemptId)
        .map((attempt) => resolve(root, dirname(attempt.resultPath), 'timeline.json'))) ?? [];
    const fallback = (shown.report as CliRunResult | null)?.artifacts?.timelines ?? [];
    const paths = candidates.length ? candidates : fallback.map((entry) => isAbsolute(entry) ? entry : resolve(root, entry));
    if (paths.length !== 1) throw new Error(paths.length ? 'Multiple timelines exist; specify testId/attemptId or path.' : 'No timeline is available.');
    path = paths[0];
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel) || await artifactPathIssue(root, path)) throw new Error('Timeline reference escapes the run directory.');
  }
  const timeline = JSON.parse(await readFile(path, 'utf8')) as TimelineData;
  if (!Array.isArray(timeline.nodes)) throw new Error('Invalid timeline document.');
  const nodes = options.includeArtifacts ? timeline.nodes : timeline.nodes.map(({ artifacts: _artifacts, ...rest }) => rest);
  const flow = options.includeFlow ? buildFlowFromTimeline({ timeline }) : undefined;
  if (!options.nodeId) return { path, timeline: { ...timeline, nodes }, flow };
  const index = nodes.findIndex((node) => node.id === options.nodeId);
  if (index < 0) throw new Error(`Timeline node not found: ${options.nodeId}`);
  const node = nodes[index];
  return { path, node, parent: nodes.find((entry) => entry.id === node.parentId), children: nodes.filter((entry) => entry.parentId === node.id), previous: nodes[index - 1], next: nodes[index + 1], flow };
}
export async function artifactsDiagnoseCommand(options: ArtifactOptions & { path?: string; testId?: string; attemptId?: string; failureIndex?: number; failure?: { code: string; title: string; message: string; timelineNodeId?: string } }) {
  const found = options.failure && !options.path && !options.runId ? undefined : await artifactsTimelineCommand({ ...options, includeArtifacts: true });
  const timeline = found && 'timeline' in found ? found.timeline as TimelineData : undefined;
  const failure = options.failure ? { ...options.failure, recoveryHints: [] } as AgentVisibleFailure : timeline?.agentVisibleFailures?.[options.failureIndex ?? 0];
  if (!failure) throw new Error('No agent-visible failure is available.');
  const recorder = new TimelineRecorder({ runId: timeline?.runId ?? 'cli-diagnosis', testName: timeline?.testName ?? 'CLI diagnosis' });
  const config = await resolveProjectConfig(options.cwd ?? process.cwd());
  const aiRuntime = new AiRuntime(resolveAiConfig({ artifactsDir: join(config.cacheRoot!, 'inspect', randomUUID(), 'ai') }), { runId: recorder.runId, testName: recorder.testName });
  const agent = new PassiveAgent({ aiRuntime, recorder, passive: true });
  const currentNode = timeline?.nodes.find((node) => node.id === failure.timelineNodeId);
  const diagnosis = await agent.diagnose(failure, { currentNode, recentNodes: timeline?.nodes.slice(-8), artifacts: currentNode?.artifacts,
    allowedTools: ['fliwright artifacts timeline', 'fliwright app snapshot', 'fliwright app observe'] });
  return { diagnosis, skipped: !diagnosis };
}
