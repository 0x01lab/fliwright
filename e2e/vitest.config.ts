import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*.test.ts', 'smoke_test.ts'],
    testTimeout: 30000,
  },
});
