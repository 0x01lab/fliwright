import { afterEach, describe, expect, it } from 'vitest';
import { __setRegisterCustomEditorProviderError, __setRegisterTreeDataProviderError } from 'vscode';
import { registerTestEditorProvider, registerTreeDataProvider } from '../src/extension.js';

describe('extension provider registration', () => {
  afterEach(() => {
    __setRegisterCustomEditorProviderError(undefined);
    __setRegisterTreeDataProviderError('fliwright.scripts', undefined);
  });

  it('does not fail activation when another Fliwright instance already registered the test editor', () => {
    const subscriptions: Array<{ dispose(): void }> = [];
    const logs: string[] = [];
    __setRegisterCustomEditorProviderError(new Error('Provider for viewType:fliwright.testEditor already registered.'));

    expect(() => registerTestEditorProvider(
      { subscriptions },
      {} as never,
      { appendLine: (message) => logs.push(message) },
    )).not.toThrow();

    expect(subscriptions).toHaveLength(0);
    expect(logs.join('\n')).toContain('already registered');
  });

  it('still surfaces unrelated custom editor registration failures', () => {
    __setRegisterCustomEditorProviderError(new Error('boom'));

    expect(() => registerTestEditorProvider(
      { subscriptions: [] },
      {} as never,
      { appendLine: () => {} },
    )).toThrow('boom');
  });

  it('does not fail activation when another Fliwright instance already registered a tree view', () => {
    const subscriptions: Array<{ dispose(): void }> = [];
    const logs: string[] = [];
    __setRegisterTreeDataProviderError(
      'fliwright.scripts',
      new Error('Cannot register multiple views with same id `fliwright.scripts`'),
    );

    expect(() => registerTreeDataProvider(
      { subscriptions },
      'fliwright.scripts',
      {} as never,
      { appendLine: (message) => logs.push(message) },
    )).not.toThrow();

    expect(subscriptions).toHaveLength(0);
    expect(logs.join('\n')).toContain('already registered');
  });

  it('still surfaces unrelated tree view registration failures', () => {
    __setRegisterTreeDataProviderError('fliwright.scripts', new Error('boom'));

    expect(() => registerTreeDataProvider(
      { subscriptions: [] },
      'fliwright.scripts',
      {} as never,
      { appendLine: () => {} },
    )).toThrow('boom');
  });
});
