import { randomBytes, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { NativeError, type NativeConfig, type NativeIdentity, type NativeOperationContext } from '@fliwright/core';
import { RunnerBroker } from './RunnerBroker.js';
import { XctestSession } from './XctestSession.js';
import { executeTool } from '../ToolExecutor.js';
import { IosRunnerJournal } from './IosRunnerJournal.js';
import { readSimulatorBootGeneration, readSimulatorRunnerPids } from './IosSimulatorIdentity.js';
import { RunnerRecoveryClient } from './RunnerRecoveryClient.js';

type OwnedToolRunner = <T>(action: () => Promise<T>) => Promise<T>;

/** Launch the previously prepared UI-test product on exactly one Simulator. */
export async function startXctestSession(config: NativeConfig, signal?: AbortSignal, runOwnedTool: OwnedToolRunner = action => action(),
  recovery?: { path: string; binding: { leaseKey: string; ownerGeneration: string }; assertOwned(): Promise<void> }): Promise<XctestSession> {
  await preflightXctestSession(config);
  const startup = operationContext(config.ios?.startupTimeoutMs ?? 120_000, signal);
  const simulatorBootedAt = await readSimulatorBootGeneration(config, within(startup, 5000));
  const assertBootGeneration = async (context: NativeOperationContext, cleanup = false) => {
    if (await readSimulatorBootGeneration(config, context) !== simulatorBootedAt) {
      throw new NativeError(cleanup ? 'cleanup_failed' : 'device_mismatch', 'Simulator boot generation changed; Runner evidence was retained.');
    }
  };
  if ((await readSimulatorRunnerPids(config, within(startup, 3000))).length) {
    throw new NativeError('device_busy', 'A Simulator XCTest Runner is already active and is not owned by this session.');
  }
  const path = config.ios!.xctestrunPath;
  const identity: NativeIdentity = { platform: 'ios', deviceId: config.deviceId, appId: config.targetAppId, backend: 'xctest', generation: randomUUID() };
  const journal = recovery ? new IosRunnerJournal({ ...recovery, deviceId: config.deviceId }) : undefined;
  const systemAppIds = config.systemAppIds ?? ['com.apple.springboard', 'com.apple.mobileslideshow', 'com.apple.PhotosUI.PhotosPicker'];
  const allowedAppIds = [...new Set([config.targetAppId, ...systemAppIds, ...(config.externalAppIds ?? [])])];
  const broker = new RunnerBroker(identity);
  await broker.start();
  const recoveryKey = randomBytes(32).toString('hex');
  const brokerEnvironment = broker.environment();
  const sessionId = brokerEnvironment.FLIWRIGHT_RUNNER_SESSION;
  const env = { ...process.env };
  for (const [key, value] of Object.entries({ ...brokerEnvironment, FLIWRIGHT_RUNNER_APPS: JSON.stringify(allowedAppIds),
    FLIWRIGHT_RUNNER_BOOT: simulatorBootedAt, FLIWRIGHT_RUNNER_RECOVERY_KEY: recoveryKey })) env[`TEST_RUNNER_${key}`] = value;
  const processController = new AbortController();
  const abortProcess = () => processController.abort(signal?.reason);
  signal?.addEventListener('abort', abortProcess, { once: true });
  if (signal?.aborted) abortProcess();
  if (journal) {
    try {
      await journal.begin(identity.generation, simulatorBootedAt, { sessionId, recoveryKey }, within(startup, 5000));
    }
    catch (error) {
      await broker.dispose();
      signal?.removeEventListener('abort', abortProcess);
      throw error;
    }
  }
  let exited = false;
  let exitError: unknown;
  let control: RunnerRecoveryClient | undefined;
  const processRun = runOwnedTool(() => executeTool(config.tools?.xcodebuild ?? 'xcodebuild', ['test-without-building', '-xctestrun', path,
    '-destination', `platform=iOS Simulator,id=${config.deviceId}`, '-parallel-testing-enabled', 'NO', '-quiet'],
  { requestId: randomUUID(), deadline: Date.now() + 24 * 60 * 60 * 1000, signal: processController.signal }, { env }));
  const done = processRun.then(() => { exited = true; }, error => { exited = true; exitError = error; });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    const cleanup = cleanupContext(config.cleanupTimeoutMs ?? 15_000);
    let shutdownConfirmed = false;
    try {
      // Authenticate the current generation. A stored PID, even in the same boot,
      // never authorizes bundle termination. Failed or lost writes are not replayed.
      try {
        await assertBootGeneration(cleanup, true);
        const active = await readSimulatorRunnerPids(config, cleanup);
        if (control && active.length === 1 && active[0] === broker.runnerPid) {
          await control.request('identify', within(cleanup, 2000));
          await assertBootGeneration(cleanup, true);
          await control.request('shutdown', within(cleanup, 2000));
          shutdownConfirmed = true;
        }
      } catch { /* Independent platform readback below decides cleanup. */ }
      await broker.dispose();
      // Give an authenticated self-shutdown time to finish XCTest before stopping
      // the owned host group. Never signal a process inside the Simulator.
      if (shutdownConfirmed && !exited) await boundedExit(done, Math.min(8000, Math.max(0, cleanup.deadline - Date.now() - 2000)));
      if (!exited) processController.abort(new NativeError('cancelled', 'XCTest session is closing.'));
      await boundedExit(done, Math.max(0, cleanup.deadline - Date.now()));
      if (!exited) throw new NativeError('cleanup_failed', 'Owned xcodebuild process group did not exit.');
      if (exitError instanceof NativeError && exitError.code === 'cleanup_failed') throw exitError;
      await assertBootGeneration(cleanup, true);
      const remaining = await readSimulatorRunnerPids(config, cleanup);
      if (remaining.length) {
        throw new NativeError('cleanup_failed', 'Owned XCTest Runner is still active on the Simulator.');
      }
      await assertBootGeneration(cleanup, true);
      await journal?.complete(cleanup);
    } catch (error) {
      throw new NativeError('cleanup_failed', 'XCTest Runner cleanup could not be independently confirmed; retain its evidence.', { cause: error });
    } finally {
      if (!exited) processController.abort(new NativeError('cancelled', 'XCTest cleanup ended.'));
      await broker.dispose();
      signal?.removeEventListener('abort', abortProcess);
    }
  })();
  try {
    await Promise.race([broker.waitUntilReady({ signal: startup.signal }), done.then(() => {
      throw new NativeError('runner_unavailable', 'XCTest Runner exited before readiness.');
    })]);
    if (signal?.aborted) throw new NativeError('cancelled', 'XCTest startup cancelled.');
    const runnerPid = broker.runnerPid;
    const recoveryPort = broker.recoveryPort;
    await assertBootGeneration(within(startup, 3000));
    const active = await readSimulatorRunnerPids(config, within(startup, 3000));
    if (runnerPid === undefined || recoveryPort === undefined || active.length !== 1 || active[0] !== runnerPid) {
      throw new NativeError('device_mismatch', 'The authenticated XCTest Runner PID does not match the selected Simulator process.');
    }
    const candidate = new RunnerRecoveryClient({ sessionId, generation: identity.generation, deviceId: config.deviceId,
      simulatorBootedAt, runnerPid, recoveryPort, recoveryKey });
    await candidate.request('identify', within(startup, 3000));
    control = candidate;
    await assertBootGeneration(within(startup, 3000));
    await journal?.bind(runnerPid, recoveryPort, within(startup, 3000));
    return new XctestSession({ identity, broker, systemAppIds, allowedAppIds, close });
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new NativeError('cleanup_failed', 'XCTest startup failed and Runner cleanup could not be confirmed.', { cause: cleanupError }); }
    throw error;
  }
}
function within(context: NativeOperationContext, timeout: number): NativeOperationContext {
  const deadline = Math.min(context.deadline, Date.now() + timeout);
  return { requestId: randomUUID(), deadline,
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(0, deadline - Date.now()))]) };
}
/** Check non-mutating prerequisites before device ownership is acquired. */
export async function preflightXctestSession(config: NativeConfig): Promise<void> {
  const path = config.ios?.xctestrunPath;
  if (!path || !path.endsWith('.xctestrun') || !(await stat(path).catch(() => undefined))?.isFile()) {
    throw new NativeError('precondition_failed', 'Prepare the iOS Runner and configure its existing .xctestrun product first.');
  }
  if (process.platform !== 'darwin') throw new NativeError('unsupported_capability', 'XCTest requires macOS and Xcode.');
}
function cleanupContext(timeout: number): NativeOperationContext {
  return { requestId: randomUUID(), deadline: Date.now() + timeout, signal: AbortSignal.timeout(timeout) };
}
function operationContext(timeout: number, parent?: AbortSignal): NativeOperationContext {
  return { requestId: randomUUID(), deadline: Date.now() + timeout,
    signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(parent ? [parent] : [])]) };
}
async function boundedExit(done: Promise<void>, timeout: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([done, new Promise<void>(resolve => { timer = setTimeout(resolve, timeout); })]); }
  finally { clearTimeout(timer); }
}
