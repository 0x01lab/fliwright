const assert = require('node:assert');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('fliwright.fliwright-vscode')
    ?? vscode.extensions.all.find((item) => item.packageJSON?.displayName === 'Fliwright');
  assert.ok(extension, 'Fliwright extension should be discoverable');
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
  ]) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }
}

module.exports = { run };
