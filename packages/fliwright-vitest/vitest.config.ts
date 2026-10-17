import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    runner: new URL('./src/runner.ts', import.meta.url).pathname,
    include: ['tests/**/*.test.ts'],
  },
});
