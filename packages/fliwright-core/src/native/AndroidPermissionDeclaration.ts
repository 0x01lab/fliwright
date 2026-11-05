import { NativeError } from './types.js';
import type { TestScenario, ScenarioDeviceLayer } from '../Scenario.js';
import type { AndroidPermissionObservation } from './AndroidAppReadback.js';

export interface AndroidPermissionDeclaration {
  permission: 'camera' | 'microphone';
  state: 'granted' | 'denied' | 'prompt';
}

/** Pure declaration decoding; does not authorize preparation or promote platform support. */
export function parseAndroidPermissionDeclarations(value: unknown): AndroidPermissionDeclaration[] {
  if (!Array.isArray(value) || value.length > 2) return invalid();
  const seen = new Set<string>();
  return Array.from(value).map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => key !== 'permission' && key !== 'state')
      || !['camera', 'microphone'].includes(item.permission) || !['granted', 'denied', 'prompt'].includes(item.state)
      || seen.has(item.permission)) return invalid();
    seen.add(item.permission);
    return { permission: item.permission, state: item.state };
  });
}

/** Call with the resolved scene; absent layers/permissions replace the declaration with empty. */
export function getAndroidScenarioPermissions(scenario?: TestScenario): AndroidPermissionDeclaration[] {
  const layers = scenario?.layers.filter((layer): layer is ScenarioDeviceLayer => layer.kind === 'device') ?? [];
  if (layers.length > 1) return invalid();
  const permissions = layers[0]?.permissions;
  return parseAndroidPermissionDeclarations(permissions === undefined ? [] : permissions);
}

/** Check requested semantics independently of the supervisor; omitted tracked values belong to its original baseline. */
export function assertAndroidPermissionDeclaration(input: unknown, states: readonly AndroidPermissionObservation[]): void {
  for (const request of parseAndroidPermissionDeclarations(input)) {
    const matches = states.filter(state => state.permission === request.permission);
    const state = matches[0];
    if (matches.length !== 1 || state.granted !== (request.state === 'granted') || state.userFixed
      || state.userSet !== (request.state === 'denied') || state.flags.includes('USER_FIXED')
      || state.flags.includes('USER_SET') !== state.userSet) invalid();
  }
}

function invalid(): never {
  throw new NativeError('device_mismatch', 'Android permission declaration is invalid or does not match the observed state.');
}
