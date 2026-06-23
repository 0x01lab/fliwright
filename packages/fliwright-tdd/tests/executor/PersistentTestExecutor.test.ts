import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PersistentTestExecutor } from '../../src/executor/PersistentTestExecutor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('PersistentTestExecutor.rerun', () => {
  it('reports red for a failing fixture test and green for a passing one', async () => {
    const executor = new PersistentTestExecutor();

    await executor.boot({
      configRoot: resolve(__dirname, '../../spike/fixture-project/vitest.config.ts'),
      vmServiceUrl: 'ws://runtime/ws',
      driverProvider: async () => ({}),
    });

    try {
      expect(process.env.FLIWRIGHT_VM_SERVICE_URL).toBe('ws://runtime/ws');
      const failing = await executor.rerun(resolve(__dirname, '../../spike/fixture-project/.fliwright/tests/sample.test.ts'), 'beta fails');
      expect(failing.status).toBe('red');

      const passing = await executor.rerun(resolve(__dirname, '../../spike/fixture-project/.fliwright/tests/sample.test.ts'), 'alpha passes');
      expect(passing.status).toBe('green');
    } finally {
      await executor.dispose();
    }
    expect(process.env.FLIWRIGHT_VM_SERVICE_URL).not.toBe('ws://runtime/ws');
  }, 30_000);
});
