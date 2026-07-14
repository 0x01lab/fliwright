import { describe, expect, it } from 'vitest';
import { __setConfiguration, __setWorkspaceRoot } from 'vscode';
import { loadConfig } from '../src/config.js';
import { createWorkspace, writeText } from './helpers/workspace.js';

describe('loadConfig', () => {
  it('does not read E2E automation state from VS Code settings', async () => {
    const root = await createWorkspace();
    __setWorkspaceRoot(root);
    __setConfiguration({ e2eAutomationEnabled: true });

    expect(loadConfig().e2eAutomationEnabled).toBe(false);
  });

  it('reads E2E automation state from .fliwright/config.json', async () => {
    const root = await createWorkspace();
    __setWorkspaceRoot(root);
    __setConfiguration({ e2eAutomationEnabled: false });
    await writeText(root, '.fliwright/config.json', JSON.stringify({
      version: 1,
      e2eAutomation: {
        enabled: true,
        source: 'test',
      },
    }));

    expect(loadConfig().e2eAutomationEnabled).toBe(true);
  });
});
