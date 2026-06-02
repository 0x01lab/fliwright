import { describe, expect, it } from 'vitest';
import { Uri, __setConfiguration } from 'vscode';
import { FliwrightCodeLensProvider } from '../src/runner/FliwrightCodeLensProvider.js';

describe('FliwrightCodeLensProvider', () => {
  it('shows Fliwright actions for TypeScript test files', () => {
    __setConfiguration({ codeLensEnabled: true });
    const provider = new FliwrightCodeLensProvider();

    const lenses = provider.provideCodeLenses(document('/workspace/tests/login.test.ts', ''));

    expect(lenses.map((lens) => lens.command?.title)).toEqual([
      'Run Fliwright Test',
      'Run Test With Failure Context',
      'Record After This Test',
    ]);
    expect(lenses[0]?.command?.command).toBe('fliwright.runCurrentTest');
    expect(lenses[2]?.command?.command).toBe('fliwright.startRecording');
  });

  it('shows Fliwright actions for files importing @fliwright/vitest', () => {
    __setConfiguration({ codeLensEnabled: true });
    const provider = new FliwrightCodeLensProvider();

    const lenses = provider.provideCodeLenses(document('/workspace/custom/e2e.ts', "import { test } from '@fliwright/vitest';"));

    expect(lenses).toHaveLength(3);
  });

  it('does not show actions when disabled', () => {
    __setConfiguration({ codeLensEnabled: false });
    const provider = new FliwrightCodeLensProvider();

    const lenses = provider.provideCodeLenses(document('/workspace/tests/login.test.ts', "import { test } from '@fliwright/vitest';"));

    expect(lenses).toEqual([]);
  });
});

function document(filePath: string, text: string) {
  return {
    uri: Uri.file(filePath),
    getText: () => text,
  } as any;
}
