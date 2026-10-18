export interface DaemonMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string | { code: string | number; message: string; data?: unknown };
  event?: string;
}

export interface AppStartParams {
  projectId?: string;
  deviceId: string;
  target?: string;
  flutterArgs?: string[];
  mode?: 'run' | 'drive';
}

export interface AppHandle {
  appId: string;
  deviceId: string;
  wsUri: string;
  supportsRestart: boolean;
}

/**
 * Line transport over Flutter machine-mode JSON-RPC. Unit-tested via a fake;
 * the real subprocess implementation is SubprocessDaemonTransport.
 */
export interface DaemonTransport {
  connect?(): Promise<void>;
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(handler: (message: DaemonMessage) => void): () => void;
  dispose(options?: { keepAppAlive?: boolean }): Promise<void>;
}
