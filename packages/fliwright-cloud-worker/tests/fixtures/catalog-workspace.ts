import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogWorkspace } from '../../src/catalog-workspace.js';

export const workspaceIdentity = { projectId: 'app', commit: 'a'.repeat(40), configRevision: 1 };
export const catalogId = 'scan';

export function createCatalogWorkspace(root: string, projectPath = '.') {
  const workspace = catalogWorkspace(root, catalogId);
  const project = join(workspace, 'checkout', projectPath);
  mkdirSync(project, { recursive: true });
  writeFileSync(join(workspace, 'ready.json'), JSON.stringify(workspaceIdentity));
  return realpathSync(project);
}
