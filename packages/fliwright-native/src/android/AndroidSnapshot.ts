import { randomUUID } from 'node:crypto';
import { SaxesParser } from 'saxes';
import { NativeError, type NativeFrame, type NativeIdentity, type NativeNode, type NativeSnapshot } from '@fliwright/core';

export interface AndroidScreenMetrics { width: number; height: number; scale: number; }

/** Parse a bounded Android accessibility hierarchy, never expanding a DTD. */
export function parseAndroidSnapshot(xml: string, identity: NativeIdentity, metrics: AndroidScreenMetrics,
  limits: { maxBytes?: number; maxNodes?: number; maxDepth?: number } = {}): NativeSnapshot {
  if (Buffer.byteLength(xml) > (limits.maxBytes ?? 8 * 1024 * 1024)) throw invalid('Native XML byte limit exceeded.');
  if (![metrics.width, metrics.height, metrics.scale].every(value => Number.isFinite(value) && value > 0)) throw invalid('Invalid Android screen metrics.');
  const nodes: NativeNode[] = [];
  const stack: Array<string | undefined> = [];
  let rotation = 0;
  let rootSeen = false;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => { throw invalid('DTD and external entities are not permitted in native snapshots.'); });
  parser.on('error', () => { throw invalid('Malformed Android accessibility XML.'); });
  parser.on('opentag', tag => {
    if (stack.length >= (limits.maxDepth ?? 256)) throw invalid('Native XML depth limit exceeded.');
    if (!stack.length) {
      if (tag.name !== 'hierarchy' || rootSeen) throw invalid('Expected exactly one accessibility hierarchy.');
      rootSeen = true;
      rotation = Number(tag.attributes.rotation ?? 0);
      if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) throw invalid('Invalid Android display rotation.');
      stack.push(undefined);
      return;
    }
    if (tag.name !== 'node') throw invalid('Unexpected Android hierarchy element.');
    if (nodes.length >= (limits.maxNodes ?? 20_000)) throw invalid('Native XML node limit exceeded.');
    const attributes = tag.attributes as Record<string, string>;
    const frame = bounds(attributes.bounds, metrics.scale);
    const width = (rotation % 2 ? metrics.height : metrics.width) / metrics.scale;
    const height = (rotation % 2 ? metrics.width : metrics.height) / metrics.scale;
    const password = attributes.password === 'true';
    const node: NativeNode = {
      id: `n${nodes.length}`, appId: attributes.package ?? '', resourceId: attributes['resource-id'],
      text: password ? undefined : attributes.text, label: attributes['content-desc'], className: attributes.class,
      parentId: stack.at(-1), password, frame, enabled: attributes.enabled === 'true',
      visible: attributes['visible-to-user'] !== 'false' && frame.width > 0 && frame.height > 0
        && frame.x < width && frame.y < height && frame.x + frame.width > 0 && frame.y + frame.height > 0,
      hittable: 'unknown',
    };
    nodes.push(node);
    stack.push(node.id);
  });
  parser.on('closetag', () => { stack.pop(); });
  try { parser.write(xml).close(); }
  catch (error) { throw error instanceof NativeError ? error : invalid('Malformed Android accessibility XML.'); }
  if (!rootSeen) throw invalid('Missing Android accessibility hierarchy.');
  return {
    id: randomUUID(), identity: { ...identity }, capturedAt: new Date().toISOString(), nodes,
    screen: { width: (rotation % 2 ? metrics.height : metrics.width) / metrics.scale,
      height: (rotation % 2 ? metrics.width : metrics.height) / metrics.scale,
      scale: metrics.scale, orientation: rotation % 2 ? 'landscape' : 'portrait' },
  };
}

function bounds(value: string | undefined, scale: number): NativeFrame {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value ?? '');
  if (!match) throw invalid('Invalid Android node bounds.');
  const [x, y, right, bottom] = match.slice(1).map(Number);
  if (![x, y, right, bottom].every(Number.isSafeInteger) || right < x || bottom < y) throw invalid('Invalid Android node bounds.');
  return { x: x / scale, y: y / scale, width: (right - x) / scale, height: (bottom - y) / scale };
}
function invalid(message: string): NativeError { return new NativeError('protocol_mismatch', message); }
