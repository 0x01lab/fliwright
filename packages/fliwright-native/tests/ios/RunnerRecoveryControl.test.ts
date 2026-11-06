import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RunnerRecoveryClient } from '../../src/ios/RunnerRecoveryClient.js';

// Compiles the same Foundation/Network/CryptoKit source used by the iOS Runner.
// Host execution proves the Swift protocol, independently of XCTest UI operations.
describe.skipIf(process.platform !== 'darwin')('Swift Runner recovery control', () => {
  let root: string, executable: string;
  const children: ChildProcess[] = [];
  const base = { sessionId: '00000000-0000-4000-8000-000000000001', generation: '00000000-0000-4000-8000-000000000002',
    deviceId: '00000000-0000-4000-8000-000000000003', simulatorBootedAt: '2026-11-04T02:00:00.000Z' };
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'swift-runner-control-'));
    executable = join(root, 'control');
    const main = join(root, 'main.swift');
    await writeFile(main, `
import Foundation
let environment = ProcessInfo.processInfo.environment
let control = try RunnerRecoveryControl(identity: .init(
  sessionId: environment["SESSION"]!, generation: environment["GENERATION"]!, deviceId: environment["DEVICE"]!,
  simulatorBootedAt: environment["BOOT"]!, runnerPid: Int(ProcessInfo.processInfo.processIdentifier)),
  key: environment["KEY"]!, onShutdown: {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { exit(0) }
  })
control.start { result in
  switch result {
  case .success(let port):
    let ready = try! JSONSerialization.data(withJSONObject: ["port": port, "pid": ProcessInfo.processInfo.processIdentifier])
    FileHandle.standardOutput.write(ready + Data([10]))
  case .failure: exit(2)
  }
}
RunLoop.main.run()
`);
    const source = fileURLToPath(new URL('../../runners/ios/RunnerRecoveryControl.swift', import.meta.url));
    await promisify(execFile)('xcrun', ['swiftc', '-swift-version', '5', source, main, '-o', executable], { timeout: 60_000 });
  }, 65_000);
  afterAll(async () => {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
      child.kill('SIGKILL'); await closed;
    }));
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function control() {
    const recoveryKey = randomBytes(32).toString('hex');
    const child = spawn(executable, [], { env: { ...process.env, SESSION: base.sessionId, GENERATION: base.generation,
      DEVICE: base.deviceId, BOOT: base.simulatorBootedAt, KEY: recoveryKey }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    const ready = await new Promise<{ port: number; pid: number }>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Swift control did not bind')), 3000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Swift control exited before readiness')); });
      child.stdout!.on('data', chunk => {
        output += chunk.toString();
        if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output)); }
      });
    });
    const endpoint = { ...base, recoveryKey, recoveryPort: ready.port, runnerPid: ready.pid };
    return { child, endpoint, client: new RunnerRecoveryClient(endpoint) };
  }
  const context = () => ({ requestId: 'swift', deadline: Date.now() + 1000, signal: AbortSignal.timeout(1000) });
  function frame(endpoint: Awaited<ReturnType<typeof control>>['endpoint'], change: Record<string, unknown> = {}) {
    const body = { version: 1, direction: 'request', operation: 'identify', nonce: randomBytes(32).toString('hex'),
      ...base, runnerPid: endpoint.runnerPid, ...change };
    const signature = createHmac('sha256', Buffer.from(endpoint.recoveryKey, 'hex')).update(
      ['fliwright-runner-recovery', '1', body.direction, body.operation, body.nonce, body.sessionId, body.generation,
        body.deviceId, body.simulatorBootedAt, String(body.runnerPid), ''].join('\n')).digest('hex');
    return JSON.stringify({ ...body, signature }) + '\n';
  }
  async function send(port: number, bytes: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      let response = '';
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Swift response did not settle')); }, 2500);
      socket.on('connect', () => socket.write(bytes));
      socket.on('data', chunk => { response += chunk; });
      socket.on('error', () => {});
      socket.on('close', () => { clearTimeout(timer); resolve(response); });
    });
  }

  it('authenticates Node challenges and ends only itself on a signed shutdown', async () => {
    const { child, client } = await control();
    await expect(client.request('identify', context())).resolves.toBe('identified');
    const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
    await expect(client.request('shutdown', context())).resolves.toBe('stopping');
    expect(await exited).toBe(0);
  });
  it('rejects a wrong secret without exiting and remains available to its actual owner', async () => {
    const { client, endpoint, child } = await control();
    const impostor = new RunnerRecoveryClient({ ...endpoint, recoveryKey: randomBytes(32).toString('hex') });
    await expect(impostor.request('shutdown', context())).rejects.toMatchObject({ code: 'action_outcome_unknown' });
    expect(child.exitCode).toBeNull();
    await expect(client.request('identify', context())).resolves.toBe('identified');
  });
  it('rejects a previously authenticated nonce and identity-mismatched messages', async () => {
    const { endpoint, client } = await control();
    const request = frame(endpoint);
    expect(JSON.parse(await send(endpoint.recoveryPort, request))).toMatchObject({ status: 'identified' });
    expect(await send(endpoint.recoveryPort, request)).toBe('');
    for (const change of [
      { generation: '00000000-0000-4000-8000-000000000099' },
      { deviceId: '00000000-0000-4000-8000-000000000099' },
      { simulatorBootedAt: '2026-11-04T03:00:00.000Z' },
      { runnerPid: endpoint.runnerPid + 1 }, { operation: 'kill' }, { unknown: 'field' }, { version: true },
    ]) expect(await send(endpoint.recoveryPort, frame(endpoint, change))).toBe('');
    await expect(client.request('identify', context())).resolves.toBe('identified');
  });
  it('closes oversized and stalled inputs within a bounded connection budget', async () => {
    const { endpoint, client } = await control();
    expect(await send(endpoint.recoveryPort, 'x'.repeat(4097))).toBe('');
    expect(await send(endpoint.recoveryPort, '{')).toBe('');
    await expect(client.request('identify', context())).resolves.toBe('identified');
  });
});
