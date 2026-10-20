import { expect, it } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { CloudStore, createCloudServer } from '@fliwright/cloud';
import { createHash } from 'node:crypto';
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

it.skipIf(process.platform === 'win32').each(['discover', 'run'])(
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
      [
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
      users: {},
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
      if (req.url === '/api/worker/devices' && reply.statusCode === 200)
        received();
    });
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
      ).toContain('fliwright-cloud-worker');
      const tool = join(root, 'native-tool');
      writeFileSync(
        tool,
        `#!${process.execPath}\nconst arg=process.argv[2]; console.log(arg==='-list-avds'?'Pixel_API':arg==='simctl'?JSON.stringify({devices:{}}):arg==='xcdevice'?'[]':'List of devices attached');`,
        { mode: 0o700 },
      );
      const config = join(root, 'discovery.json');
      writeFileSync(
        config,
        JSON.stringify({
          serverUrl,
          tokenEnv: 'TEST_CLOUD_DISCOVERY_TOKEN',
          deviceTools: { adb: tool, emulator: tool, xcrun: tool },
          ...(command === 'run'
            ? {
                workerId: 'host',
                slotId: 'phone',
                deviceId: 'native-device',
                root: join(root, 'worker'),
                pollMs: 500,
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
          command,
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
      expect(requested).toContain('/api/worker/devices');
      expect(
        requested.every(
          (path) =>
            path === '/api/worker/devices' ||
            (command === 'run' && path === '/api/worker/claim'),
        ),
      ).toBe(true);
      if (command === 'discover')
        expect(requested).toEqual(['/api/worker/devices']);
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
