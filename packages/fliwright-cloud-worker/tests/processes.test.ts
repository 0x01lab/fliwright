import { afterEach, expect, it } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stopOwnedProcesses, createLogTail, spawnExecution } from '../src/processes.js';
import type { ExecutionLease } from '@fliwright/cloud-protocol';
import { ManagedAppLifecycle } from '@fliwright/core';
const cleanup: Array<() => void> = [];
it('streams bounded new diagnostics and redacts credentials and VM endpoints', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-log-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const tail = createLogTail(root, ['worker-secret']);
  expect(tail()).toBeUndefined();
  writeFileSync(
    join(root, 'commands.log'),
    'x'.repeat(10000) +
      '\nAuthorization: Bearer private-token\nworker-secret\nhttp://127.0.0.1:1234/vm-token=/\n',
  );
  const first = tail()!;
  expect(first.length).toBeLessThanOrEqual(3000);
  expect(first).not.toMatch(/private-token|worker-secret|vm-token/);
  expect(tail()).toBeUndefined();
  appendFileSync(join(root, 'commands.log'), 'new diagnostic\n');
  expect(tail()).toContain('new diagnostic');
  writeFileSync(join(root, 'executor.log'), 'test output');
  expect(tail()).toContain('test output');
});
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f()),
);
it.skipIf(process.platform === 'win32')(
  'stops the owned group and refuses a reused process identity',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-process-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `process.send({ready:true});setInterval(()=>{},1000);`,
      ],
      { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    cleanup.push(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
    });
    await new Promise<void>((resolve, reject) => {
      child.once('message', () => resolve());
      child.once('error', reject);
    });
    const start = execFileSync(
      'ps',
      ['-o', 'lstart=', '-p', String(child.pid)],
      { encoding: 'utf8' },
    ).trim();
    writeFileSync(
      join(root, 'process.json'),
      JSON.stringify({ pid: child.pid, start: 'different process' }),
    );
    await expect(stopOwnedProcesses(root)).rejects.toThrow(
      /identity|ambiguous/i,
    );
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
    writeFileSync(
      join(root, 'process.json'),
      JSON.stringify({ pid: child.pid, start }),
    );
    await stopOwnedProcesses(root);
    expect(() => process.kill(child.pid!, 0)).toThrow();
  },
);

it('passes the private native grant to a real executor which requests fresh endpoints directly from the retained owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-native-ipc-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const entry = join(root, 'child.mjs'), resultPath = join(root, 'result.json');
  writeFileSync(entry, `
    import {writeFileSync} from 'node:fs';
    import {prepareManagedAppAttempt} from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
    process.on('message', async message=>{
      if(message.go)process.send({nativeOwnership:{id:'request',project:${JSON.stringify(join(root, 'checkout/app'))}}});
      if(message.nativeOwnershipReply){
        const r=message.nativeOwnershipReply;
        const first=await prepareManagedAppAttempt(r.grant.managedAppControl,{attemptKey:'first'});
        const retry=await prepareManagedAppAttempt(r.grant.managedAppControl,{attemptKey:'retry'});
        writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({verdict:r.ok&&r.grant?.delegation?.token===${JSON.stringify('b'.repeat(64))}&&first.url!==retry.url&&first.generation!==retry.generation?'passed':'failed'}));
        process.exit(0);
      }
    });
  `);
  const requests: string[] = [];
  const lifecycle = new ManagedAppLifecycle({ async prepare(request) {
    requests.push(request.attemptKey); return { url: `ws://127.0.0.1:${1234 + requests.length}/auth=/ws` };
  } });
  const managedAppControl = await lifecycle.start();
  const lease = { request: { target: { projectPath: 'app' } } } as ExecutionLease;
  try {
  const result = await spawnExecution(lease, root, new AbortController().signal, () => {}, {
    mainFile: entry, flutterBin: 'flutter', resetCommands: [],
    prepareNative: async project => {
      expect(project).toBe(join(root, 'checkout/app'));
      return { delegation: { rootDir: '/lease', key: 'a'.repeat(64), token: 'b'.repeat(64) }, managedAppControl };
    },
  });
  expect(result.verdict).toBe('passed');
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(join(root, 'job.json'), 'utf8')).not.toContain('b'.repeat(64));
  expect(readFileSync(join(root, 'job.json'), 'utf8')).not.toContain(managedAppControl.token);
  expect(readFileSync(resultPath, 'utf8')).not.toContain(managedAppControl.token);
  expect(requests).toEqual(['first', 'retry']);
  } finally { await lifecycle.dispose(); }
}, 15000);

