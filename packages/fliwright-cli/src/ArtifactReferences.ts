import { isAbsolute, relative, resolve } from 'node:path';

type JsonRecord = Record<string, unknown>;
export interface ArtifactReference {
  path: string;
  set(path: string): void;
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Enumerate schema-owned artifact paths, excluding source-code locations and arbitrary metadata. */
export function artifactReferences(document: unknown, kind: 'report' | 'result' | 'timeline' | 'trace' | 'failures'): ArtifactReference[] {
  const refs: ArtifactReference[] = [];
  const field = (value: unknown, key: string): void => {
    const object = record(value);
    if (object && typeof object[key] === 'string' && object[key]) {
      refs.push({ path: object[key] as string, set: (path) => { object[key] = path; } });
    }
  };
  const paths = (value: unknown, key: string): void => {
    const array = record(value)?.[key];
    if (!Array.isArray(array)) return;
    for (let index = 0; index < array.length; index++) if (typeof array[index] === 'string') {
      refs.push({ path: array[index] as string, set: (path) => { array[index] = path; } });
    }
  };
  const appState = (value: unknown): void => {
    const state = record(value)?.appState;
    for (const key of ['screenshotPath', 'snapshotPath', 'diagnosticsPath']) field(state, key);
  };
  const failure = (value: unknown): void => {
    field(record(value)?.screenshot, 'path');
    appState(value);
  };
  const object = record(document);
  if (kind === 'report') {
    const artifacts = record(object?.artifacts);
    field(artifacts, 'manifestPath');
    field(artifacts, 'reportPath');
    paths(artifacts, 'screenshots');
    paths(artifacts, 'timelines');
    for (const timeline of list(object?.timelines)) {
      field(timeline, 'path');
      appState(record(timeline)?.firstFailure);
    }
    for (const entry of list(object?.failures)) failure(entry);
    for (const entry of list(object?.agentVisibleFailures)) appState(entry);
  } else if (kind === 'result') {
    field(object, 'failureContextPath');
    field(object, 'eventsPath');
    for (const evidence of list(object?.evidence)) paths(record(evidence)?.result, 'artifactPaths');
  } else if (kind === 'timeline') {
    for (const node of list(object?.nodes)) {
      for (const artifact of list(record(node)?.artifacts)) field(artifact, 'path');
      appState(record(node)?.error);
    }
    for (const entry of list(object?.agentVisibleFailures)) appState(entry);
  } else if (kind === 'trace') {
    for (const step of list(object?.steps)) {
      field(step, 'screenshotFile');
      field(step, 'snapshotFile');
      field(step, 'diagnosticsFile');
    }
  } else for (const entry of list(document)) failure(entry);
  return refs;
}

export function relativeArtifactPath(root: string, target: string): string | undefined {
  const rel = relative(resolve(root), resolve(target));
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)
    ? undefined : rel.split('\\').join('/');
}
