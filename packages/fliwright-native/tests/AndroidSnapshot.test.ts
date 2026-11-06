import { describe, expect, it } from 'vitest';
import { parseAndroidSnapshot } from '../src/android/AndroidSnapshot.js';

const identity = { platform: 'android' as const, deviceId: 'device', appId: 'example.app', backend: 'adb', generation: 'one' };
const xml = `<?xml version="1.0"?><hierarchy rotation="0"><node package="example.app" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" enabled="true"><node package="example.app" text="Allow &amp; continue" content-desc="Confirm" resource-id="example.app:id/button" bounds="[30,90][330,210]" enabled="true"/><node package="system.ui" text="private" password="true" bounds="[0,0][100,100]" enabled="true"/></node></hierarchy>`;

describe('Android snapshot normalization', () => {
  it('parses the complete XML tree, entities and parents and converts physical bounds to logical coordinates', () => {
    const snapshot = parseAndroidSnapshot(xml, identity, { width: 1080, height: 2400, scale: 3 });
    expect(snapshot.nodes).toHaveLength(3);
    expect(snapshot.nodes[1]).toMatchObject({ appId: 'example.app', resourceId: 'example.app:id/button', text: 'Allow & continue',
      parentId: snapshot.nodes[0].id, frame: { x: 10, y: 30, width: 100, height: 40 }, visible: true, hittable: 'unknown' });
    expect(snapshot.nodes[2].text).not.toBe('private');
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });
  it('handles landscape rotation and empty but valid accessibility trees', () => {
    const snapshot = parseAndroidSnapshot('<hierarchy rotation="1"/>', identity, { width: 1080, height: 2400, scale: 3 });
    expect(snapshot.screen).toEqual({ width: 800, height: 360, scale: 3, orientation: 'landscape' });
    expect(snapshot.nodes).toEqual([]);
  });
  it.each([
    '<hierarchy><node></hierarchy>',
    '<!DOCTYPE hierarchy [<!ENTITY ext SYSTEM "file:///secret">]><hierarchy/>',
    '<other/>',
    '<hierarchy rotation="9"/>',
    '<hierarchy><node bounds="invalid"/></hierarchy>',
  ])('rejects malformed, entity-bearing and unexpected hierarchy output', value => {
    expect(() => parseAndroidSnapshot(value, identity, { width: 100, height: 200, scale: 1 })).toThrow();
  });
  it('bounds node and byte counts independently', () => {
    expect(() => parseAndroidSnapshot(xml, identity, { width: 1080, height: 2400, scale: 3 }, { maxNodes: 1 })).toThrow(/limit/i);
    expect(() => parseAndroidSnapshot(xml, identity, { width: 1080, height: 2400, scale: 3 }, { maxBytes: 20 })).toThrow(/limit/i);
  });
});
