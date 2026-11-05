import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createConnection } from 'node:net';
import { NativeError, type NativeOperationContext } from '@fliwright/core';

export interface RunnerRecoveryEndpoint {
  sessionId: string;
  generation: string;
  deviceId: string;
  simulatorBootedAt: string;
  runnerPid: number;
  recoveryPort: number;
  recoveryKey: string;
}

/** Internal authenticated, loopback-only control client; never signals a PID. */
export class RunnerRecoveryClient {
  private readonly endpoint: Readonly<RunnerRecoveryEndpoint>;
  private busy = false;
  private shutdownDispatched = false;

  constructor(endpoint: RunnerRecoveryEndpoint) {
    if (!Number.isSafeInteger(endpoint.recoveryPort) || endpoint.recoveryPort < 1 || endpoint.recoveryPort > 65535
      || !Number.isSafeInteger(endpoint.runnerPid) || endpoint.runnerPid <= 0
      || !/^[a-f0-9]{64}$/.test(endpoint.recoveryKey)
      || ![endpoint.sessionId, endpoint.generation, endpoint.deviceId, endpoint.simulatorBootedAt]
        .every(value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value))) {
      throw new NativeError('precondition_failed', 'Invalid Runner recovery endpoint.');
    }
    this.endpoint = Object.freeze({ ...endpoint });
  }

  async request(operation: 'identify' | 'shutdown', context: NativeOperationContext): Promise<'identified' | 'stopping'> {
    if (!['identify', 'shutdown'].includes(operation) || this.busy || this.shutdownDispatched) {
      throw new NativeError('precondition_failed', 'Runner recovery control cannot overlap or replay shutdown.');
    }
    if (context.signal.aborted) throw new NativeError('cancelled', 'Runner recovery control was cancelled before dispatch.');
    const budget = context.deadline - Date.now();
    if (!Number.isFinite(budget) || budget <= 0 || budget > 600_000) {
      throw new NativeError('timeout', 'Runner recovery control requires a bounded remaining budget.');
    }
    const { recoveryKey: _key, recoveryPort: _port, ...identity } = this.endpoint;
    const request = { version: 1, direction: 'request', operation, nonce: randomBytes(32).toString('hex'), ...identity };
    const body = JSON.stringify({ ...request, signature: this.signature(request) }) + '\n';
    this.busy = true;
    try {
      return await new Promise<'identified' | 'stopping'>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: this.endpoint.recoveryPort, family: 4 });
        let settled = false, dispatched = false, size = 0;
        const chunks: Buffer[] = [];
        const finish = (error?: NativeError, result?: 'identified' | 'stopping') => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          context.signal.removeEventListener('abort', abort);
          socket.destroy();
          if (error) reject(dispatched && operation === 'shutdown'
            ? new NativeError('action_outcome_unknown', 'Runner shutdown outcome is unknown; read back platform state without replaying.') : error);
          else resolve(result!);
        };
        const abort = () => finish(new NativeError('cancelled', 'Runner recovery control was cancelled.'));
        const timer = setTimeout(() => finish(new NativeError('timeout', 'Runner recovery control timed out.')), budget);
        context.signal.addEventListener('abort', abort, { once: true });
        socket.on('error', () => finish(new NativeError('runner_unavailable', 'Runner recovery control transport failed.')));
        socket.on('close', () => finish(new NativeError('runner_unavailable', 'Runner recovery control closed before authentication.')));
        socket.on('connect', () => {
          if (settled || context.signal.aborted || Date.now() >= context.deadline) { abort(); return; }
          dispatched = true;
          if (operation === 'shutdown') this.shutdownDispatched = true;
          socket.write(body);
        });
        socket.on('data', data => {
          if (settled) return;
          const chunk = Buffer.from(data);
          size += chunk.length;
          if (size > 4096) { finish(mismatch()); return; }
          chunks.push(chunk);
          if (!chunk.includes(10)) return;
          const frame = Buffer.concat(chunks);
          if (frame.indexOf(10) !== frame.length - 1) { finish(mismatch()); return; }
          try {
            const response: unknown = JSON.parse(frame.subarray(0, -1).toString('utf8'));
            if (!response || typeof response !== 'object' || Array.isArray(response)) throw mismatch();
            const value = response as Record<string, unknown>;
            const status = operation === 'identify' ? 'identified' : 'stopping';
            const expected = { ...request, direction: 'response', status };
            if (Object.keys(value).length !== Object.keys(expected).length + 1
              || Object.entries(expected).some(([key, entry]) => value[key] !== entry)
              || typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature)
              || !timingSafeEqual(Buffer.from(value.signature, 'hex'), Buffer.from(this.signature(expected), 'hex'))) throw mismatch();
            finish(undefined, status);
          } catch { finish(mismatch()); }
        });
        if (context.signal.aborted) abort();
      });
    } finally { this.busy = false; }
  }

  private signature(value: Record<string, unknown>): string {
    return createHmac('sha256', Buffer.from(this.endpoint.recoveryKey, 'hex')).update(['fliwright-runner-recovery', '1',
      value.direction, value.operation, value.nonce, value.sessionId, value.generation, value.deviceId,
      value.simulatorBootedAt, String(value.runnerPid), value.status ?? ''].join('\n')).digest('hex');
  }
}

function mismatch(): NativeError { return new NativeError('device_mismatch', 'Runner recovery response could not be authenticated.'); }
