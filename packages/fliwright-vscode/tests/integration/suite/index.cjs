const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('fliwright.fliwright-vscode')
    ?? vscode.extensions.all.find((item) => item.packageJSON?.displayName === 'Fliwright');
  assert.ok(extension, 'Fliwright extension should be discoverable');
  if (process.env.FLIWRIGHT_TEST_VSIX_ROOT) {
    const installedPath = path.relative(process.env.FLIWRIGHT_TEST_VSIX_ROOT, extension.extensionPath);
    assert.ok(installedPath && !installedPath.startsWith('..') && !path.isAbsolute(installedPath),
      `Extension should load from the installed VSIX, got ${extension.extensionPath}`);
    assert.equal(extension.packageJSON.version, process.env.FLIWRIGHT_TEST_VSIX_VERSION);
    for (const resource of [
      'dist/extension.js',
      'dist/catalog-worker.mjs',
      'dist/webview/recordingCanvas.js',
      'dist/webview/recordingCanvas.css',
      'dist/webview/tailwind.css',
      'dist/webview/viewerApp.js',
      'media/fliwright-activitybar.svg',
      'media/fliwright-marketplace.png',
    ]) {
      assert.ok(fs.existsSync(path.join(extension.extensionPath, resource)), `${resource} should be inside the installed VSIX`);
    }
  }
  await extension.activate();

  // Exercise the packaged collector using the real extension host's executable.
  const os = require('node:os');
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-editor-collection-'));
  try {
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.symlinkSync(path.dirname(require.resolve('vitest/package.json')), path.join(root, 'node_modules/vitest'), 'dir');
    fs.writeFileSync(path.join(root, 'editor.test.ts'), `
      import { test, beforeAll } from 'vitest';
      beforeAll(() => { throw new Error('collection must not run hooks'); });
      test.for(['home', 'assets'])('refresh %s', () => { throw new Error('collection must not run tests'); });
    `);
    const worker = path.join(extension.extensionPath, 'dist/catalog-worker.mjs');
    const { stdout } = await promisify(execFile)(process.execPath, [worker, JSON.stringify({ cwd: root, files: ['editor.test.ts'] })], {
      cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30_000,
    });
    const marker = 'FLIWRIGHT_EDITOR_CATALOG=';
    const line = stdout.split(/\r?\n/).find(value => value.startsWith(marker));
    assert.ok(line, 'Catalog worker should return collected tests');
    assert.deepEqual(JSON.parse(line.slice(marker.length)).files['editor.test.ts'], { nodes: [
      { kind: 'test', title: 'refresh home' }, { kind: 'test', title: 'refresh assets' },
    ] });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }


  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'fliwright.connect',
    'fliwright.runCurrentTest',
    'fliwright.openTestSource',
    'fliwright.runWorkspaceTests',
    'fliwright.openFailure',
    'fliwright.startRecording',
    'fliwright.stopRecording',
    'fliwright.insertRecordedTest',
    'fliwright.refreshStateProviders',
    'fliwright.takeScreenshot',
    'fliwright.takeLongScreenshot',
    'fliwright.searchMockApis',
    'fliwright.clearMockApiSearch',
    'fliwright.toggleActiveMockRules',
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }
  await vscode.commands.executeCommand('fliwright.toggleActiveMockRules');
  await vscode.commands.executeCommand('fliwright.toggleActiveMockRules');

  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-open-test-source-'));
  try {
    for (const kind of ['testFile', 'testCase']) {
      const sourcePath = path.join(sourceRoot, `${kind}.test.ts`);
      fs.writeFileSync(sourcePath, '// Test source navigation fixture.\n');
      const uri = vscode.Uri.file(sourcePath);
      const node = kind === 'testFile' ? { kind, uri } : { kind, fileUri: uri };
      await vscode.commands.executeCommand('fliwright.openTestSource', node);
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, sourcePath,
        `${kind} should open its source file`);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
    await vscode.commands.executeCommand('fliwright.openTestSource');
  } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
}

module.exports = { run };
