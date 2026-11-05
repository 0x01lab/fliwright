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

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'fliwright.connect',
    'fliwright.runCurrentTest',
    'fliwright.runWorkspaceTests',
    'fliwright.openFailure',
    'fliwright.startRecording',
    'fliwright.stopRecording',
    'fliwright.insertRecordedTest',
    'fliwright.refreshStateProviders',
    'fliwright.takeScreenshot',
    'fliwright.takeLongScreenshot',
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }
}

module.exports = { run };
