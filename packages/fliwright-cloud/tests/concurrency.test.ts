import { afterEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { CloudStore } from '../src/CloudStore.js';
const cleanup: Array<() => void> = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f()),
);
it('two OS processes racing to claim the same SQLite slot cannot both execute', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-race-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  symlinkSync(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(root, 'node_modules'),
  );
  for (const name of ['CloudStore', 'contracts'])
    writeFileSync(
      join(root, `${name}.js`),
      ts.transpileModule(
        readFileSync(
          fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)),
          'utf8',
        ),
        {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        },
      ).outputText,
    );
  const store = new CloudStore(join(root, 'db'));
  cleanup.push(() => store.close());
  store.configure(
    [
      {
        id: 'app',
        name: 'App',
        repository: '/app',
        suites: { smoke: '*.test.ts' },
        scenarios: ['clean'],
      },
    ],
    [
      {
        id: 'mac',
        slots: [{ id: 'ios', deviceId: 'device', targets: ['app'] }],
      },
    ],
  );
  const request = store.submit(
    {
      targetId: 'app',
      commit: 'a'.repeat(40),
      suite: 'smoke',
      scenario: 'clean',
    },
    'alice',
    'key',
  );
  const script = `import { CloudStore } from ${JSON.stringify(pathToFileURL(join(root, 'CloudStore.js')).href)};
    const store=new CloudStore(${JSON.stringify(join(root, 'db'))});process.send({ready:true});
    process.once('message',()=>{const lease=store.claim('mac','ios');store.close();process.send({id:lease?.request.id??null},()=>process.disconnect());});`;
  const children = Array.from({ length: 2 }, () =>
    spawn(process.execPath, ['--input-type=module', '--eval', script], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    }),
  );
  cleanup.push(() =>
    children.forEach((c) => {
      if (c.exitCode === null) c.kill('SIGKILL');
    }),
  );
  await Promise.all(
    children.map(
      (c) =>
        new Promise<void>((resolve, reject) => {
          c.once('message', () => resolve());
          c.once('error', reject);
        }),
    ),
  );
  const results = children.map(
    (c) =>
      new Promise<string | null>((resolve, reject) => {
        c.once('message', (v: any) => resolve(v.id));
        c.once('error', reject);
      }),
  );
  children.forEach((c) => c.send({ go: true }));
  expect((await Promise.all(results)).filter(Boolean)).toEqual([request.id]);
  expect(store.attempts(request.id)).toHaveLength(1);
});
