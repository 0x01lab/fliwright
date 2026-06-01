import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Uri, workspace } from 'vscode';
import { FailureContextStore } from '../src/failure/FailureContextStore.js';
import { createWorkspace } from './helpers/workspace.js';

describe('FailureContextStore', () => {
  it('loads failure entries from json files', async () => {
    const root = await createWorkspace();
    const dir = Uri.file(path.join(root, '.fliwright', 'failures'));
    await workspace.fs.createDirectory(dir);
    await workspace.fs.writeFile(Uri.file(path.join(dir.fsPath, 'failure.json')), Buffer.from(JSON.stringify({
      testName: 'login fails',
      timestamp: '2026-06-01T00:00:00.000Z',
      healingSuggestion: {
        originalSelector: "{ text: 'Old' }",
        suggestedSelector: "{ text: 'New' }",
        confidence: 0.9,
      },
    })));

    const failures = await new FailureContextStore().loadLatest(dir);

    expect(failures[0]).toMatchObject({
      testName: 'login fails',
      healingSuggestion: { suggestedSelector: "{ text: 'New' }" },
    });
  });
});
