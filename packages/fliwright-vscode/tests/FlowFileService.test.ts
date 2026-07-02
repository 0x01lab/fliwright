import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { FlowFileService } from '../src/flows/FlowFileService.js';
import { createWorkspace, readText } from './helpers/workspace.js';

describe('FlowFileService', () => {
  it('creates a manual empty flow under .fliwright/flows', async () => {
    const root = await createWorkspace();
    const service = new FlowFileService();

    const created = await service.create(Uri.file(root), { title: 'Checkout Happy Path' });

    expect(created.uri.fsPath).toBe(path.join(root, '.fliwright', 'flows', 'checkout-happy-path.flow.json'));
    expect(created.flow).toEqual(expect.objectContaining({
      version: 1,
      id: 'checkout-happy-path',
      title: 'Checkout Happy Path',
      source: { kind: 'manual' },
      nodes: [],
      edges: [],
    }));
    const persisted = JSON.parse(await readText(root, '.fliwright/flows/checkout-happy-path.flow.json'));
    expect(persisted.id).toBe('checkout-happy-path');
  });

  it('avoids overwriting an existing flow file', async () => {
    const root = await createWorkspace();
    const service = new FlowFileService();
    await service.create(Uri.file(root), { title: 'Checkout Happy Path' });

    const created = await service.create(Uri.file(root), { title: 'Checkout Happy Path' });

    expect(created.flow.id).toBe('checkout-happy-path-2');
    expect(created.uri.fsPath).toBe(path.join(root, '.fliwright', 'flows', 'checkout-happy-path-2.flow.json'));
  });
});
