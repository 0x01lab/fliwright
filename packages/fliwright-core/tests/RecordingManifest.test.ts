import { describe, expect, it } from 'vitest';
import { parseRecordingManifest } from '../src/RecordingManifest.js';

const manifest = { schemaVersion: 2, id: 'recording', createdAt: '2026-10-17T00:00:00Z',
  updatedAt: '2026-10-17T00:00:00Z', rawEventCount: 2, operationCount: 1,
  frames: [{ id: 'frame', index: 0, kind: 'tap', status: 'ready', timestamp: 1,
    position: { x: 1, y: 2 }, screenshot: { path: 'screenshots/frame.png', byteLength: 3, format: 'png' } }],
};
describe('shared recording manifest', () => {
  it('loads metadata and file references without reading binaries', () => {
    expect(parseRecordingManifest(JSON.stringify(manifest))).toEqual(manifest);
  });
  it.each([
    { ...manifest, schemaVersion: 1 },
    { ...manifest, updatedAt: undefined },
    { ...manifest, rawEventCount: -1 },
    { ...manifest, frames: [{ screenshot: { base64: 'png', format: 'png' } }] },
    { ...manifest, recording: { frames: [{ screenshot: { base64: 'png', format: 'png' } }] } },
  ])('rejects replaced or invalid manifests', (value) => {
    expect(() => parseRecordingManifest(JSON.stringify(value))).toThrow(/recording/i);
  });
});
