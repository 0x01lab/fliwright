import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'tests', 'integration', 'suite', 'index.cjs'),
  launchArgs: [
    '--disable-workspace-trust',
    '--force-disable-user-env',
    '--disable-extensions',
    '--disable-gpu',
    '--skip-add-to-recently-opened',
  ],
});