it('routes real executor attempt preparation through the retained supervisor and cancels before allowing reuse', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-native-preparation-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const entry = join(root, 'child.mjs'), resultPath = join(root, 'result.json');
  const project = join(root, 'checkout/app');
  writeFileSync(entry, `
    import {writeFileSync,watch} from 'node:fs';
    const project=${JSON.stringify(project)};
    const watcher=watch(${JSON.stringify(root)},(_event,name)=>{
      if(name==='preparation-entered'){
        watcher.close();
        process.send({nativePreparationCancel:{id:'cancelled'}});
      }
    });
    process.on('message', message=>{
      if(message.go)process.send({nativePreparation:{id:'first',project,request:{attemptKey:'first'}}});
      const reply=message.nativePreparationReply;
      if(reply?.id==='first'&&reply.ok){
        process.send({nativePreparation:{id:'cancelled',project,request:{attemptKey:'cancelled'}}});
      }
      if(reply?.id==='cancelled')process.send({nativePreparation:{id:'late',project,request:{attemptKey:'late'}}});
      if(reply?.id==='late'){
        writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({verdict:reply.ok?'failed':'passed'}));
        process.exit(0);
      }
    });
  `);
  const calls: string[] = [];
  // The child cannot forge a successful preparation response; it only sends an identity.
  const result = await spawnExecution({ request: { target: { projectPath: 'app' } } } as ExecutionLease, root,
    new AbortController().signal, () => {}, {
      mainFile: entry, flutterBin: 'flutter', resetCommands: [],
      prepareNativeAttempt: async (selected, request, signal) => {
        expect(selected).toBe(project); calls.push(request.attemptKey);
        if (request.attemptKey === 'cancelled') {
          await new Promise<void>(resolve => {
            signal.addEventListener('abort', () => { calls.push('stopped'); resolve(); }, { once: true });
            signal.throwIfAborted();
            writeFileSync(join(root, 'preparation-entered'), 'ready');
          });
        }
      },
    });
  expect(result.verdict).toBe('passed');
  expect(calls).toEqual(['first', 'cancelled', 'stopped']);
}, 15000);
it.skipIf(process.platform === 'win32')(
  'lets the executor persist cancellation evidence before terminating the group',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-graceful-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const marker = join(root, 'partial.json');
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
    import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
    const runner=spawn(process.execPath,['--input-type=module','--eval',"process.on('SIGTERM',()=>process.exit(99));process.on('message',()=>process.exit(42));process.send({ready:true});setInterval(()=>{},1000);"],{stdio:['ignore','ignore','ignore','ipc']});
    process.on('SIGTERM',()=>{runner.once('exit',(code)=>{writeFileSync(${JSON.stringify(marker)},JSON.stringify({code}));process.exit(0);});runner.send({abort:true});});
    runner.once('message',()=>process.send({ready:true}));setInterval(()=>{},1000);
  `,
      ],
      { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    cleanup.push(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
    });
    await new Promise<void>((resolve, reject) => {
      child.once('message', () => resolve());
      child.once('error', reject);
    });
    const start = execFileSync(
      'ps',
      ['-o', 'lstart=', '-p', String(child.pid)],
      { encoding: 'utf8' },
    ).trim();
    writeFileSync(
      join(root, 'process.json'),
      JSON.stringify({ pid: child.pid, start }),
    );
    await stopOwnedProcesses(root);
    expect(
      JSON.parse((await import('node:fs')).readFileSync(marker, 'utf8')).code,
    ).toBe(42);
  },
);
