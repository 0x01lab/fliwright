/** Platform-neutral identity of one owned device session. */
export interface NativeIdentity {
  platform: 'android' | 'ios';
  deviceId: string;
  appId: string;
  backend: string;
  generation: string;
}

export interface DeviceCapability {
  support: 'supported' | 'unsupported' | 'unverified';
  ready: boolean;
  reason?: string;
  backend: string;
}
export type DeviceCapabilities = Record<string, DeviceCapability>;
export interface NativeFrame { x: number; y: number; width: number; height: number; }
export interface NativeNode {
  /** Ephemeral within one snapshot, never a persistent selector. */
  id: string;
  appId: string;
  resourceId?: string;
  text?: string;
  label?: string;
  value?: string;
  className?: string;
  windowId?: string;
  parentId?: string;
  enabled: boolean;
  visible: boolean;
  hittable: boolean | 'unknown';
  password?: boolean;
  frame: NativeFrame;
}
export interface NativeSnapshot {
  id: string;
  identity: NativeIdentity;
  capturedAt: string;
  screen: { width: number; height: number; scale: number; orientation: 'portrait' | 'landscape' };
  nodes: NativeNode[];
  foregroundAppId?: string;
}
export type NativeScope = 'app' | 'system' | { appId: string };
export interface NativeQuery {
  field: 'resourceId' | 'text' | 'label';
  value: string;
  exact: boolean;
  scope: NativeScope;
}
export interface NativeQueryOptions { scope?: NativeScope; exact?: boolean; }
export interface NativeOperationOptions { timeout?: number; signal?: AbortSignal; }
export interface NativeOperationContext {
  requestId: string;
  /** Host deadline; adapters transmit remaining budget across clock domains. */
  deadline: number;
  signal: AbortSignal;
}
export type NativeCommand =
  | { kind: 'click'; node: NativeNode; snapshotId: string }
  | { kind: 'fill'; node: NativeNode; snapshotId: string; text: string }
  | { kind: 'swipe'; from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }
  | { kind: 'back' }
  | { kind: 'biometric'; result: 'match' | 'reject' }
  | { kind: 'permission'; permission: string; state: 'granted' | 'denied' | 'prompt' }
  | { kind: 'importImage'; path: string };
export interface DeviceEventResult { eventId: string; acknowledged: boolean; }

/** Implemented by an owned platform session; no Flutter VM dependency. */
export interface NativeSessionAdapter {
  readonly identity: NativeIdentity;
  capabilities(context: NativeOperationContext): Promise<DeviceCapabilities>;
  /** Query may be pushed down; the runtime still verifies scope and matching. */
  snapshot(context: NativeOperationContext, query?: NativeQuery): Promise<NativeSnapshot>;
  execute(command: NativeCommand, context: NativeOperationContext): Promise<unknown>;
  screenshot(context: NativeOperationContext): Promise<Buffer>;
  dispose(): Promise<void>;
}

export type NativeErrorCode =
  | 'unsupported_capability' | 'precondition_failed' | 'device_mismatch' | 'device_busy'
  | 'runner_unavailable' | 'protocol_mismatch' | 'target_not_found' | 'strict_mode_violation'
  | 'not_interactable' | 'timeout' | 'cancelled' | 'transport_lost'
  | 'action_outcome_unknown' | 'cleanup_failed' | 'assertion_failed';

export class NativeError extends Error {
  constructor(readonly code: NativeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NativeError';
  }
}
