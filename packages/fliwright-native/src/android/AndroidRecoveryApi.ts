import { createHash, randomUUID } from 'node:crypto';
import { NativeError } from '@fliwright/core';
import { DeviceDiscovery, type DeviceInventory } from '@fliwright/devices';
import { inspectAndroidRecoveryCandidate, inspectDeviceLease, type DeviceLeaseInspectionInput } from '../DeviceRecovery.js';
import type { ToolExecutor } from '../ToolExecutor.js';
import { restoreAndroidRecovery } from './AndroidRecovery.js';

export interface AndroidRecoveryRequest {
  /** Stable AVD lease identity, for example `avd:dedicated-test`. */
  deviceId: string;
  /** Fingerprint from the current `inspectDeviceLease` result. */
  fingerprint: string;
  /** Private storage override for embedding and isolated tests. */
  rootDir?: string;
}

export interface AndroidRecoveryReceipt {
  status: 'restored';
  transactionId: string;
  resourceScope: 'android-app-permission-forward';
}

export interface AndroidRecoveryOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  adbPath?: string;
}

interface AndroidRecoveryDependencies {
  executor?: ToolExecutor;
  discovery?: Pick<DeviceDiscovery, 'scan'>;
  restore?: typeof restoreAndroidRecovery;
}

/** Restore only app, permission and recorded ADB-forward resources for one bound AVD. */
export function restoreAndroidApp(request: AndroidRecoveryRequest, options: AndroidRecoveryOptions = {}): Promise<AndroidRecoveryReceipt> {
  return restoreAndroidAppWith(request, options);
}

/** @internal Dependency-injected implementation for deterministic package tests. */
export async function restoreAndroidAppWith(request: AndroidRecoveryRequest, options: AndroidRecoveryOptions = {},
  dependencies: AndroidRecoveryDependencies = {}): Promise<AndroidRecoveryReceipt> {
  if (!request || typeof request.deviceId !== 'string' || !/^avd:[\w.-]+$/.test(request.deviceId)
    || !/^[a-f0-9]{64}$/.test(request.fingerprint)
    || request.rootDir !== undefined && (typeof request.rootDir !== 'string' || !request.rootDir || request.rootDir.includes('\0'))) {
    throw new NativeError('precondition_failed', 'An explicit stable Android AVD identity and current recovery fingerprint are required.');
  }
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) {
    throw new NativeError('precondition_failed', 'Android recovery timeout must be between 1 and 600000 milliseconds.');
  }
  const deadline = Date.now() + timeoutMs;
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const input: DeviceLeaseInspectionInput = { platform: 'android', deviceId: request.deviceId, rootDir: request.rootDir };
  check(signal);
  const report = await inspectDeviceLease(input);
  if (report.fingerprint !== request.fingerprint) throw new NativeError('cleanup_failed', 'Android recovery evidence changed; inspect the device again.');
  const candidate = await inspectAndroidRecoveryCandidate(input);
  if (candidate.report.fingerprint !== request.fingerprint) throw new NativeError('cleanup_failed', 'Android recovery evidence changed during qualification.');
  check(signal);

  const inventory: DeviceInventory = await (dependencies.discovery ?? new DeviceDiscovery({ tools: options.adbPath ? { adb: options.adbPath } : undefined }))
    .scan({ platforms: ['android'], signal, timeoutMs: Math.min(8000, remaining(signal, deadline)) });
  check(signal);
  if (inventory.diagnostics.some(item => item.source === 'adb')) {
    throw new NativeError('device_mismatch', 'Android device discovery is incomplete; recovery was not started.');
  }
  const avdName = request.deviceId.slice(4);
  const matches = inventory.devices.filter(device => device.platform === 'android' && device.kind === 'simulator' && device.avdName === avdName);
  if (matches.length !== 1 || matches[0].state !== 'online' || !/^emulator-\d+$/.test(matches[0].id)) {
    throw new NativeError('device_mismatch', 'Exactly one online Android Emulator with the requested AVD identity is required.');
  }
  const serial = matches[0].id;
  if (candidate.device.serialKey !== hash(`android\0${serial}`)) {
    throw new NativeError('device_mismatch', 'The discovered AVD serial differs from the original bound device record.');
  }
  check(signal);
  const restored = await (dependencies.restore ?? restoreAndroidRecovery)(input, {
    serial, fingerprint: request.fingerprint, timeoutMs: remaining(signal, deadline), signal,
    adbPath: options.adbPath, executor: dependencies.executor,
  });
  return { status: 'restored', transactionId: restored.transactionId, resourceScope: 'android-app-permission-forward' };
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function remaining(signal: AbortSignal, deadline: number): number {
  check(signal);
  const budget = deadline - Date.now();
  if (budget <= 0) throw new NativeError('timeout', 'Android recovery time budget expired; the device remains isolated.');
  return budget;
}
function check(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  throw new NativeError(reason instanceof DOMException && reason.name === 'TimeoutError' ? 'timeout' : 'cancelled',
    'Android recovery was cancelled or its time budget expired; the device remains isolated.');
}
