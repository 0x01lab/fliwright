import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'package.json'), 'utf8'));

describe('VS Code manifest', () => {
  it('uses the same extension identity in development and packaged VSIX builds', () => {
    expect(manifest.publisher).toBe('fliwright');
    expect(manifest.name).toBe('fliwright-vscode');
    expect(manifest.name).not.toMatch(/[\\/@]/);
  });

  it('includes the metadata required for Marketplace publication', () => {
    expect(manifest.displayName).toBe('Fliwright');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(manifest.license).toBe('MIT');
    expect(manifest.icon).toBe('media/fliwright-marketplace.png');
    expect(manifest.repository).toMatchObject({
      type: 'git',
      url: 'https://github.com/0x01lab/fliwright.git',
      directory: 'packages/fliwright-vscode',
    });
    expect(manifest.bugs.url).toBe('https://github.com/0x01lab/fliwright/issues');
    expect(manifest.homepage).toContain('packages/fliwright-vscode');
    expect(manifest.categories).toContain('Testing');
    expect(manifest.keywords).toContain('flutter');
    expect(manifest.galleryBanner).toEqual({ color: '#111827', theme: 'dark' });
  });

  it('declares commands required by the VS Code extension design', () => {
    const commands = new Set(manifest.contributes.commands.map((entry: { command: string }) => entry.command));

    for (const command of [
      'fliwright.connect',
      'fliwright.disconnect',
      'fliwright.discoverVmService',
      'fliwright.runCurrentTest',
      'fliwright.runWorkspaceTests',
      'fliwright.refreshTestFile',
      'fliwright.openFailure',
      'fliwright.startRecording',
      'fliwright.stopRecording',
      'fliwright.insertRecordedTest',
      'fliwright.stopSandbox',
      'fliwright.reloadMocks',
      'fliwright.reloadWebSocketMocks',
      'fliwright.applyMockRule',
      'fliwright.stopMockRule',
      'fliwright.applyDefaultMocks',
      'fliwright.openMockConfig',
      'fliwright.createMockConfig',
      'fliwright.createWebSocketMockProfile',
      'fliwright.createWebSocketMockProfileFromCall',
      'fliwright.openWebSocketMockProfile',
      'fliwright.inspectWebSocketMockCall',
      'fliwright.applyWebSocketMockProfile',
      'fliwright.clearWebSocketMockRules',
      'fliwright.sendWebSocketMockPush',
      'fliwright.refreshWebSocketMockCalls',
      'fliwright.clearWebSocketMockCalls',
      'fliwright.fillForm',
      'fliwright.analyzeForm',
      'fliwright.fillFormWithRules',
      'fliwright.reloadFormRules',
      'fliwright.openFormRules',
      'fliwright.createFormRules',
      'fliwright.insertFormFieldSelector',
      'fliwright.addAnalyzedFieldToFormRules',
      'fliwright.createFormRulesFromLastAnalyze',
      'fliwright.appendLastAnalyzeToFormRules',
      'fliwright.configureMcp',
      'fliwright.refreshStateProviders',
      'fliwright.readStateProvider',
      'fliwright.overrideStateProvider',
      'fliwright.watchStateProvider',
      'fliwright.unwatchStateProvider',
      'fliwright.copyStateProviderValue',
      'fliwright.openRiverpodSetupHelp',
      'fliwright.takeScreenshot',
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

  it('does not expose settings that auto-activate mock rules', () => {
    expect(manifest.contributes.configuration.properties['fliwright.autoApplyDefaultMocksOnConnect']).toBeUndefined();
    expect(manifest.contributes.configuration.properties['fliwright.restoreSelectedMocksOnConnect']).toBeUndefined();
  });

  it('guards recording commands with VS Code context keys', () => {
    const commands = new Map(manifest.contributes.commands.map((entry: { command: string }) => [entry.command, entry]));

    expect(commands.get('fliwright.startRecording')).toMatchObject({
      enablement: '!fliwright.recording.isRecording',
    });
    expect(commands.get('fliwright.stopRecording')).toMatchObject({
      enablement: 'fliwright.recording.isRecording',
    });
    expect(commands.get('fliwright.insertRecordedTest')).toMatchObject({
      enablement: 'fliwright.recording.hasPreview',
    });
  });

  it('shows the screenshot command in the Devices title actions', () => {
    const devicesTitleActions = manifest.contributes.menus['view/title']
      .filter((entry: { when?: string }) => entry.when === 'view == fliwright.devices')
      .map((entry: { command: string }) => entry.command);

    expect(devicesTitleActions).toContain('fliwright.takeScreenshot');
  });

  it('contributes the separate WebSocket mock view', () => {
    const views = manifest.contributes.views.fliwright as Array<{ id: string }>;
    expect(views).toContainEqual(expect.objectContaining({ id: 'fliwright.websocketMocks' }));
  });
});
