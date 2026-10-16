import { describe, expect, it } from 'vitest';
import { createFliwrightServer, resolveMcpToolProfile } from '../src/index.js';

describe('library entrypoint', () => {
  it('exports server construction without starting stdio transport', () => {
    expect(createFliwrightServer).toBeTypeOf('function');
    expect(resolveMcpToolProfile(undefined)).toBe('core');
  });
});
