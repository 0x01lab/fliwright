import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { withFlutterAndroidApk } from '../src/FlutterAndroidBuild.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(options: { behavior?: string; config?: object; nested?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flutter-android-build-'))); roots.push(root);
  const project = options.nested ? join(root, 'apps/app') : root;
  await mkdir(join(project, 'lib'), { recursive: true });
  await mkdir(join(project, 'android'), { recursive: true });
  await writeFile(join(project, 'pubspec.yaml'), 'name: fixture\n');
  await writeFile(join(project, 'lib/main.dart'), 'void main() {}');
  const calls = join(root, 'calls.jsonl'), flutterBin = join(root, 'flutter.mjs');
  await writeFile(flutterBin, `#!${process.execPath}
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(calls)},JSON.stringify({args,cwd:process.cwd()})+'\\n');
if(args[0]==='config'){console.log(${JSON.stringify(JSON.stringify(options.config ?? {}))});process.exit(0);}
const flavor=args.find(a=>a.startsWith('--flavor='))?.slice(9)?.toLowerCase();
const output=join(process.cwd(),${JSON.stringify((options.config as Record<string, string> | undefined)?.['build-dir'] ?? 'build')},'app/outputs/flutter-apk');
${options.behavior ?? `mkdirSync(output,{recursive:true});writeFileSync(join(output,'app'+(flavor?'-'+flavor:'')+'-debug.apk'),Buffer.from('PK\\x03\\x04fresh-apk'));`}
`);
  await chmod(flutterBin, 0o700);
  return { root, project, flutterBin, calls, input: { projectRoot: root, target: options.nested ? 'apps/app/lib/main.dart' : 'lib/main.dart', flutterBin,
    timeoutMs: 4000, cleanupTimeoutMs: 2500 } };
}

