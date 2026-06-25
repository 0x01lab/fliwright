import type { AppHandle, AppStartParams, DaemonMessage, DaemonTransport } from './DaemonTransport.js';

interface StartAppResult {
  appId: string;
  deviceId?: string;
  directory?: string;
  supportsRestart?: boolean;
}

export class FlutterDaemonController {
  private started = false;
  private readonly handles = new Map<string, AppHandle>();

  constructor(private readonly transport: DaemonTransport) {}

  async start(): Promise<void> {
    if (this.started) return;
    await this.transport.connect?.();
    // `flutter daemon` emits daemon.connected unsolicited on stdout; no request needed here.
    this.started = true;
  }

  async startApp(params: AppStartParams, opts: { debugPortTimeoutMs?: number } = {}): Promise<AppHandle> {
    if (!this.started) await this.start();

    const requestParams: Record<string, unknown> = {
      deviceId: params.deviceId,
      target: params.target ?? 'lib/main.dart',
    };
    if (params.projectId !== undefined) requestParams.projectId = params.projectId;
    if (params.mode !== undefined) requestParams.mode = params.mode;
    if (params.flutterArgs !== undefined) requestParams.flutterArgs = params.flutterArgs;

    const result = await this.transport.request<StartAppResult>('app.start', requestParams);
    const appId = result.appId;
    if (!appId) {
      throw new Error(
        `flutter daemon app.start returned no appId. Doctor: confirm the device is online `
          + `(\`flutter devices\`), the target "${requestParams.target}" exists, and the project compiles.`
          + ` Raw response: ${JSON.stringify(result)}.`,
      );
    }

    const debugPort = await this.waitForEvent(
      'app.debugPort',
      (m) => m.params?.appId === appId,
      opts.debugPortTimeoutMs ?? 60_000,
    );
    const wsUri = debugPort.params?.wsUri;
    if (typeof wsUri !== 'string' || wsUri.length === 0) {
      throw new Error(
        `flutter daemon app.debugPort for ${appId} carried no VM service wsUri. The app likely failed `
          + `to start. Doctor: run \`flutter run\` on the same target/device and read the console for `
          + `compile or runtime errors, then retry fliwright_tdd_start.`,
      );
    }

    const handle: AppHandle = {
      appId,
      deviceId: result.deviceId ?? params.deviceId,
      wsUri,
      supportsRestart: result.supportsRestart ?? params.mode !== 'drive',
    };
    this.handles.set(appId, handle);
    return handle;
  }

  async reload(appId: string): Promise<void> {
    this.require(appId);
    await this.transport.request('app.restart', { appId, fullRestart: false });
  }

  async restart(appId: string): Promise<void> {
    const handle = this.require(appId);
    if (!handle.supportsRestart) throw new Error(`Hot restart not supported for app ${appId}`);
    await this.transport.request('app.restart', { appId, fullRestart: true });
  }

  async stop(appId: string): Promise<void> {
    this.require(appId);
    await this.transport.request('app.stop', { appId });
    this.handles.delete(appId);
  }

  async dispose(): Promise<void> {
    this.started = false;
    this.handles.clear();
    await this.transport.dispose();
  }

  protected async waitForEvent(
    event: string,
    predicate: (message: DaemonMessage) => boolean,
    timeoutMs: number,
  ): Promise<DaemonMessage> {
    return new Promise<DaemonMessage>((resolve, reject) => {
      let off: (() => void) | undefined;
      const timer = setTimeout(() => {
        off?.();
        reject(
          event === 'app.debugPort'
            ? new Error(
              `Timed out after ${timeoutMs}ms waiting for the app's VM service (app.debugPort). `
                + `The app may still be building or may have crashed at startup. Doctor: check `
                + `\`flutter run\` console output on this target, then retry fliwright_tdd_start.`,
            )
            : new Error(`waitForEvent('${event}') timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      off = this.transport.onEvent((message) => {
        if (message.event === event && predicate(message)) {
          clearTimeout(timer);
          off?.();
          resolve(message);
        }
      });
    });
  }

  private require(appId: string): AppHandle {
    const handle = this.handles.get(appId);
    if (!handle) throw new Error(`Unknown appId: ${appId}`);
    return handle;
  }
}
