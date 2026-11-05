import { afterEach, describe, expect, it } from 'vitest';
import { RunnerBroker } from '../src/ios/RunnerBroker.js';

const brokers: RunnerBroker[] = [];
afterEach(async () => { await Promise.all(brokers.splice(0).map(broker => broker.dispose())); });
async function setup() {
  const broker = new RunnerBroker({ deviceId: 'ios-sim', appId: 'example.app', generation: 'generation' });
  brokers.push(broker);
  await broker.start();
  const env = broker.environment();
  const call = (path: string, body?: unknown, auth = env.FLIWRIGHT_RUNNER_TOKEN) => fetch(`${env.FLIWRIGHT_RUNNER_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ready = () => call('/ready', { protocolVersion: 2, sessionId: env.FLIWRIGHT_RUNNER_SESSION,
    generation: 'generation', deviceId: 'ios-sim', appId: 'example.app', runnerPid: 234, recoveryPort: 3456 });
  return { broker, env, call, ready };
}
describe('XCTest command broker', () => {
  it('authenticates and verifies device/application/generation before becoming ready', async () => {
    const { broker, env, call, ready } = await setup();
    expect((await call('/ready', {}, 'wrong')).status).toBe(401);
    expect((await call('/ready', { protocolVersion: 1, deviceId: 'wrong' })).status).toBe(409);
    expect((await call('/ready', { protocolVersion: 1, sessionId: env.FLIWRIGHT_RUNNER_SESSION,
      generation: 'generation', deviceId: 'ios-sim', appId: 'example.app' })).status).toBe(409);
    expect((await ready()).status).toBe(200);
    await broker.waitUntilReady({ signal: AbortSignal.timeout(100) });
    expect(broker.runnerPid).toBe(234);
    expect(broker.recoveryPort).toBe(3456);
  });
  it('requires a recovery port and refuses legacy or changed ready identities', async () => {
    const { env, call, ready } = await setup();
    const body = { protocolVersion: 2, sessionId: env.FLIWRIGHT_RUNNER_SESSION,
      generation: 'generation', deviceId: 'ios-sim', appId: 'example.app', runnerPid: 234, recoveryPort: 3456 };
    for (const recoveryPort of [undefined, 0, 65536, 1.5]) {
      expect((await call('/ready', { ...body, recoveryPort })).status).toBe(409);
    }
    expect((await call('/ready', { ...body, protocolVersion: 1 })).status).toBe(409);
    expect((await ready()).status).toBe(200);
    expect((await ready()).status).toBe(200);
    expect((await call('/ready', { ...body, recoveryPort: 4567 })).status).toBe(409);
    expect((await call('/ready', { ...body, runnerPid: 999 })).status).toBe(409);
  });
  it('delivers each command once and accepts only its matching result', async () => {
    const { broker, call, ready } = await setup();
    await ready();
    const pending = broker.request('snapshot', {}, { requestId: 'parent', deadline: Date.now() + 1000, signal: AbortSignal.timeout(1000) });
    const command = await (await call('/next')).json();
    expect(command).toMatchObject({ operation: 'snapshot', parentRequestId: 'parent', protocolVersion: 2 });
    expect(command.budgetMs).toBeGreaterThan(0);
    expect((await call('/result', { requestId: 'wrong', result: {} })).status).toBe(409);
    expect((await call('/result', { requestId: command.requestId, result: { nodes: [] } })).status).toBe(200);
    expect(await pending).toEqual({ nodes: [] });
    // A duplicate response cannot complete a different operation.
    expect((await call('/result', { requestId: command.requestId, result: {} })).status).toBe(409);
  });
  it('cancels a delivered click as an unknown outcome and never queues a replay', async () => {
    const { broker, call, ready } = await setup();
    await ready();
    const controller = new AbortController();
    const pending = broker.request('click', {}, { requestId: 'parent', deadline: Date.now() + 1000, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'action_outcome_unknown' });
    await call('/next');
    controller.abort();
    await rejected;
    await expect(broker.request('screenshot', {}, { requestId: 'later', deadline: Date.now() + 1000,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'precondition_failed' });
  });
  it('rejects requests before readiness and closes an outstanding long poll', async () => {
    const { broker, call } = await setup();
    await expect(broker.request('snapshot', {}, { requestId: 'p', deadline: Date.now() + 100, signal: AbortSignal.timeout(100) })).rejects.toMatchObject({ code: 'runner_unavailable' });
    const next = call('/next');
    await broker.dispose();
    const response = await next.catch(() => undefined);
    expect(response === undefined || response.status >= 400).toBe(true);
  });
});
