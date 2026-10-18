import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FlutterDaemonController } from '../../src/daemon/FlutterDaemonController.js';
import { SubprocessDaemonTransport } from '../../src/daemon/SubprocessDaemonTransport.js';

it('launches with flutter run --machine and captures debugPort emitted with app.start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-machine-launch-'));
  const script = join(root, 'flutter');
  await writeFile(script, `#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
fs.writeFileSync('args.json', JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify([{ event: 'app.start', params: { appId: 'app-1', deviceId: 'macos', supportsRestart: true } }, { event: 'app.debugPort', params: { appId: 'app-1', wsUri: 'ws://localhost:1234/token/ws' } }, { event: 'app.started', params: { appId: 'app-1' } }]) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)[0];
  process.stdout.write(JSON.stringify([{ id: request.id, result: {} }]) + '\\n');
});
`, { mode: 0o755 });
  const controller = new FlutterDaemonController(new SubprocessDaemonTransport({ flutterBin: script }));
  try {
    const app = await controller.startApp({ deviceId: 'macos', projectId: root, target: 'lib/demo.dart', flutterArgs: ['--dart-define=MODE=test'] }, { debugPortTimeoutMs: 500 });
    expect(app).toMatchObject({ appId: 'app-1', wsUri: 'ws://localhost:1234/token/ws' });
    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(join(root, 'args.json'), 'utf8'))).toEqual(['run', '--machine', '-d', 'macos', '-t', 'lib/demo.dart', '--dart-define=MODE=test']);
    await controller.reload(app.appId);
    await controller.stop(app.appId);
  } finally { await controller.dispose(); await rm(root, { recursive: true, force: true }); }
});
