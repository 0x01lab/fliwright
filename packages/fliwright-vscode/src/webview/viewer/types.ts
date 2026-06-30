// packages/fliwright-vscode/src/webview/viewer/types.ts
import type { TimelineData, FliwrightLogEvent, TraceData } from '@fliwright/core';

/**
 * Serializable mirror of {@link RunViewerService.LoadedRun}, plus the two
 * webview-URI base strings the host pre-resolves. `vscode.Uri` is not
 * JSON-serializable across the postMessage boundary, so the host converts the
 * run directory into string bases before posting:
 *   - `screenshotBaseUrl` -> `<img src="${screenshotBaseUrl}/${artifact.path}">`
 *     for node artifacts (paths are relative to the run dir).
 *   - `traceBaseUrl` -> `<img src="${traceBaseUrl}/${step.screenshotFile}">`
 *     for trace action steps (screenshots live under `<runDir>/trace`).
 *
 * Large log streams are capped in the host; `logsTruncated`/`logsTotal` let the
 * UI show how much was dropped.
 */
export interface SerializableRun {
  timeline: TimelineData;
  logs: FliwrightLogEvent[];
  trace?: TraceData;
  runId: string;
  screenshotBaseUrl: string;
  traceBaseUrl: string;
  logsTruncated?: boolean;
  logsTotal?: number;
}

/** Extension -> webview. */
export type ViewerInbound =
  | { type: 'run'; run: SerializableRun }
  | { type: 'snapshot'; path: string; data: unknown | null };

/** Webview -> extension. */
export type ViewerOutbound =
  | { type: 'ready' }
  | { type: 'openSource'; file: string; line: number; column?: number }
  | { type: 'copy'; text: string }
  | { type: 'requestSnapshot'; path: string };

/** Persisted viewer layout/selection state (vscode.getState/setState). */
export interface ViewerState {
  selectedKey: string | null;
  listMode: 'timeline' | 'actions';
  activeTab: 'details' | 'error' | 'logs' | 'widgetTree';
  filter: string;
}
