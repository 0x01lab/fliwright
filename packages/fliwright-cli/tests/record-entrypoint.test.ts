import { describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/index.js';
import { recordCommand } from '../src/commands/record.js';

vi.mock('../src/commands/record.js', () => ({ recordCommand: vi.fn() }));

describe('record CLI entrypoint', () => {
  it('forwards the independent Dart verification file to the recording workflow', async () => {
    await createProgram().exitOverride().parseAsync(['node', 'fliwright', 'record', '--lang', 'dart',
      '--dart-app-entrypoint', 'package:demo/replay.dart', '--dart-verification', 'proof/verification.json']);
    expect(recordCommand).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'dart', dartAppEntrypoint: 'package:demo/replay.dart', dartVerificationFile: 'proof/verification.json',
    }));
  });
});
