import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** Verify regular Node entry points and load fixtures inside an actual Vitest suite. */
export async function verifyConsumerImports(directory, run = promisify(execFile)) {
  await run(process.execPath, ['--input-type=module', '--eval', [
    "import { FliwrightDriver } from '@fliwright/core';",
    "import { DeviceDiscovery } from '@fliwright/devices';",
    "import { createNativeSession } from '@fliwright/native';",
    "import { defineConfig } from '@fliwright/cli';",
    "import { runCommand } from '@fliwright/cli/run';",
    "import { TddRuntime } from '@fliwright/tdd';",
    "import { riverpodPlugin } from '@fliwright/plugin-riverpod';",
    'if (![FliwrightDriver, DeviceDiscovery, createNativeSession, defineConfig, runCommand, TddRuntime, riverpodPlugin].every(Boolean)) throw new Error("missing public export");',
  ].join('\n')], { cwd: directory });
  await writeFile(join(directory, 'vitest.config.mjs'), [
    "import { fliwrightPreset } from '@fliwright/vitest/preset';",
    "export default fliwrightPreset({ test: { include: ['package-entry.test.mjs'] } });",
  ].join('\n'));
  await writeFile(join(directory, 'package-entry.test.mjs'), [
    "import { test } from '@fliwright/vitest';",
    "import { expect } from 'vitest';",
    "test('loads the installed Vitest fixture', () => { expect(typeof test).toBe('function'); });",
  ].join('\n'));
  await run(process.execPath, [join(directory, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', 'vitest.config.mjs', 'package-entry.test.mjs'], { cwd: directory });
}
