import { expect, it, vi } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { CloudStore, createCloudServer } from '@fliwright/cloud';
import { createHash } from 'node:crypto';
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

it('registers the fliwright-worker executable', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { bin?: Record<string, string> };

  expect(manifest.bin).toEqual({ 'fliwright-worker': 'fliwright-worker' });
  const executable = fileURLToPath(new URL('../fliwright-worker', import.meta.url));
  expect(statSync(executable).mode & 0o111).not.toBe(0);
});

it.skipIf(process.platform === 'win32').each(['discover', 'run', 'host'])(
  '%s reports a host without loading Cloud Server and shuts down cleanly',
  async (command) => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-discover-command-'));
    const store = new CloudStore(join(root, 'db'));
    store.configure(
      [
        {
          id: 'app',
          name: 'App',
          repository: '/synthetic/app',
          suites: { smoke: '*.test.ts' },
          scenarios: ['clean'],
        },
      ],
      command !== 'run' ? [] : [
        {
          id: 'host',
          slots:
            command === 'run'
              ? [{ id: 'phone', deviceId: 'native-device', targets: ['app'] }]
              : [],
        },
      ],
    );
    const server = createCloudServer({
      store,
      dataRoot: join(root, 'reports'),
      publicUrl: 'http://localhost',
      proxySecret: 'test-proxy',
      publicationSecret: 'test-publication',
      users: { admin: 'admin' },
      ciTokens: [],
      workerTokens: [
        { workerId: 'host', hash: digest('test-discovery-token') },
      ],
      minFreeBytes: 0,
    });
    const requested: string[] = [];
    let received!: () => void;
    const reported = new Promise<void>((resolve) => {
      received = resolve;
    });
    server.addHook('onResponse', async (req, reply) => {
      requested.push(req.url);

    });
    const report = store.recordDeviceInventory.bind(store);
    vi.spyOn(store, 'recordDeviceInventory').mockImplementation((...args) => { report(...args); received(); });
    const claim = vi.spyOn(store, 'claim');
    const scanClaim = vi.spyOn(store, 'claimCatalogScan');
    const serverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    let child: ReturnType<typeof spawn> | undefined;
    try {
      writeFileSync(join(root, 'package.json'), '{"type":"module"}');
      symlinkSync(
        fileURLToPath(new URL('../node_modules', import.meta.url)),
        join(root, 'node_modules'),
      );
      const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
      for (const name of readdirSync(sourceRoot).filter((name) =>
        name.endsWith('.ts'),
      )) {
        writeFileSync(
          join(root, name.replace(/\.ts$/, '.js')),
          ts.transpileModule(readFileSync(join(sourceRoot, name), 'utf8'), {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ES2022,
            },
          }).outputText,
        );
      }
      writeFileSync(
        join(root, 'isolate.mjs'),
        `import { registerHooks } from 'node:module';
        registerHooks({ resolve(specifier, context, next) {
          if (specifier === '@fliwright/cloud' || specifier === 'node:sqlite' || specifier === 'fastify' || specifier === 'react')
            throw new Error('Worker cannot load Cloud Server: ' + specifier);
          return next(specifier, context);
        }});`,
      );
      expect(
        execFileSync(
          process.execPath,
          [
            '--import',
            join(root, 'isolate.mjs'),
            join(root, 'main.js'),
            '--help',
          ],
          { encoding: 'utf8' },
        ),
      ).toContain('fliwright-worker');
      expect(
        execFileSync(
          process.execPath,
          ['--import', join(root, 'isolate.mjs'), join(root, 'main.js')],
          { encoding: 'utf8' },
        ),
      ).toContain('Usage: fliwright-worker');
      const tool = join(root, 'native-tool');
      writeFileSync(
        tool,
        `#!${process.execPath}\nconst arg=process.argv[2]; console.log(arg==='-list-avds'?'Pixel_API':arg==='simctl'?JSON.stringify({devices:{}}):arg==='xcdevice'?'[]':'List of devices attached');`,
        { mode: 0o700 },
      );
      let pairedConfig: Record<string, unknown> | undefined;
      if (command === 'discover' || command === 'host') {
        const response = await server.inject({ method: 'POST', url: '/api/worker-pairings', headers: { 'x-cloud-proxy-secret': 'test-proxy', 'x-cloud-user': 'admin', origin: 'http://localhost' }, payload: { workerId: 'host' } });
        expect(response.statusCode).toBe(200);
        const pairDirectory = join(root, 'paired');
        const pairing = spawn(process.execPath, ['--import', join(root, 'isolate.mjs'), join(root, 'main.js'), 'pair', serverUrl, pairDirectory], { stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        pairing.stdout.on('data', data => { output += data; });
        pairing.stderr.on('data', data => { output += data; });
        const exit = once(pairing, 'exit');
        pairing.stdin.end(response.json().code + '\n');
        expect(await exit).toEqual([0, null]);
        pairedConfig = JSON.parse(readFileSync(join(pairDirectory, 'worker.json'), 'utf8'));
        const saved = JSON.parse(readFileSync(join(pairDirectory, 'credentials.json'), 'utf8'));
        expect(saved.workerId).toBe('host');
        expect(output).toContain('配对成功');
        expect(output).not.toContain(saved.token);
        expect(output).not.toContain(response.json().code);
        expect(statSync(join(pairDirectory, 'credentials.json')).mode & 0o777).toBe(0o600);
        requested.length = 0;
      }
      const config = join(root, 'discovery.json');
      writeFileSync(
        config,
        JSON.stringify({
          serverUrl,
          ...(pairedConfig ?? { tokenEnv: 'TEST_CLOUD_DISCOVERY_TOKEN' }),
          deviceTools: { adb: tool, emulator: tool, xcrun: tool },
          ...(command === 'run'
            ? {
                workerId: 'host',
                slotId: 'phone',
                deviceId: 'native-device',
                root: join(root, 'worker'),
                resetCommands: [
                  { program: 'must-not-reset-without-a-task', args: [] },
                ],
              }
            : {}),
        }),
      );
      child = spawn(
        process.execPath,
        [
          '--import',
          join(root, 'isolate.mjs'),
          join(root, 'main.js'),
          command === 'host' ? 'run' : command,
          config,
        ],
        {
          env: {
            ...process.env,
            TEST_CLOUD_DISCOVERY_TOKEN: 'test-discovery-token',
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
      let stderr = '';
      child.stderr!.on('data', (data) => {
        stderr += data;
      });
      await Promise.race([
        reported,
        once(child, 'exit').then(() => {
          throw new Error(`Discovery exited before reporting: ${stderr}`);
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Discovery did not report')),
            5000,
          ).unref(),
        ),
      ]);
      expect(store.listDevices()[0]).toMatchObject({
        workerId: 'host',
        settings: { managed: false },
        observation: { avdName: 'Pixel_API', state: 'shutdown' },
      });
      // Device inventory and task control use WSS; no repeated HTTP control requests.
      expect(requested).toEqual([]);
      if (command === 'discover') {
        expect(claim).not.toHaveBeenCalled();
        expect(scanClaim).not.toHaveBeenCalled();
      } else {
        // Let initial inventory/connection notifications settle, then cross the old 2s polling interval.
        await delay(100);
        const calls = [claim.mock.calls.length, scanClaim.mock.calls.length];
        await delay(2200);
        expect([claim.mock.calls.length, scanClaim.mock.calls.length]).toEqual(calls);
      }
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      expect(await exited).toEqual([0, null]);
    } finally {
      if (child?.exitCode === null) child.kill('SIGKILL');
      await server.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
