#!/usr/bin/env node
// Development-only platform experiment. Uses a temporary XCTest entry with the production control source.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeviceLeaseManager } from '../dist/DeviceLease.js';
import { prepareIosRunner } from '../dist/ios/PrepareIosRunner.js';
import { IosRunnerJournal } from '../dist/ios/IosRunnerJournal.js';
import { readSimulatorBootGeneration, readSimulatorRunnerPids } from '../dist/ios/IosSimulatorIdentity.js';
import { RunnerRecoveryClient } from '../dist/ios/RunnerRecoveryClient.js';
import { executeTool } from '../dist/ToolExecutor.js';

const deviceIds = process.argv.slice(2);
if (process.platform !== 'darwin' || deviceIds.length < 1 || deviceIds.length > 2
  || new Set(deviceIds.map(value => value.toLowerCase())).size !== deviceIds.length
  || deviceIds.some(value => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))) {
  throw new Error('Usage on macOS: node scripts/verify-ios-recovery-control.mjs <dedicated-Simulator-UDID> [second-dedicated-Simulator-UDID]');
}
const peers = new Map();
const checkedPeers = new Map();
function peerReady(deviceId, port, group = peers) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { group.delete(deviceId); reject(new Error('Peer Runner readiness timed out')); }, 30_000);
    group.set(deviceId, { port, resolve: value => { clearTimeout(timer); resolve(value); } });
    if (group.size === 2) {
      const entries = [...group.entries()];
      entries[0][1].resolve(entries[1][1].port);
      entries[1][1].resolve(entries[0][1].port);
    }
  });
}

