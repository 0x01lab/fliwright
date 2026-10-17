import { defineConfig } from 'vitest/config';
import { fliwrightPreset } from '@fliwright/vitest/preset';

export default defineConfig({
  test: {
    ...fliwrightPreset().test,
    include: ['*.test.ts', '*_test.ts'],
    testTimeout: 30000,
  },
});
