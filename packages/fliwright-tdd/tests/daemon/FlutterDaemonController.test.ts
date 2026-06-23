import { describe, expect, it } from 'vitest';
import { FlutterDaemonController } from '../../src/daemon/FlutterDaemonController.js';
import { FakeDaemonTransport } from './FakeDaemonTransport.js';

describe('FlutterDaemonController.start', () => {
  it('sends no request on start and is idempotent', async () => {
    const transport = new FakeDaemonTransport();
    const controller = new FlutterDaemonController(transport);

    await controller.start();
    await controller.start();

    expect(transport.requests).toHaveLength(0);
  });
});

describe('FlutterDaemonController.startApp', () => {
  it('calls app.start, awaits app.debugPort, and returns the wsUri', async () => {
    const transport = new FakeDaemonTransport().on('app.start', async () => ({
      appId: 'app-1',
      deviceId: 'emulator-5554',
      directory: '/proj',
    }));
    const controller = new FlutterDaemonController(transport);

    const appHandleP = controller.startApp({ deviceId: 'emulator-5554', target: 'lib/main.dart' });
    setTimeout(() => {
      transport.emit({ event: 'app.debugPort', params: { appId: 'app-1', wsUri: 'ws://127.0.0.1:4000/abc=/ws' } });
    }, 0);

    const handle = await appHandleP;
    expect(transport.requests[0]).toMatchObject({
      method: 'app.start',
      params: { deviceId: 'emulator-5554', target: 'lib/main.dart' },
    });
    expect(handle).toMatchObject({
      appId: 'app-1',
      wsUri: 'ws://127.0.0.1:4000/abc=/ws',
      supportsRestart: true,
    });
  });

  it('rejects when app.debugPort never arrives', async () => {
    const transport = new FakeDaemonTransport().on('app.start', async () => ({ appId: 'app-2', deviceId: 'd' }));
    const controller = new FlutterDaemonController(transport);

    await expect(controller.startApp({ deviceId: 'd' }, { debugPortTimeoutMs: 10 })).rejects.toThrow(/timed out/);
  });
});

describe('FlutterDaemonController reload/restart/stop', () => {
  async function boot(supportsRestart = true) {
    const transport = new FakeDaemonTransport()
      .on('app.start', async (_method, params) => ({
        appId: 'app-1',
        deviceId: params.deviceId,
        supportsRestart,
      }))
      .on('app.restart', async () => ({}))
      .on('app.stop', async () => ({}));
    const controller = new FlutterDaemonController(transport);
    const started = controller.startApp({ deviceId: 'd' });
    setTimeout(() => {
      transport.emit({ event: 'app.debugPort', params: { appId: 'app-1', wsUri: 'ws://x/ws' } });
    }, 0);
    await started;
    return { transport, controller };
  }

  it('reload sends app.restart with fullRestart:false', async () => {
    const { transport, controller } = await boot();

    await controller.reload('app-1');

    expect(transport.requests.at(-1)).toMatchObject({
      method: 'app.restart',
      params: { appId: 'app-1', fullRestart: false },
    });
  });

  it('restart sends app.restart with fullRestart:true', async () => {
    const { transport, controller } = await boot();

    await controller.restart('app-1');

    expect(transport.requests.at(-1)).toMatchObject({
      method: 'app.restart',
      params: { appId: 'app-1', fullRestart: true },
    });
  });

  it('restart throws when supportsRestart is false', async () => {
    const { controller } = await boot(false);

    await expect(controller.restart('app-1')).rejects.toThrow(/restart not supported/i);
  });

  it('stop sends app.stop', async () => {
    const { transport, controller } = await boot();

    await controller.stop('app-1');

    expect(transport.requests.at(-1)).toMatchObject({
      method: 'app.stop',
      params: { appId: 'app-1' },
    });
  });
});
