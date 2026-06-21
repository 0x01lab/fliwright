import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const FLIWRIGHT_WORKSPACE_CONFIG_PATH = join('.fliwright', 'config.json');

export interface FliwrightWorkspaceConfig {
  version: 1;
  vmServiceUrl?: string;
  vmServiceUpdatedAt?: string;
  vmServiceSource?: string;
  [key: string]: unknown;
}

export function workspaceConfigPath(cwd = process.cwd()): string {
  return join(cwd, FLIWRIGHT_WORKSPACE_CONFIG_PATH);
}

export function readWorkspaceConfigSync(cwd = process.cwd()): FliwrightWorkspaceConfig {
  const filePath = workspaceConfigPath(cwd);
  if (!existsSync(filePath)) return { version: 1 };
  try {
    return normalizeWorkspaceConfig(JSON.parse(readFileSync(filePath, 'utf-8')));
  } catch {
    return { version: 1 };
  }
}

export async function readWorkspaceConfig(cwd = process.cwd()): Promise<FliwrightWorkspaceConfig> {
  try {
    return normalizeWorkspaceConfig(JSON.parse(await readFile(workspaceConfigPath(cwd), 'utf-8')));
  } catch {
    return { version: 1 };
  }
}

export async function writeWorkspaceConfig(
  patch: Partial<FliwrightWorkspaceConfig>,
  cwd = process.cwd(),
): Promise<FliwrightWorkspaceConfig> {
  const next: FliwrightWorkspaceConfig = {
    ...(await readWorkspaceConfig(cwd)),
    ...patch,
    version: 1,
  };
  const filePath = workspaceConfigPath(cwd);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

export async function writeWorkspaceVmServiceUrl(
  vmServiceUrl: string,
  options: { cwd?: string; source?: string } = {},
): Promise<FliwrightWorkspaceConfig> {
  return writeWorkspaceConfig({
    vmServiceUrl,
    vmServiceSource: options.source ?? 'unknown',
    vmServiceUpdatedAt: new Date().toISOString(),
  }, options.cwd);
}

export async function clearWorkspaceVmServiceUrl(
  options: { cwd?: string; source?: string } = {},
): Promise<FliwrightWorkspaceConfig> {
  return writeWorkspaceConfig({
    vmServiceUrl: undefined,
    vmServiceSource: options.source ?? 'unknown',
    vmServiceUpdatedAt: new Date().toISOString(),
  }, options.cwd);
}

function normalizeWorkspaceConfig(value: unknown): FliwrightWorkspaceConfig {
  if (!value || typeof value !== 'object') return { version: 1 };
  const {
    version: _version,
    vmServiceUrl,
    vmServiceUpdatedAt,
    vmServiceSource,
    ...rest
  } = value as Record<string, unknown>;
  return {
    ...rest,
    version: 1,
    ...(typeof vmServiceUrl === 'string' ? { vmServiceUrl } : {}),
    ...(typeof vmServiceUpdatedAt === 'string' ? { vmServiceUpdatedAt } : {}),
    ...(typeof vmServiceSource === 'string' ? { vmServiceSource } : {}),
  };
}
