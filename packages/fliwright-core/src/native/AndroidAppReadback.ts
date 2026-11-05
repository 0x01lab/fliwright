import { createHash } from 'node:crypto';
import { assertAndroidPermissionDeclaration, parseAndroidPermissionDeclarations, type AndroidPermissionDeclaration } from './AndroidPermissionDeclaration.js';
import { NativeError, type NativeIdentity } from './types.js';

/** Package-manager state; observing it does not adopt a restoration baseline. */
export interface AndroidPermissionObservation {
  permission: 'camera' | 'microphone';
  granted: boolean;
  userSet: boolean;
  userFixed: boolean;
  flags: string[];
}
export interface AndroidAppObservation {
  platform: 'android';
  deviceKey: string;
  appId: string;
  apkSha256: string;
  uid: number;
  pid: number;
  permissions: AndroidPermissionObservation[];
}
/** Supervisor expectation only; this serialized value is never a live receipt. */
export interface AndroidAppExpectation extends AndroidAppObservation {
  attemptKey: string;
  scenarioFingerprint?: string;
  launchGeneration: string;
}
export interface AndroidAppReadbackContext {
  permissionDeclaration?: readonly AndroidPermissionDeclaration[];
  attemptKey: string;
  attemptId: string;
  managedAppGeneration: string;
  scenarioFingerprint?: string;
  identity: NativeIdentity;
  signal?: AbortSignal;
}
export interface AndroidAppReadbackReport extends AndroidAppExpectation {
  attemptId: string;
  managedAppGeneration: string;
  adapterGeneration: string;
  coverage: 'platform-readback';
}

