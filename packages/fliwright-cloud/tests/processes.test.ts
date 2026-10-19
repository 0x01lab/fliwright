import { afterEach, expect, it } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stopOwnedProcesses, createLogTail } from '../src/processes.js';
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
