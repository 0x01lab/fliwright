import type { AndroidPermissionObservation } from '@fliwright/core';
import type { AndroidInstalledApp } from './AndroidManagedApp.js';
import type { AndroidPermissionCheckpoint } from './AndroidPermissionJournal.js';

export interface AndroidRecoveryApp extends AndroidInstalledApp {
  operation: string;
  leaseKey: string;
  ownerGeneration: string;
  forward?: { hostPort: number; devicePort: number };
}
export interface AndroidRecoveryPermission extends AndroidPermissionCheckpoint {
  appId: string;
  appSha256: string;
  appInstalledBySession: boolean;
}

export function decodeAndroidRecoveryApp(value: Record<string, unknown>): AndroidRecoveryApp {
  if (inspectAndroidAppJournal(value) !== 'bound') throw new Error('Invalid bound Android app record.');
  return structuredClone(value) as unknown as AndroidRecoveryApp;
}
export function decodeAndroidRecoveryPermission(value: Record<string, unknown>): AndroidRecoveryPermission {
  if (inspectAndroidPermissionJournal(value) !== 'bound' || value.appSha256 === null) throw new Error('Invalid bound Android permission record.');
  return structuredClone(value) as unknown as AndroidRecoveryPermission;
}

type Compatibility = 'bound' | 'legacy' | 'invalid';
const digest = /^[a-f0-9]{64}$/;
const journalId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const packageId = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const appOperations = new Set(['install', 'installed', 'launch', 'forward', 'running', 'uninstall', 'removed', 'remove-forward', 'stopped']);
const permissionNames = new Set(['camera', 'microphone']);
const permissionFlags = new Set(['USER_SET', 'USER_FIXED', 'USER_SENSITIVE_WHEN_GRANTED', 'USER_SENSITIVE_WHEN_DENIED']);

/** Strictly classifies local app journals; legacy means readable evidence without owner binding. */
export function inspectAndroidAppJournal(value: Record<string, unknown>): Compatibility {
  if (!object(value)) return 'invalid';
  if (value.version === 2) return validApp(value, false) ? 'legacy' : 'invalid';
  if (value.version !== 3 || !validApp(value, true)) return 'invalid';
  return 'bound';
}

/** Strictly classifies local permission journals; legacy records cannot authorize restoration. */
export function inspectAndroidPermissionJournal(value: Record<string, unknown>): Compatibility {
  if (!object(value)) return 'invalid';
  if (value.version === 1) return validPermission(value, false) ? 'legacy' : 'invalid';
  if (value.version !== 2 || !validPermission(value, true)) return 'invalid';
  return 'bound';
}

function validApp(value: Record<string, unknown>, bound: boolean): boolean {
  const allowed = ['version', 'journalId', 'deviceKey', ...(bound ? ['leaseKey', 'ownerGeneration'] : []), 'operation',
    'appId', 'activity', 'sha256', 'uid', 'installedBySession', 'minSdk', 'targetSdk', 'permissions', 'forward'];
  if (!keysWithin(value, allowed) || !journalId.test(String(value.journalId)) || !digest.test(String(value.deviceKey))
    || bound && (!digest.test(String(value.leaseKey)) || !digest.test(String(value.ownerGeneration)))
    || !appOperations.has(String(value.operation)) || typeof value.appId !== 'string' || !packageId.test(value.appId)
    || typeof value.activity !== 'string' || !value.activity || value.activity.length > 512
    || !digest.test(String(value.sha256)) || !uid(value.uid) || typeof value.installedBySession !== 'boolean'
    || !positiveVersion(value.minSdk) || !positiveVersion(value.targetSdk) || !stringArray(value.permissions, 256, value => /^android\.permission\.[A-Z_]+$/.test(value))) return false;
  const requiresForward = ['running', 'remove-forward'].includes(String(value.operation));
  if (value.forward === undefined) return !requiresForward;
  if (!object(value.forward) || !keysExactly(value.forward, ['hostPort', 'devicePort'])) return false;
  if (!port(value.forward.hostPort) || !port(value.forward.devicePort)) return false;
  return ['forward', 'running', 'remove-forward'].includes(String(value.operation));
}