it('builds a nested Debug app without installation and keeps an immutable APK until the consumer finishes', async () => {
  const f = await fixture({ nested: true, config: { 'build-dir': 'out' } });
  let staged = '';
  const result = await withFlutterAndroidApk({ ...f.input, flutterArgs: ['--flavor=QA', '--dart-define=VALUE=$(never-run)`literal`', '--no-pub'] }, async apk => {
    staged = apk.apkPath;
    const bytes = await readFile(staged);
    expect(apk).toMatchObject({ projectDirectory: f.project, target: 'lib/main.dart', flavor: 'QA', bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') });
    expect((await stat(dirname(staged))).mode & 0o777).toBe(0o700);
    expect((await stat(staged)).mode & 0o777).toBe(0o600);
    await writeFile(join(f.project, 'out/app/outputs/flutter-apk/app-qa-debug.apk'), 'replaced output');
    expect(await readFile(staged)).toEqual(bytes);
    return 'consumed';
  });
  expect(result).toBe('consumed');
  await expect(stat(staged)).rejects.toMatchObject({ code: 'ENOENT' });
  const calls = (await readFile(f.calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(calls).toEqual([
    { args: ['config', '--machine'], cwd: f.project },
    { args: ['build', 'apk', '--debug', '--target=lib/main.dart', '--flavor=QA', '--dart-define=VALUE=$(never-run)`literal`', '--no-pub'], cwd: f.project },
  ]);
});

it.each(['--release', '--profile', '--split-per-abi', '--config-only', '--output-dir=/tmp/output', '--target=other.dart', '-d', '--debug'])
  ('rejects incompatible or ambiguous build arguments before spawning: %s', async arg => {
    const f = await fixture();
    await expect(withFlutterAndroidApk({ ...f.input, flutterArgs: [arg] }, async () => {})).rejects.toThrow('build arguments');
    await expect(stat(f.calls)).rejects.toMatchObject({ code: 'ENOENT' });
  });

it('rejects an entry symlink outside the configured project before spawning', async () => {
  const f = await fixture();
  const external = await fixture();
  await symlink(join(external.project, 'lib/main.dart'), join(f.project, 'lib/escape.dart'));
  await expect(withFlutterAndroidApk({ ...f.input, target: 'lib/escape.dart' }, async () => {})).rejects.toThrow('escapes');
  await expect(stat(f.calls)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['../outside', '/tmp/outside'])('refuses a Flutter build directory outside its package: %s', async buildDir => {
  const f = await fixture({ config: { 'build-dir': buildDir } });
  await expect(withFlutterAndroidApk(f.input, async () => {})).rejects.toThrow('build directory');
  const calls = (await readFile(f.calls, 'utf8')).trim().split('\n');
  expect(calls).toHaveLength(1);
});

it.each(['missing', 'stale', 'symlink', 'failure', 'oversized'] as const)('does not hand an unproven APK to installation: %s', async kind => {
  const behavior = kind === 'failure' ? "process.stderr.write('private-build-input');process.exit(2);" : kind === 'oversized'
    ? "mkdirSync(output,{recursive:true});const {truncateSync}=await import('node:fs');const path=join(output,'app-debug.apk');writeFileSync(path,'x');truncateSync(path,513*1024*1024);" : '';
  const f = await fixture({ behavior });
  const output = join(f.project, 'build/app/outputs/flutter-apk');
  if (kind === 'stale' || kind === 'symlink') {
    await mkdir(output, { recursive: true });
    if (kind === 'stale') await writeFile(join(output, 'app-debug.apk'), 'stale');
    else await symlink(join(f.project, 'pubspec.yaml'), join(output, 'app-debug.apk'));
  }
  let consumed = false;
  await expect(withFlutterAndroidApk(f.input, async () => { consumed = true; })).rejects.toThrow();
  expect(consumed).toBe(false);
});

it('removes its staged artifact when installation or its consumer fails', async () => {
  const f = await fixture(); let path = '';
  await expect(withFlutterAndroidApk(f.input, async apk => { path = apk.apkPath; throw Error('installation failed'); })).rejects.toThrow('installation failed');
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('selects a fresh default-flavor output without assuming app-debug.apk', async () => {
  const f = await fixture({ behavior: "mkdirSync(output,{recursive:true});writeFileSync(join(output,'app-development-debug.apk'),'default flavor');" });
  const output = join(f.project, 'build/app/outputs/flutter-apk');
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'app-debug.apk'), 'stale unrelated flavor');
  await withFlutterAndroidApk(f.input, async apk => {
    expect(apk.flavor).toBe('development');
    expect(await readFile(apk.apkPath, 'utf8')).toBe('default flavor');
  });
});

it('rejects ambiguous fresh variant outputs before selecting any APK', async () => {
  const f = await fixture({ behavior: "mkdirSync(output,{recursive:true});for(const flavor of ['one','two'])writeFileSync(join(output,'app-'+flavor+'-debug.apk'),'ambiguous');" });
  await expect(withFlutterAndroidApk(f.input, async () => {})).rejects.toThrow('single fresh APK');
});

it.each(['cancel', 'timeout', 'output'] as const)('terminates the owned process group before rejecting %s', async kind => {
  const f = await fixture({ behavior: `
const {spawn}=await import('node:child_process');
const child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{stdio:'ignore'});
writeFileSync(${JSON.stringify('child.json')},JSON.stringify({parent:process.pid,child:child.pid}));
process.on('SIGTERM',()=>{child.kill('SIGTERM');child.once('exit',()=>process.exit(0));});
${kind === 'output' ? "process.stdout.write('x'.repeat(5*1024*1024));" : ''}
setInterval(()=>{},1000);
` });
  const abort = new AbortController();
  const work = withFlutterAndroidApk({ ...f.input, signal: abort.signal, timeoutMs: kind === 'timeout' ? 3000 : 10000 }, async () => { throw Error('must not consume'); });
  const observed = work.catch(error => error as Error);
  // Poll the actual child identity written only after dispatch; do not infer from a timer.
  let pids: { parent: number; child: number } | undefined;
  const deadline = Date.now() + 4000;
  while (!pids && Date.now() < deadline) {
    pids = await readFile(join(f.project, 'child.json'), 'utf8').then(JSON.parse, () => undefined);
    if (!pids) await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(pids).toBeDefined();
  if (kind === 'cancel') abort.abort();
  const error = await observed;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toMatch(/cancelled|deadline|output limit/);
  for (const pid of [pids!.parent, pids!.child]) expect(() => process.kill(pid, 0)).toThrow();
}, 10000);

it('serializes builds of the canonical package while allowing consumption of a private copy during its successor', async () => {
  const f = await fixture({ behavior: `await new Promise(resolve=>setTimeout(resolve,80));
    mkdirSync(output,{recursive:true});writeFileSync(join(output,'app-debug.apk'),String(Date.now()));` });
  const alias = join(f.root, 'alias'); await symlink(f.project, alias);
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  let firstPath = '';
  const first = withFlutterAndroidApk(f.input, async apk => { firstPath = apk.apkPath; entered(); await held; });
  try {
    await started;
    await withFlutterAndroidApk({ ...f.input, projectRoot: alias }, async apk => {
      expect(apk.apkPath).not.toBe(firstPath);
      expect((await stat(firstPath)).isFile()).toBe(true);
    });
  } finally { finish(); await first; }
  const calls = (await readFile(f.calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line).args[0]);
  expect(calls).toEqual(['config', 'build', 'config', 'build']);
});

it('waits for concurrent builds instead of treating a just-created lock as an abandoned owner', async () => {
  const f = await fixture({ behavior: `await new Promise(resolve=>setTimeout(resolve,80));
    mkdirSync(output,{recursive:true});writeFileSync(join(output,'app-debug.apk'),String(Date.now()));` });
  await Promise.all(Array.from({ length: 3 }, () => withFlutterAndroidApk(f.input, async () => {})));
  const calls = (await readFile(f.calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line).args[0]);
  expect(calls).toEqual(['config', 'build', 'config', 'build', 'config', 'build']);
});

it('retains a durable process checkpoint and refuses reuse after unconfirmed process-group cleanup', async () => {
  const f = await fixture();
  const lock = join(homedir(), '.fliwright/android-build-locks', createHash('sha256').update(f.project).digest('hex') + '.lock');
  const kill = process.kill.bind(process);
  const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid < 0) throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    return kill(pid, signal);
  });
  try {
    await expect(withFlutterAndroidApk(f.input, async () => {})).rejects.toMatchObject({ code: 'BUILD_CLEANUP_UNCONFIRMED', cleanupConfirmed: false });
    const record = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
    expect(record).toMatchObject({ ownerPid: process.pid, cleanupUnconfirmed: true });
    expect(record.childPid).toBeGreaterThan(1);
    spy.mockRestore();
    await expect(withFlutterAndroidApk(f.input, async () => {})).rejects.toThrow('cleanup is unconfirmed');
    expect((await readFile(f.calls, 'utf8')).trim().split('\n')).toHaveLength(1);
  } finally { spy.mockRestore(); await rm(lock, { recursive: true, force: true }); }
});

it('confirms descendant termination even when the successful build leader exits first', async () => {
  const f = await fixture({ behavior: `
const {spawn}=await import('node:child_process');
const child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{stdio:'ignore'});
writeFileSync('descendant.json',JSON.stringify({pid:child.pid}));
mkdirSync(output,{recursive:true});writeFileSync(join(output,'app-debug.apk'),'fresh');
child.unref();process.exit(0);
` });
  let pid: number | undefined;
  try {
    await withFlutterAndroidApk(f.input, async () => {
      pid = JSON.parse(await readFile(join(f.project, 'descendant.json'), 'utf8')).pid;
      expect(() => process.kill(pid!, 0)).toThrow();
    });
  } finally {
    pid ??= await readFile(join(f.project, 'descendant.json'), 'utf8').then(text => JSON.parse(text).pid, () => undefined);
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
});

it('escalates termination for a build that ignores SIGTERM and confirms exit before returning', async () => {
  const f = await fixture({ behavior: "writeFileSync('hung.json',JSON.stringify({pid:process.pid}));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);" });
  const controller = new AbortController();
  const work = withFlutterAndroidApk({ ...f.input, signal: controller.signal, timeoutMs: 10000 }, async () => {});
  const observed = work.catch(error => error as Error);
  let pid: number | undefined;
  try {
    const deadline = Date.now() + 4000;
    while (!pid && Date.now() < deadline) {
      pid = await readFile(join(f.project, 'hung.json'), 'utf8').then(text => JSON.parse(text).pid, () => undefined);
      if (!pid) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(pid).toBeDefined(); controller.abort();
    expect(await observed).toMatchObject({ code: 'BUILD_CANCELLED', cleanupConfirmed: true });
    expect(() => process.kill(pid!, 0)).toThrow();
  } finally { controller.abort(); await observed; if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } }
});

it('does not expose build output or input secrets when the command fails', async () => {
  const f = await fixture({ behavior: "process.stderr.write('secret-token-and-build-parameters');process.exit(1);" });
  const error = await withFlutterAndroidApk({ ...f.input, flutterArgs: ['--dart-define=SECRET=secret-token-and-build-parameters'] }, async () => {})
    .then(() => undefined, error => error as Error);
  expect(error).toBeInstanceOf(Error);
  expect(error!.message).not.toContain('secret-token-and-build-parameters');
  expect(error!.stack).not.toContain('secret-token-and-build-parameters');
});
