import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { idSchema, type TestRequest } from '@fliwright/cloud-protocol';

export function catalogWorkspace(root: string, catalogId: string) {
  return resolve(root, 'projects', idSchema.parse(catalogId));
}

export function projectInCheckout(checkout: string, projectPath: string) {
  const root = realpathSync(checkout);
  const project = realpathSync(resolve(root, projectPath));
  const location = relative(root, project);
  if (isAbsolute(location) || location === '..' || location.startsWith('../') || !statSync(project).isDirectory())
    throw new Error('Project directory escapes checkout or is not a directory');
  return project;
}

export class CatalogWorkspaceUnavailable extends Error {
  constructor() {
    super('Local project workspace unavailable. Rescan this commit and run from the new test catalog.');
  }
}

export function openCatalogWorkspace(root: string, request: TestRequest) {
  try {
    if (!request.catalogId) throw new CatalogWorkspaceUnavailable();
    const workspace = catalogWorkspace(root, request.catalogId);
    const checkout = join(workspace, 'checkout');
    if (!lstatSync(workspace).isDirectory() || !lstatSync(checkout).isDirectory()) throw new CatalogWorkspaceUnavailable();
    const saved = JSON.parse(readFileSync(join(workspace, 'ready.json'), 'utf8'));
    if (saved.projectId !== request.input.targetId || saved.commit !== request.input.commit || saved.configRevision !== request.configRevision)
      throw new CatalogWorkspaceUnavailable();
    return { checkout, project: projectInCheckout(checkout, request.target.projectPath) };
  } catch {
    throw new CatalogWorkspaceUnavailable();
  }
}
