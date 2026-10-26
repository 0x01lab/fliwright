import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore, createCloudServer } from '@fliwright/cloud';
import { WorkerControlClient } from '@fliwright/cloud-protocol';
import { createHash } from 'node:crypto';
import { reportWorkerDevices } from '../src/device-reporting.js';

it.skipIf(process.platform === 'win32')('propagates native attach/detach through Worker WS to browser events without waiting for reconciliation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-device-events-'));
  const store = new CloudStore(join(root, 'db'));
  store.configure([], [{ id: 'host', slots: [] }]);
  const server = createCloudServer({ store, dataRoot: join(root, 'reports'), publicUrl: 'https://cloud.test',
    proxySecret: 'proxy', publicationSecret: 'publication', users: { alice: 'member' }, ciTokens: [],
    workerTokens: [{ workerId: 'host', hash: createHash('sha256').update('synthetic-token').digest('hex') }], minFreeBytes: 0 });
  const url = await server.listen({ host: '127.0.0.1', port: 0 });
  const client = new WorkerControlClient(url, 'synthetic-token');
  const controller = new AbortController();
  const connection = new AbortController();
  let reporting: Promise<void> | undefined;
  try {
    const state = join(root, 'state');
    const tool = join(root, 'device-tool');
    writeFileSync(state, 'device');
    writeFileSync(tool, `#!${process.execPath}
const fs = require('node:fs');
const state = ${JSON.stringify(state)};
const arg = process.argv[2];
if (arg === 'track-devices') {
  process.stdout.write('initial\\n');
  fs.watch(state, () => process.stdout.write('changed\\n'));
} else if (arg === 'devices') {
  console.log('List of devices attached\\n' + (fs.readFileSync(state, 'utf8') === 'device' ? 'usb-1 device model:Phone' : ''));
} else if (arg === 'xcdevice' && process.argv[3] === 'observe') {
  setInterval(() => {}, 10000);
} else if (arg === 'xcdevice') console.log('[]');
else if (arg === 'simctl') console.log('{"devices":{}}');
else if (arg !== '-list-avds') console.log('15');
`, { mode: 0o700 });
    await client.ready();
    const headers = { 'x-cloud-proxy-secret': 'proxy', 'x-cloud-user': 'alice' };
    const response = await fetch(`${url}/api/device-events`, { headers, signal: connection.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read(); // Initial reconciliation notification.
    reporting = reportWorkerDevices(client, { signal: controller.signal, intervalMs: 60000,
      tools: { adb: tool, emulator: tool, xcrun: tool } });
    const waitForPresence = async (present: boolean) => {
      const timeout = setTimeout(() => connection.abort(), 5000);
      try {
        do {
          const result = await reader.read();
          expect(result.done).toBe(false);
          const devices = (await server.inject({ url: '/api/devices', headers })).json();
          if (devices[0]?.present === present) return;
        } while (true);
      } finally { clearTimeout(timeout); }
    };
    await waitForPresence(true);
    writeFileSync(state, 'disconnected');
    await waitForPresence(false);
    writeFileSync(state, 'device');
    await waitForPresence(true);
    controller.abort();
    await reporting;
    await reader.cancel();
  } finally {
    controller.abort();
    connection.abort();
    await reporting;
    client.close();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
