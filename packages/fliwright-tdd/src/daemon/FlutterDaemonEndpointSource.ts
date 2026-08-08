import {
  normalizeVmServiceUrl,
  type VmServiceAcquisitionRequest,
  type VmServiceEndpoint,
  type VmServiceEndpointSource,
} from '@fliwright/core';
import type { AppHandle, AppStartParams } from './DaemonTransport.js';

type FlutterDaemonStarter = Pick<import('./FlutterDaemonController.js').FlutterDaemonController, 'startApp'>;

export interface FlutterDaemonEndpointSourceOptions {
  controller: FlutterDaemonStarter;
  projectId?: string;
  deviceId: string;
  target?: string;
  flutterArgs?: string[];
  mode?: AppStartParams['mode'];
  debugPortTimeoutMs?: number;
  scope?: VmServiceEndpoint['scope'];
}

/** Acquires the app.debugPort.wsUri emitted for the app this daemon starts. */
export class FlutterDaemonEndpointSource implements VmServiceEndpointSource {
  readonly name = 'flutter-daemon';
  private _lastApp?: AppHandle;

  constructor(private readonly options: FlutterDaemonEndpointSourceOptions) {}

  get lastApp(): AppHandle | undefined { return this._lastApp; }

  async acquire(request: VmServiceAcquisitionRequest = {}): Promise<VmServiceEndpoint> {
    if (this.options.flutterArgs?.includes('--release')) {
      throw new Error('Managed VM Service acquisition does not support Flutter release mode.');
    }
    const deviceId = request.deviceId ?? this.options.deviceId;
    const handle = await this.options.controller.startApp({
      projectId: this.options.projectId,
      deviceId,
      target: this.options.target,
      flutterArgs: this.options.flutterArgs,
      mode: this.options.mode,
    }, { debugPortTimeoutMs: this.options.debugPortTimeoutMs });
    this._lastApp = handle;
    const url = normalizeVmServiceUrl(handle.wsUri);
    if (!url) throw new Error('flutter daemon returned an invalid app.debugPort.wsUri');
    return {
      url,
      kind: 'direct-vm',
      source: this.name,
      scope: this.options.scope ?? 'execution-worker',
      appId: handle.appId,
      deviceId: handle.deviceId,
      acquiredAt: new Date().toISOString(),
    };
  }
}