async function experiment(deviceId) {
  const config = { platform: 'ios', deviceId, enabled: true, targetAppId: 'dev.fliwright.NativeRunner', backend: 'xctest' };
  const context = (ms = 5000, signal = AbortSignal.timeout(ms)) => ({ requestId: randomUUID(), deadline: Date.now() + ms, signal });
  const lease = await new DeviceLeaseManager().acquire('ios', deviceId, { signal: AbortSignal.timeout(5000) });
  const artifactRoot = await mkdtemp(join(tmpdir(), 'fliwright-ios-control-'));
  const journal = new IosRunnerJournal({ path: lease.iosRunnerRecoveryPath, deviceId, binding: lease.recoveryBinding,
    assertOwned: () => lease.assertOwned() });
  const generation = randomUUID(), sessionId = randomUUID(), recoveryKey = randomBytes(32).toString('hex');
  const controller = new AbortController();
  let broker, processDone, client, begun = false, ready = false, cleanupConfirmed = false, shutdownAttempted = false;
  let failure, summary;
  try {
    const boot = await readSimulatorBootGeneration(config, context());
    if ((await readSimulatorRunnerPids(config, context())).length) throw new Error('A Runner is already active');
    const sourceRoot = join(artifactRoot, 'source');
    await cp(fileURLToPath(new URL('../runners/ios', import.meta.url)), sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, 'FliwrightRunner.swift'), `
  import Foundation
  import XCTest
  final class ShutdownFlag {
    private let lock = NSLock()
    private var value = false
    func set() { lock.lock(); value = true; lock.unlock() }
    func get() -> Bool { lock.lock(); defer { lock.unlock() }; return value }
  }
  final class FliwrightRunner: XCTestCase {
    @MainActor func testServe() async throws {
      executionTimeAllowance = 90
      let env = ProcessInfo.processInfo.environment
      guard env["SIMULATOR_UDID"] == env["FLIWRIGHT_RUNNER_DEVICE"] else { XCTFail("Wrong Simulator"); return }
      let flag = ShutdownFlag()
      let control = try RunnerRecoveryControl(identity: .init(
        sessionId: env["FLIWRIGHT_RUNNER_SESSION"]!, generation: env["FLIWRIGHT_RUNNER_GENERATION"]!,
        deviceId: env["FLIWRIGHT_RUNNER_DEVICE"]!, simulatorBootedAt: env["FLIWRIGHT_RUNNER_BOOT"]!,
        runnerPid: Int(ProcessInfo.processInfo.processIdentifier)),
        key: env["FLIWRIGHT_RUNNER_RECOVERY_KEY"]!, onShutdown: { flag.set() })
      defer { control.stop() }
      let port = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
        control.start { continuation.resume(with: $0) }
      }
      var request = URLRequest(url: URL(string: env["FLIWRIGHT_RUNNER_URL"]! + "/ready")!, timeoutInterval: 5)
      request.httpMethod = "POST"
      request.setValue("Bearer " + env["FLIWRIGHT_RUNNER_TOKEN"]!, forHTTPHeaderField: "Authorization")
      request.httpBody = try JSONSerialization.data(withJSONObject: [
        "port": port, "pid": ProcessInfo.processInfo.processIdentifier,
        "sessionId": env["FLIWRIGHT_RUNNER_SESSION"]!, "generation": env["FLIWRIGHT_RUNNER_GENERATION"]!,
        "deviceId": env["FLIWRIGHT_RUNNER_DEVICE"]!,
      ])
      let (_, response) = try await URLSession.shared.data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else { XCTFail("Broker rejected readiness"); return }
      let deadline = Date().addingTimeInterval(60)
      while !flag.get(), Date() < deadline { try await Task.sleep(for: .milliseconds(25)) }
      XCTAssertTrue(flag.get(), "No authenticated shutdown received before experiment deadline")
      try await Task.sleep(for: .milliseconds(100))
    }
  }
  `);
    const product = await prepareIosRunner({ sourceRoot, cacheRoot: join(artifactRoot, 'build'), timeoutMs: 120_000 });
    broker = spawn(process.execPath, ['--input-type=module', '--eval', `
      import { createServer } from 'node:http';
      const env = process.env;
      const server = createServer(async (request, response) => {
        if (request.url !== '/ready' || request.headers.authorization !== 'Bearer ' + env.TOKEN) { response.writeHead(401).end(); return; }
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 4096) { request.destroy(); return; } chunks.push(chunk); }
        const ready = JSON.parse(Buffer.concat(chunks));
        if (ready.sessionId !== env.SESSION || ready.generation !== env.GENERATION || ready.deviceId !== env.DEVICE) { response.writeHead(409).end(); return; }
        response.writeHead(200).end();
        process.stdout.write(JSON.stringify({ event: 'ready', port: ready.port, pid: ready.pid }) + '\\n');
      });
      server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ event: 'listening', port: server.address().port }) + '\\n'));
    `], { env: { ...process.env, TOKEN: recoveryKey, SESSION: sessionId, GENERATION: generation, DEVICE: deviceId },
      stdio: ['ignore', 'pipe', 'ignore'] });
    const pending = new Map(), observed = new Map();
    let buffer = '';
    broker.stdout.on('data', chunk => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const value = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
        observed.set(value.event, value); pending.get(value.event)?.(value);
      }
    });
    async function event(name, ms) {
      if (observed.has(name)) return observed.get(name);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(name); reject(new Error('Experiment event timed out')); }, ms);
        pending.set(name, value => { clearTimeout(timer); pending.delete(name); resolve(value); });
      });
    }
    const listening = await event('listening', 5000);
    await journal.begin(generation, boot, { sessionId, recoveryKey }, context()); begun = true;
    const env = { ...process.env };
    for (const [key, value] of Object.entries({ URL: 'http://127.0.0.1:' + listening.port, TOKEN: recoveryKey, SESSION: sessionId,
      GENERATION: generation, DEVICE: deviceId, BOOT: boot, RECOVERY_KEY: recoveryKey })) env['TEST_RUNNER_FLIWRIGHT_RUNNER_' + key] = value;
    processDone = lease.runOwnedTool(() => executeTool('xcodebuild', ['test-without-building', '-xctestrun', product.xctestrunPath,
      '-destination', 'platform=iOS Simulator,id=' + deviceId, '-parallel-testing-enabled', 'NO', '-quiet'],
    context(120_000, controller.signal), { env })).then(async output => {
      await writeFile(join(artifactRoot, 'xcodebuild.log'), output, { mode: 0o600 });
    }, async error => {
      await writeFile(join(artifactRoot, 'xcodebuild-error.txt'), String(error), { mode: 0o600 });
      throw new Error('XCTest experiment did not finish successfully');
    });
    void processDone.catch(() => {});
    const endpoint = await event('ready', 90_000);
    const pids = await readSimulatorRunnerPids(config, context());
    if (pids.length !== 1 || pids[0] !== endpoint.pid || await readSimulatorBootGeneration(config, context()) !== boot) {
      throw new Error('Runner platform identity did not match');
    }
    await journal.bind(endpoint.pid, endpoint.port, context()); ready = true;
    client = new RunnerRecoveryClient({ sessionId, generation, deviceId, simulatorBootedAt: boot,
      runnerPid: endpoint.pid, recoveryPort: endpoint.port, recoveryKey });
    if (await client.request('identify', context()) !== 'identified') throw new Error('Authentication failed');
    let crossSimulatorIsolation;
    if (deviceIds.length === 2) {
      const peerPort = await peerReady(deviceId, endpoint.port);
      const wrongTarget = new RunnerRecoveryClient({ sessionId, generation, deviceId, simulatorBootedAt: boot,
        runnerPid: endpoint.pid, recoveryPort: peerPort, recoveryKey });
      let rejected = false;
      try { await wrongTarget.request('identify', context()); }
      catch (error) {
        if (!['runner_unavailable', 'device_mismatch'].includes(error.code)) throw error;
        rejected = true;
      }
      if (!rejected) throw new Error('Another Simulator accepted this Runner identity');
      if (await client.request('identify', context()) !== 'identified') throw new Error('Cross-target check affected the owned Runner');
      await peerReady(deviceId, endpoint.port, checkedPeers);
      crossSimulatorIsolation = true;
    }
    const brokerExit = new Promise(resolve => broker.once('exit', resolve));
    broker.kill('SIGKILL'); await brokerExit;
    if (await client.request('identify', context()) !== 'identified') throw new Error('Owner-independent authentication failed');
    shutdownAttempted = true;
    const acknowledgment = await client.request('shutdown', context());
    await processDone;
    if ((await readSimulatorRunnerPids(config, context())).length || await readSimulatorBootGeneration(config, context()) !== boot) {
      throw new Error('Runner exit could not be confirmed');
    }
    await journal.complete(context()); begun = false; cleanupConfirmed = true;
    summary = { status: 'passed', toolchain: product.xcode, sdkBuild: product.sdkBuild, scope: 'temporary-xctest-entry',
      loopbackAuthenticated: true, brokerProcessKilled: true, authenticatedAfterBrokerExit: true,
      acknowledgment, runnerAbsent: true, ...(crossSimulatorIsolation ? { crossSimulatorIsolation } : {}), productionSessionIntegrated: false };
  } catch (error) { failure = error; }
  finally {
    if (client && !shutdownAttempted) {
      shutdownAttempted = true;
      await client.request('shutdown', context()).catch(() => {});
    }
    if (!cleanupConfirmed) {
      controller.abort();
      if (processDone) await processDone.catch(() => {});
      if (begun) {
        // A failed experiment never clears its journal by guessing that the Runner exited.
        await lease.quarantine('iOS recovery-control experiment did not confirm cleanup').catch(() => {});
      }
    }
    if (broker && broker.exitCode === null && broker.signalCode === null) {
      const closed = new Promise(resolve => broker.once('exit', resolve)); broker.kill('SIGKILL'); await closed;
    }
    try { await lease.release(); } catch {
      cleanupConfirmed = false;
      failure ??= new Error('Experiment lease cleanup was not confirmed');
    }
    if (failure && summary) summary = { ...summary, status: 'failed', cleanupConfirmed };
    await rm(join(artifactRoot, 'build'), { recursive: true, force: true });
    await rm(join(artifactRoot, 'source'), { recursive: true, force: true });
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(artifactRoot, 'result.json'), JSON.stringify(summary ?? { status: 'failed', ready, cleanupConfirmed }, null, 2), { mode: 0o600 });
  }
  process.stdout.write(JSON.stringify({ ...(summary ?? { status: 'failed' }), artifactRoot }) + '\n');
  if (failure) { process.stderr.write('Recovery-control experiment failed; inspect its private artifacts and retained lease evidence.\n'); process.exitCode = 1; }
}

const results = await Promise.allSettled(deviceIds.map(experiment));
for (const result of results) if (result.status === 'rejected') {
  process.stderr.write('Recovery-control experiment could not acquire its dedicated device or initialize storage.\n');
  process.exitCode = 1;
}