const hash = /^[a-f0-9]{64}$/;
const permissionFlags = new Set(['USER_SET', 'USER_FIXED', 'USER_SENSITIVE_WHEN_GRANTED', 'USER_SENSITIVE_WHEN_DENIED']);
const observationKeys = ['platform', 'deviceKey', 'appId', 'apkSha256', 'uid', 'pid', 'permissions'];
function invalid(): never { throw new NativeError('device_mismatch', 'Invalid Android app readback metadata.'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
const textId = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

/** Strictly decode the independent platform observation, without retaining arbitrary fields. */
export function parseAndroidAppObservation(value: unknown): AndroidAppObservation {
  const input = record(value, observationKeys);
  if (input.platform !== 'android' || typeof input.deviceKey !== 'string' || !hash.test(input.deviceKey)
    || typeof input.apkSha256 !== 'string' || !hash.test(input.apkSha256)
    || typeof input.appId !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(input.appId)
    || !Number.isSafeInteger(input.uid) || (input.uid as number) < 10000 || (input.uid as number) >= 100000
    || !Number.isSafeInteger(input.pid) || (input.pid as number) <= 1
    || !Array.isArray(input.permissions) || input.permissions.length > 2) invalid();
  const seen = new Set<string>();
  const permissions = Array.from(input.permissions).map(value => {
    const state = record(value, ['permission', 'granted', 'userSet', 'userFixed', 'flags']);
    if ((state.permission !== 'camera' && state.permission !== 'microphone') || seen.has(state.permission)
      || typeof state.granted !== 'boolean' || typeof state.userSet !== 'boolean' || typeof state.userFixed !== 'boolean'
      || !Array.isArray(state.flags) || Array.from(state.flags).some(flag => typeof flag !== 'string' || !permissionFlags.has(flag))
      || new Set(state.flags).size !== state.flags.length
      || state.userSet !== state.flags.includes('USER_SET') || state.userFixed !== state.flags.includes('USER_FIXED')) invalid();
    seen.add(state.permission);
    return { permission: state.permission, granted: state.granted, userSet: state.userSet, userFixed: state.userFixed, flags: [...state.flags] } as AndroidPermissionObservation;
  });
  return { platform: 'android', deviceKey: input.deviceKey, appId: input.appId, apkSha256: input.apkSha256,
    uid: input.uid as number, pid: input.pid as number, permissions };
}

export function parseAndroidAppExpectation(value: unknown,
  request: { attemptKey: string; scenarioFingerprint?: string }): AndroidAppExpectation {
  const input = record(value, [...observationKeys, 'attemptKey', 'scenarioFingerprint', 'launchGeneration']);
  if (!textId(input.attemptKey) || input.attemptKey !== request.attemptKey || !textId(input.launchGeneration)
    || input.scenarioFingerprint !== request.scenarioFingerprint
    || (input.scenarioFingerprint !== undefined && (typeof input.scenarioFingerprint !== 'string' || !hash.test(input.scenarioFingerprint)))) invalid();
  const { attemptKey, scenarioFingerprint, launchGeneration, ...observation } = input;
  return { ...parseAndroidAppObservation(observation), attemptKey, launchGeneration,
    ...(scenarioFingerprint === undefined ? {} : { scenarioFingerprint }) } as AndroidAppExpectation;
}

/** Single-use, current-attempt proof. The read is performed in the consuming process. */
export function createAndroidAppReadback(expected: AndroidAppExpectation, context: AndroidAppReadbackContext,
  read: (signal?: AbortSignal) => Promise<AndroidAppObservation>, signal?: AbortSignal): {
    consume(current: AndroidAppReadbackContext): Promise<AndroidAppReadbackReport>;
  } {
  const snapshot = parseAndroidAppExpectation(expected, context);
  const identity = { ...context.identity };
  const declaration = parseAndroidPermissionDeclarations(context.permissionDeclaration ?? []);
  const declarationKey = (value: unknown) => JSON.stringify(parseAndroidPermissionDeclarations(value).sort((a, b) => a.permission.localeCompare(b.permission)));
  const binding = { attemptKey: context.attemptKey, attemptId: context.attemptId, managedAppGeneration: context.managedAppGeneration,
    scenarioFingerprint: context.scenarioFingerprint };
  if (!textId(binding.attemptId) || !textId(binding.managedAppGeneration)) invalid();
  const signals = [signal, context.signal].filter((value): value is AbortSignal => !!value);
  let consumed = false;
  return { async consume(current) {
    if (consumed) throw new NativeError('precondition_failed', 'Android app readback was already consumed.');
    consumed = true;
    const currentSignals = [...signals, ...(current.signal ? [current.signal] : [])];
    const combined = currentSignals.length ? AbortSignal.any(currentSignals) : undefined;
    const assertContext = () => {
      combined?.throwIfAborted();
      if (declarationKey(current.permissionDeclaration ?? []) !== declarationKey(declaration)
        || declarationKey(context.permissionDeclaration ?? []) !== declarationKey(declaration)) {
        throw new NativeError('device_mismatch', 'Android permission declaration changed during readback.');
      }
      assertAndroidPermissionDeclaration(declaration, snapshot.permissions);
      for (const key of ['attemptKey', 'attemptId', 'managedAppGeneration', 'scenarioFingerprint'] as const) {
        if (current[key] !== binding[key]) throw new NativeError('device_mismatch', 'Android app readback context changed.');
      }
      for (const key of ['platform', 'deviceId', 'appId', 'backend', 'generation'] as const) {
        if (current.identity[key] !== identity[key] || context.identity[key] !== identity[key]) throw new NativeError('device_mismatch', 'Android app readback Adapter identity changed.');
      }
      if (identity.platform !== 'android' || identity.backend !== 'adb' || identity.appId !== snapshot.appId
        || createHash('sha256').update(`android\0${identity.deviceId}`).digest('hex') !== snapshot.deviceKey) {
        throw new NativeError('device_mismatch', 'Android app readback device identity does not match.');
      }
    };
    assertContext();
    let abort: (() => void) | undefined;
    try {
      const work = Promise.resolve().then(() => { assertContext(); return read(combined); });
      const value = combined ? await Promise.race([work, new Promise<never>((_, reject) => {
        abort = () => reject(combined.reason);
        combined.addEventListener('abort', abort, { once: true });
        if (combined.aborted) abort();
      })]) : await work;
      assertContext();
      const actual = parseAndroidAppObservation(value);
      for (const key of ['platform', 'deviceKey', 'appId', 'apkSha256', 'uid', 'pid'] as const) {
        if (actual[key] !== snapshot[key]) throw new NativeError('device_mismatch', `Android app readback ${key} does not match.`);
      }
      const canonical = (states: AndroidPermissionObservation[]) => JSON.stringify([...states].sort((a, b) => a.permission.localeCompare(b.permission))
        .map(state => ({ ...state, flags: [...state.flags].sort() })));
      if (canonical(actual.permissions) !== canonical(snapshot.permissions)) throw new NativeError('device_mismatch', 'Android app readback permissions do not match.');
      return { ...actual, ...binding, launchGeneration: snapshot.launchGeneration, adapterGeneration: identity.generation, coverage: 'platform-readback' };
    } finally { if (abort) combined?.removeEventListener('abort', abort); }
  } };
}
