import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'package.json'), 'utf8'));

describe('VS Code manifest', () => {
  it('declares commands required by the VS Code extension design', () => {
    const commands = new Set(manifest.contributes.commands.map((entry: { command: string }) => entry.command));

    for (const command of [
      'fliwright.connect',
      'fliwright.disconnect',
      'fliwright.discoverVmService',
      'fliwright.runCurrentTest',
      'fliwright.runWorkspaceTests',
      'fliwright.openFailure',
      'fliwright.startRecording',
      'fliwright.stopRecording',
      'fliwright.insertRecordedTest',
      'fliwright.stopSandbox',
      'fliwright.reloadMocks',
      'fliwright.applyMockRule',
      'fliwright.stopMockRule',
      'fliwright.applyDefaultMocks',
      'fliwright.openMockConfig',
      'fliwright.createMockConfig',
      'fliwright.fillForm',
      'fliwright.analyzeForm',
      'fliwright.fillFormWithRules',
      'fliwright.reloadFormRules',
      'fliwright.openFormRules',
      'fliwright.createFormRules',
      'fliwright.insertFormFieldSelector',
      'fliwright.configureMcp',
    ]) {
      expect(commands.has(command), command).toBe(true);
    }
  });

  it('activates on every contributed command', () => {
    const activationEvents = new Set(manifest.activationEvents);
    for (const entry of manifest.contributes.commands as Array<{ command: string }>) {
      expect(activationEvents.has(`onCommand:${entry.command}`), entry.command).toBe(true);
    }
  });

  it('contributes CodeLens configuration', () => {
    expect(manifest.contributes.configuration.properties['fliwright.codeLensEnabled']).toMatchObject({
      type: 'boolean',
      default: true,
    });
  });
});
