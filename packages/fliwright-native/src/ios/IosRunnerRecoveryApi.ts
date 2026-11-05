import { NativeError } from '@fliwright/core';
import { restoreIosRunnerRecovery } from './IosRunnerRecovery.js';

export interface IosRunnerRecoveryRequest {
  deviceId: string;
  fingerprint: string;
}
export interface IosRunnerRecoveryOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  xcrunPath?: string;
}
export interface IosRunnerRecoveryReceipt {
  status: 'restored';
  transactionId: string;
  resourceScope: 'xctest-runner';
}

/** Restore only an inspected, isolated XCTest Runner record on its exact Simulator.
 * This does not restore app, permission, device or media resources.
 */
export async function restoreIosRunner(request: IosRunnerRecoveryRequest, options: IosRunnerRecoveryOptions = {}): Promise<IosRunnerRecoveryReceipt> {
  if (!request || typeof request.deviceId !== 'string' || !request.deviceId.trim() || request.deviceId.includes('\0')
    || !/^[a-f0-9]{64}$/.test(request.fingerprint)) {
    throw new NativeError('precondition_failed', 'An explicit Simulator identity and current recovery inspection fingerprint are required.');
  }
  const result = await restoreIosRunnerRecovery({ platform: 'ios', deviceId: request.deviceId }, {
    fingerprint: request.fingerprint, timeoutMs: options.timeoutMs, signal: options.signal, xcrunPath: options.xcrunPath,
  });
  return { status: 'restored', transactionId: result.transactionId, resourceScope: 'xctest-runner' };
}