function validPermission(value: Record<string, unknown>, bound: boolean): boolean {
  const allowed = ['version', 'journalId', 'deviceKey', ...(bound ? ['leaseKey', 'ownerGeneration', 'appSha256', 'appInstalledBySession'] : []),
    'appId', 'user', 'appOpPolicy', 'uid', 'baseline', 'declaration', 'desired', 'observed', 'status', 'step', 'permission', 'restored'];
  if (!keysWithin(value, allowed) || !journalId.test(String(value.journalId)) || !digest.test(String(value.deviceKey))
    || bound && (!digest.test(String(value.leaseKey)) || !digest.test(String(value.ownerGeneration))
      || value.appSha256 !== null && (typeof value.appSha256 !== 'string' || !digest.test(value.appSha256))
      || value.appInstalledBySession !== null && typeof value.appInstalledBySession !== 'boolean'
      || (value.appSha256 === null) !== (value.appInstalledBySession === null))
    || typeof value.appId !== 'string' || !packageId.test(value.appId) || value.user !== 0 || value.appOpPolicy !== 'default-package'
    || !uid(value.uid) || !observations(value.baseline) || !declarations(value.declaration) || !observations(value.desired)
    || value.observed !== undefined && !observations(value.observed)
    || !['pending', 'verified'].includes(String(value.status))
    || !['baseline', 'grant', 'revoke', 'clear-flags', 'set-flags', 'readback', 'stop', 'stopped'].includes(String(value.step))
    || value.permission !== undefined && !permissionNames.has(String(value.permission)) || typeof value.restored !== 'boolean') return false;
  const baseline = value.baseline, desired = value.desired, declaration = value.declaration;
  if (baseline.length !== desired.length || baseline.some(original => !desired.some(state => state.permission === original.permission))
    || declaration.some(item => !baseline.some(original => original.permission === item.permission))) return false;
  for (const original of baseline) {
    const state = desired.find(item => item.permission === original.permission)!;
    const requested = declaration.find(item => item.permission === original.permission)?.state;
    if (requested === undefined) {
      if (!sameState(state, original)) return false;
    } else {
      const flags = original.flags.filter(flag => flag !== 'USER_SET' && flag !== 'USER_FIXED');
      if (requested === 'denied') flags.push('USER_SET');
      if (!sameState(state, { permission: original.permission, granted: requested === 'granted', userSet: requested === 'denied', userFixed: false, flags })) return false;
    }
  }
  const writeStep = ['grant', 'revoke', 'clear-flags', 'set-flags'].includes(String(value.step));
  if (writeStep ? !desired.some(state => state.permission === value.permission) : value.permission !== undefined) return false;
  if (value.status === 'pending') return value.restored === false && value.observed === undefined;
  if (value.step === 'stopped') return value.observed === undefined && (!value.restored || baseline.length === 0);
  const observed = value.observed;
  if (value.step !== 'readback' || !observations(observed) || observed.length !== desired.length
    || desired.some(expected => !observed.some(actual => actual.permission === expected.permission && sameState(actual, expected)))) return false;
  return value.restored === baseline.every(original => observed.some(actual => actual.permission === original.permission && sameState(actual, original)));
}

function sameState(left: AndroidPermissionObservation, right: AndroidPermissionObservation): boolean {
  return left.granted === right.granted && left.userSet === right.userSet && left.userFixed === right.userFixed
    && left.flags.length === right.flags.length && left.flags.every(flag => right.flags.includes(flag));
}

function observations(value: unknown): value is AndroidPermissionObservation[] {
  if (!Array.isArray(value) || value.length > 2) return false;
  const seen = new Set<string>();
  return value.every(item => {
    if (!object(item) || !keysExactly(item, ['permission', 'granted', 'userSet', 'userFixed', 'flags'])
      || !permissionNames.has(String(item.permission)) || seen.has(String(item.permission))
      || typeof item.granted !== 'boolean' || typeof item.userSet !== 'boolean' || typeof item.userFixed !== 'boolean'
      || !stringArray(item.flags, permissionFlags.size, flag => permissionFlags.has(flag)) || new Set(item.flags).size !== item.flags.length
      || item.userSet !== item.flags.includes('USER_SET') || item.userFixed !== item.flags.includes('USER_FIXED')) return false;
    seen.add(String(item.permission));
    return true;
  });
}

function declarations(value: unknown): value is Array<{ permission: 'camera' | 'microphone'; state: 'granted' | 'denied' | 'prompt' }> {
  if (!Array.isArray(value) || value.length > 2) return false;
  const seen = new Set<string>();
  return value.every(item => {
    if (!object(item) || !keysExactly(item, ['permission', 'state']) || !permissionNames.has(String(item.permission))
      || seen.has(String(item.permission)) || !['granted', 'denied', 'prompt'].includes(String(item.state))) return false;
    seen.add(String(item.permission));
    return true;
  });
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keysWithin(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function keysExactly(value: Record<string, unknown>, expected: string[]): boolean { return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function uid(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 10000 && (value as number) < 100000; }
function port(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 65535; }
function positiveVersion(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1000; }
function stringArray(value: unknown, max: number, valid: (item: string) => boolean): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && valid(item)) && new Set(value).size === value.length;
}
