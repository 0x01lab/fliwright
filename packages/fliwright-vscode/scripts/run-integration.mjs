import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Recent macOS VS Code archives ship `Code` while older test-electron releases
// still resolve the launcher as `Electron`. Resolve the downloaded install once
// and pass the actual executable to runTests so the host test remains portable.
const downloadedExecutable = await downloadAndUnzipVSCode({
  version: process.env.FLIWRIGHT_VSCODE_VERSION ?? 'stable',
  platform: process.platform === 'darwin' && process.arch === 'arm64'
    ? 'darwin-arm64'
    : undefined,
  cachePath: path.join(root, '.vscode-test'),
});
const vscodeExecutablePath = fs.existsSync(downloadedExecutable)
  ? downloadedExecutable
  : downloadedExecutable.endsWith('/Contents/MacOS/Electron')
    ? downloadedExecutable.replace(/\/Electron$/, '/Code')
    : downloadedExecutable;

if (!fs.existsSync(vscodeExecutablePath)) {
  throw new Error(`VS Code executable was not found at ${downloadedExecutable}`);
}

await runTests({
  vscodeExecutablePath,
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
