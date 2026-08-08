import { describe, expect, it } from 'vitest';
import { FlutterDaemonEndpointSource } from '../../src/daemon/FlutterDaemonEndpointSource.js';
import { FlutterDaemonController } from '../../src/daemon/FlutterDaemonController.js';
import { FakeDaemonTransport } from './FakeDaemonTransport.js';

describe('FlutterDaemonEndpointSource', () => {
  it('correlates the endpoint with the app started on the requested device', async () => {
    const transport = new FakeDaemonTransport().on('app.start', async () => ({ appId: 'app-1', deviceId: 'sim-1' }));
    const controller = new FlutterDaemonController(transport);
    const source = new FlutterDaemonEndpointSource({ controller, deviceId: 'sim-1' });
    const pending = source.acquire();
    setTimeout(() => transport.emit({ event: 'app.debugPort', params: { appId: 'app-1', wsUri: 'ws://127.0.0.1:4000/token=/ws' } }), 0);

    await expect(pending).resolves.toMatchObject({
      appId: 'app-1',
      deviceId: 'sim-1',
      url: 'ws://127.0.0.1:4000/token=/ws',
      scope: 'execution-worker',
      source: 'flutter-daemon',
    });
  });

  it('rejects release-mode launches before starting the app', async () => {
    const transport = new FakeDaemonTransport();
    const source = new FlutterDaemonEndpointSource({
      controller: new FlutterDaemonController(transport),
      deviceId: 'sim-1',
      flutterArgs: ['--release'],
    });

    await expect(source.acquire()).rejects.toThrow(/release mode/i);
    expect(transport.requests).toHaveLength(0);
  });
});
