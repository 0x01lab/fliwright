import { describe, expect, it } from 'vitest';
import { parseXctestSnapshot } from '../src/ios/XctestSnapshot.js';

const identity = { platform: 'ios' as const, deviceId: 'sim', appId: 'example.app', backend: 'xctest', generation: 'one' };
function payload() {
  return { id: 'snapshot', capturedAt: new Date().toISOString(), screen: { width: 400, height: 800, scale: 3, orientation: 'portrait' },
    nodes: [{ id: 'n1', appId: 'example.app', resourceId: 'button', text: 'Button', label: 'Button', enabled: true, visible: true, hittable: true,
      frame: { x: 10, y: 20, width: 100, height: 40 } }] };
}
describe('XCTest snapshot protocol', () => {
  it('normalizes points and removes secure field values even if a runner accidentally includes them', () => {
    const data = payload();
    const result = parseXctestSnapshot({ ...data, nodes: [{ ...data.nodes[0], password: true, value: 'private-value' }] }, identity, ['example.app']);
    expect(result.identity).toEqual(identity);
    expect(JSON.stringify(result)).not.toContain('private-value');
  });
  it('rejects arbitrary application data, duplicate IDs and invalid geometry', () => {
    const data = payload();
    expect(() => parseXctestSnapshot({ ...data, nodes: [{ ...data.nodes[0], appId: 'untrusted' }] }, identity, ['example.app'])).toThrow();
    expect(() => parseXctestSnapshot({ ...data, nodes: [data.nodes[0], data.nodes[0]] }, identity, ['example.app'])).toThrow();
    expect(() => parseXctestSnapshot({ ...data, screen: { ...data.screen, scale: 0 } }, identity, ['example.app'])).toThrow();
    expect(() => parseXctestSnapshot({ ...data, nodes: [{ ...data.nodes[0], frame: { x: 0, y: 0, width: -1, height: 1 } }] }, identity, ['example.app'])).toThrow();
  });
});
