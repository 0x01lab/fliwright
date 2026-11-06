import { NativeError, type NativeIdentity, type NativeNode, type NativeSnapshot } from '@fliwright/core';

/** Validate the runner's wire payload before it can become a native observation. */
export function parseXctestSnapshot(value: unknown, identity: NativeIdentity, allowedApps: readonly string[]): NativeSnapshot {
  const payload = object(value);
  const screen = object(payload.screen);
  if (!Array.isArray(payload.nodes) || payload.nodes.length > 20_000) throw invalid();
  if (screen.orientation !== 'portrait' && screen.orientation !== 'landscape') throw invalid();
  const ids = new Set<string>();
  const nodes: NativeNode[] = payload.nodes.map(raw => {
    const node = object(raw), rect = object(node.frame);
    const id = string(node.id), appId = string(node.appId);
    if (ids.has(id) || !allowedApps.includes(appId)) throw invalid();
    ids.add(id);
    if (typeof node.enabled !== 'boolean' || typeof node.visible !== 'boolean'
      || (typeof node.hittable !== 'boolean' && node.hittable !== 'unknown')) throw invalid();
    const password = node.password === true;
    return { id, appId, resourceId: optionalString(node.resourceId), text: optionalString(node.text), label: optionalString(node.label),
      value: password ? undefined : optionalString(node.value), password,
      enabled: node.enabled, visible: node.visible, hittable: node.hittable,
      frame: { x: finite(rect.x), y: finite(rect.y), width: positive(rect.width, true), height: positive(rect.height, true) } };
  });
  const capturedAt = string(payload.capturedAt);
  if (!Number.isFinite(Date.parse(capturedAt))) throw invalid();
  return { id: string(payload.id), identity: { ...identity }, capturedAt, nodes,
    screen: { width: positive(screen.width), height: positive(screen.height), scale: positive(screen.scale), orientation: screen.orientation } };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 65536) throw invalid();
  return value;
}
function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === '') return value;
  return string(value);
}
function finite(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(); return value; }
function positive(value: unknown, zeroAllowed = false): number {
  const number = finite(value);
  if (zeroAllowed ? number < 0 : number <= 0) throw invalid();
  return number;
}
function invalid(): NativeError { return new NativeError('protocol_mismatch', 'Invalid XCTest native snapshot payload.'); }
