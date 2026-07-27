import type { SendRequest } from './types.js';

const METHODS = {
  status: 'ext.fliwright.designQa.status',
  diagnostics: 'ext.fliwright.designQa.diagnostics',
  pair: 'ext.fliwright.designQa.pair',
  capture: 'ext.fliwright.designQa.capture',
  startShake: 'ext.fliwright.designQa.startShake',
  stopShake: 'ext.fliwright.designQa.stopShake',
  openPairing: 'ext.fliwright.designQa.openPairing',
  close: 'ext.fliwright.designQa.close',
} as const;

export type DesignQaControllerState =
  | 'idle'
  | 'paired'
  | 'listening'
  | 'capturing'
  | 'error'
  | 'closed';

export interface DesignQaCaptureResult {
  sessionId: string;
  transferId: string;
  totalBytes: number;
  chunkCount: number;
  sha256: string;
}

export interface DesignQaSnapshot {
  state: DesignQaControllerState;
  sessionId?: string;
  lastCapture?: DesignQaCaptureResult;
  error?: string;
}

export interface DesignQaPairingInfo {
  version: number;
  signalingUrl: string;
  roomId: string;
  iceConfigId: string;
}

export interface DesignQaPeerServerInfo {
  host: string;
  port?: number;
  path: string;
  secure: boolean;
  key: string;
}

export interface DesignQaExtensionResult {
  success: boolean;
  error?: string;
  designQa: DesignQaSnapshot;
}

export interface DesignQaDiagnosticsResult extends DesignQaExtensionResult {
  pairing?: DesignQaPairingInfo;
  signaling?: DesignQaPeerServerInfo;
}

export interface DesignQaPairResult extends DesignQaDiagnosticsResult {}

export interface DesignQaCaptureCommandResult extends DesignQaExtensionResult {
  result?: DesignQaCaptureResult | null;
}

export interface DesignQaPairOptions {
  qrPayload: string;
}

export interface DesignQaDiagnosticsOptions {
  qrPayload?: string;
}

export class DesignQaClient {
  constructor(private readonly sendRequest: SendRequest) {}

  async status(): Promise<DesignQaExtensionResult> {
    return normalizeResult(await this.sendRequest(METHODS.status, {}));
  }

  async diagnostics(options: DesignQaDiagnosticsOptions = {}): Promise<DesignQaDiagnosticsResult> {
    const params = options.qrPayload == null ? {} : { qrPayload: options.qrPayload };
    return normalizeResult(await this.sendRequest(METHODS.diagnostics, params)) as DesignQaDiagnosticsResult;
  }

  async pair(qrPayloadOrOptions: string | DesignQaPairOptions): Promise<DesignQaPairResult> {
    const qrPayload = typeof qrPayloadOrOptions === 'string'
      ? qrPayloadOrOptions
      : qrPayloadOrOptions.qrPayload;
    return ensureSuccess(
      await this.sendRequest(METHODS.pair, { qrPayload }),
      'Design QA pair failed',
    ) as DesignQaPairResult;
  }

  async capture(): Promise<DesignQaCaptureCommandResult> {
    return ensureSuccess(
      await this.sendRequest(METHODS.capture, {}),
      'Design QA capture failed',
    ) as DesignQaCaptureCommandResult;
  }

  async startShake(): Promise<DesignQaExtensionResult> {
    return ensureSuccess(
      await this.sendRequest(METHODS.startShake, {}),
      'Design QA startShake failed',
    );
  }

  async stopShake(): Promise<DesignQaExtensionResult> {
    return normalizeResult(await this.sendRequest(METHODS.stopShake, {}));
  }

  async openPairing(): Promise<DesignQaExtensionResult> {
    return ensureSuccess(
      await this.sendRequest(METHODS.openPairing, {}),
      'Unable to open Design QA pairing.',
    );
  }

  async close(): Promise<DesignQaExtensionResult> {
    return normalizeResult(await this.sendRequest(METHODS.close, {}));
  }
}

function ensureSuccess(value: unknown, fallbackMessage: string): DesignQaExtensionResult {
  const result = normalizeResult(value);
  if (!result.success || result.error) {
    throw new Error(result.error ?? fallbackMessage);
  }
  return result;
}

function normalizeResult(value: unknown): DesignQaExtensionResult {
  const result = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    ...result,
    success: result.success === true,
    error: typeof result.error === 'string' ? result.error : undefined,
    designQa: normalizeSnapshot(result.designQa),
  } as DesignQaExtensionResult;
}

function normalizeSnapshot(value: unknown): DesignQaSnapshot {
  const snapshot = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const state = typeof snapshot.state === 'string'
    ? snapshot.state as DesignQaControllerState
    : 'idle';
  return {
    state,
    sessionId: typeof snapshot.sessionId === 'string' ? snapshot.sessionId : undefined,
    lastCapture: normalizeCapture(snapshot.lastCapture),
    error: typeof snapshot.error === 'string' ? snapshot.error : undefined,
  };
}

function normalizeCapture(value: unknown): DesignQaCaptureResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const capture = value as Record<string, unknown>;
  if (
    typeof capture.sessionId !== 'string' ||
    typeof capture.transferId !== 'string' ||
    typeof capture.totalBytes !== 'number' ||
    typeof capture.chunkCount !== 'number' ||
    typeof capture.sha256 !== 'string'
  ) {
    return undefined;
  }
  return {
    sessionId: capture.sessionId,
    transferId: capture.transferId,
    totalBytes: capture.totalBytes,
    chunkCount: capture.chunkCount,
    sha256: capture.sha256,
  };
}
