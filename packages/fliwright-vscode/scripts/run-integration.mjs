import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
const platform = process.platform === 'darwin' && process.arch === 'arm64' ? 'darwin-arm64' : undefined;
const extensionTestsPath = path.join(root, 'tests', 'integration', 'suite', 'index.cjs');
const launchArgs = [
  '--disable-workspace-trust',
  '--force-disable-user-env',
  '--disable-gpu',
  '--skip-add-to-recently-opened',
];

// Recent macOS VS Code archives ship `Code` while older test-electron releases
// still resolve the launcher as `Electron`. Resolve the downloaded install once
// and pass the actual executable to runTests so the host test remains portable.
const downloadedExecutable = await downloadAndUnzipVSCode({
  version: process.env.FLIWRIGHT_VSCODE_VERSION ?? 'stable',
  platform,
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

if (process.argv.includes('--vsix')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const vsixPath = path.join(root, `${manifest.name}-${manifest.version}.vsix`);
  if (!fs.existsSync(vsixPath)) throw new Error(`Packaged VSIX not found: ${vsixPath}`);

  const profile = await fs.promises.mkdtemp(path.join(temporaryRoot, 'fw-vsix-'));
  const extensionsDir = path.join(profile, 'extensions');
  const userDataDir = path.join(profile, 'user-data');
  const testHarnessDir = path.join(profile, 'test-harness');
  try {
    const [cliPath, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath, { platform });
    await runCommand(cliPath, [
      ...cliArgs,
      `--extensions-dir=${extensionsDir}`,
      `--user-data-dir=${userDataDir}`,
      '--install-extension', vsixPath,
    ], { shell: process.platform === 'win32' });

    // VS Code starts extension tests from a development extension. Use a tiny
    // runner so the Fliwright extension itself is loaded from the installed VSIX.
    await fs.promises.mkdir(testHarnessDir);
    await fs.promises.writeFile(path.join(testHarnessDir, 'package.json'), JSON.stringify({
      name: 'fliwright-vsix-test-harness',
      publisher: 'fliwright',
      version: '0.0.0',
      engines: { vscode: manifest.engines.vscode },
      main: './extension.cjs',
    }));
    await fs.promises.writeFile(path.join(testHarnessDir, 'extension.cjs'), 'exports.activate = () => {};\n');
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: testHarnessDir,
      extensionTestsPath,
      extensionTestsEnv: {
        FLIWRIGHT_TEST_VSIX_ROOT: extensionsDir,
        FLIWRIGHT_TEST_VSIX_VERSION: manifest.version,
      },
      launchArgs: [
        `--extensions-dir=${extensionsDir}`,
        `--user-data-dir=${userDataDir}`,
        ...launchArgs,
      ],
    });
  } finally {
    await fs.promises.rm(profile, { recursive: true, force: true });
  }
} else {
  const profile = await fs.promises.mkdtemp(path.join(temporaryRoot, 'fw-vs-dev-'));
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: root,
      extensionTestsPath,
      launchArgs: ['--disable-extensions', `--user-data-dir=${profile}`, ...launchArgs],
    });
  } finally {
    await fs.promises.rm(profile, { recursive: true, force: true });
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`));
    });
  });
}
