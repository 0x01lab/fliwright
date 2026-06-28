import { describe, expect, it } from 'vitest';
import { viewportEmptyHint } from '../../src/webview/viewer/components/Viewport.js';

describe('viewportEmptyHint', () => {
  it('explains timeline screenshot sources', () => {
    expect(viewportEmptyHint('timeline')).toContain('flow.frame');
    expect(viewportEmptyHint('timeline')).toContain('failed locator assertions');
  });

  it('explains action trace screenshot capture modes', () => {
    expect(viewportEmptyHint('actions')).toContain('trace mode "full"');
    expect(viewportEmptyHint('actions')).toContain('"on-failure"');
  });

  it('handles missing selection', () => {
    expect(viewportEmptyHint(undefined)).toContain('timeline or action trace data');
  });
});
