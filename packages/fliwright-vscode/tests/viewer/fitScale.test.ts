import { describe, expect, it } from 'vitest';
import { computeFitScale } from '../../src/webview/viewer/fitScale.js';

describe('computeFitScale', () => {
  it('downscales to fit the limiting dimension', () => {
    // 1000x500 image into 500x500 box -> width-limited -> 0.5
    expect(computeFitScale(500, 500, 1000, 500)).toBeCloseTo(0.5);
  });

  it('never upscales beyond 1x', () => {
    expect(computeFitScale(1000, 1000, 100, 100)).toBe(1);
  });

  it('returns 1 when the image already fits exactly', () => {
    expect(computeFitScale(500, 500, 500, 500)).toBe(1);
  });

  it('returns 1 for invalid/zero dimensions', () => {
    expect(computeFitScale(0, 500, 100, 100)).toBe(1);
    expect(computeFitScale(500, 500, 0, 100)).toBe(1);
    expect(computeFitScale(-1, 500, 100, 100)).toBe(1);
  });
});
