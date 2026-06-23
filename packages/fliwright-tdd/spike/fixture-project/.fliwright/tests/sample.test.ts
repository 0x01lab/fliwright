import { describe, expect, test } from 'vitest';

describe('sample', () => {
  test('alpha passes', () => {
    expect(1 + 1).toBe(2);
  });

  test('beta fails', () => {
    expect(1 + 1).toBe(3);
  });
});
