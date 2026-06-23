export interface DaemonMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: string | number; message: string; data?: unknown };
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
 * Line transport over `flutter daemon` JSON-RPC. Unit-tested via a fake;
 * the real subprocess implementation is SubprocessDaemonTransport.
 */
export interface DaemonTransport {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(handler: (message: DaemonMessage) => void): () => void;
  dispose(): Promise<void>;
}
