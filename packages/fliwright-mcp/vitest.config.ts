import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    alias: {
      '@fliwright/tdd': fileURLToPath(new URL('../fliwright-tdd/src/index.ts', import.meta.url)),
    },
  },
});
