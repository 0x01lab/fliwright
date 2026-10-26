import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import ts from 'typescript';
import { loadServerConfig } from '../src/config.js';

let root: string;
let cli: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cloud startup '));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'));
  const source = fileURLToPath(new URL('../src', import.meta.url));
  for (const name of readdirSync(source).filter((name) => name.endsWith('.ts'))) {
    writeFileSync(join(root, name.replace(/\.ts$/, '.js')), ts.transpileModule(readFileSync(join(source, name), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText);
  }
  cli = join(root, 'main.js');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(args: string[], cwd = root, env: NodeJS.ProcessEnv = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd, env: { ...process.env, FLIWRIGHT_CLOUD_CONFIG: '', ...env }, encoding: 'utf8', stdio: 'pipe',
  });
}

it('provides help without configuration and initializes a private, repeat-safe local installation', () => {
  expect(run(['--help'])).toContain('init');
  expect(run(['init'])).toContain('server.json');
  const path = join(root, '.fliwright/cloud/server.json');
  const original = readFileSync(path, 'utf8');
  const config = JSON.parse(original);
  expect(config).toMatchObject({ host: '127.0.0.1', localUser: 'local', dataRoot: './data', users: { local: 'admin' } });
  expect(config.publicationSecret.length).toBeGreaterThanOrEqual(32);
  if (process.platform !== 'win32') {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, '.fliwright/cloud')).mode & 0o777).toBe(0o700);
  }
  expect(() => run(['init'])).toThrow();
  expect(readFileSync(path, 'utf8')).toBe(original);
});

it('starts from another working directory using an env-selected config and shuts down cleanly', async () => {
  const directory = join(root, 'separate deployment');
  run(['init', directory]);
  const path = join(directory, 'server.json');
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as import('node:net').AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const config = JSON.parse(readFileSync(path, 'utf8'));
  Object.assign(config, { port, publicUrl: `http://127.0.0.1:${port}` });
  writeFileSync(path, JSON.stringify(config));
  const child: ChildProcess = spawn(process.execPath, [cli, 'server'], {
    cwd: tmpdir(), env: { ...process.env, FLIWRIGHT_CLOUD_CONFIG: path }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout!.on('data', (chunk) => { output += chunk; });
  child.stderr!.on('data', (chunk) => { output += chunk; });
  try {
    await expect.poll(() => output, { timeout: 8000 }).toContain('listening');
    expect(run(['health'], tmpdir(), { FLIWRIGHT_CLOUD_CONFIG: path })).toContain('ok');
    const response = await fetch(`${config.publicUrl}/api/me`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'local', role: 'admin' });
    expect(statSync(join(directory, 'data/cloud.sqlite')).isFile()).toBe(true);
    child.kill('SIGTERM');
    expect((await exited)[0]).toBe(0);
    expect(() => run(['health', path])).toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
});

it('rejects unknown commands without creating data or requiring a config', () => {
  try { run(['typo']); throw new Error('Expected CLI rejection'); }
  catch (error) {
    expect(String((error as { stderr?: string }).stderr)).toContain('Unknown cloud command');
  }
});

it('prefers an explicit server config over the environment', () => {
  const directory = join(root, 'config precedence');
  run(['init', directory]);
  const path = join(directory, 'server.json');
  const previous = process.env.FLIWRIGHT_CLOUD_CONFIG;
  process.env.FLIWRIGHT_CLOUD_CONFIG = join(root, 'missing-server.json');
  try { expect(loadServerConfig(path).dataRoot).toBe(join(directory, 'data')); }
  finally {
    if (previous === undefined) delete process.env.FLIWRIGHT_CLOUD_CONFIG;
    else process.env.FLIWRIGHT_CLOUD_CONFIG = previous;
  }
});
