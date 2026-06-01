import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    alias: {
      vscode: fileURLToPath(new URL('./tests/stubs/vscode.ts', import.meta.url)),
    },
  },
});
