// packages/fliwright-vscode/src/webview/viewer/host.ts
import type { ViewerOutbound } from './types.js';

declare const acquireVsCodeApi: () => {
  postMessage(message: ViewerOutbound): void;
  getState<T = unknown>(): T | undefined;
  setState(state: unknown): void;
};

/**
 * The single acquired VS Code API handle for this webview.
 * `acquireVsCodeApi()` may be called exactly once per webview, so it is held in
 * one place and imported wherever a postMessage is needed.
 */
export const vscode = acquireVsCodeApi();
