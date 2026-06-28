import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const FLIWRIGHT_RUNS_ROOT_ENV = 'FLIWRIGHT_RUNS_ROOT';

export interface ProjectRunsRootResult {
  hash: string;
  rootDir: string;
  runsDir: string;
}

export interface ResolveFliwrightRunsRootOptions {
  /** Explicit root from config or caller options. Highest priority. */
  runsRoot?: string;
  /** Workspace/project root used for the default per-project artifact path. */
  projectRoot?: string;
  /** Environment source. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override the user home, primarily for tests. Defaults to os.homedir(). */
  homeDir?: string;
}

export interface EnsureFliwrightRunsRootOptions extends ResolveFliwrightRunsRootOptions {
  /** Project path written to meta.json. Defaults to projectRoot. */
  projectPath?: string;
}

export function resolveFliwrightRunsRoot(options: ResolveFliwrightRunsRootOptions = {}): string {
  const env = options.env ?? process.env;
  return options.runsRoot
    ?? env[FLIWRIGHT_RUNS_ROOT_ENV]
    ?? projectRunsRoot(options.projectRoot ?? process.cwd(), options).runsDir;
}

export async function ensureFliwrightRunsRoot(
  options: EnsureFliwrightRunsRootOptions = {},
): Promise<string> {
  const runsDir = resolveFliwrightRunsRoot(options);
  await mkdir(runsDir, { recursive: true });

  const projectPath = options.projectPath ?? options.projectRoot ?? process.cwd();
  const defaultRoot = projectRunsRoot(projectPath, options);
  if (runsDir === defaultRoot.runsDir) {
    await writeFile(join(defaultRoot.rootDir, 'meta.json'), JSON.stringify({
      projectPath,
      updatedAt: Date.now(),
    }, null, 2), 'utf8');
  }
  return runsDir;
}

export function projectRunsRoot(
  projectPath: string,
  options: { homeDir?: string } = {},
): ProjectRunsRootResult {
  const home = options.homeDir ?? homedir();
  const hash = sanitizeProjectPathName(projectPath);
  const rootDir = join(home, '.fliwright', 'projects', hash);
  const runsDir = join(rootDir, 'runs');
  return { hash, rootDir, runsDir };
}

export function legacyProjectRunsRoot(
  projectPath: string,
  options: { homeDir?: string } = {},
): ProjectRunsRootResult {
  const home = options.homeDir ?? homedir();
  const hash = createHash('sha1').update(projectPath).digest('hex').slice(0, 12);
  const rootDir = join(home, '.fliwright', 'projects', hash);
  const runsDir = join(rootDir, 'runs');
  return { hash, rootDir, runsDir };
}

export function projectRunsRootCandidates(
  projectPath: string,
  options: { homeDir?: string } = {},
): ProjectRunsRootResult[] {
  const primary = projectRunsRoot(projectPath, options);
  const legacy = legacyProjectRunsRoot(projectPath, options);
  return primary.rootDir === legacy.rootDir ? [primary] : [primary, legacy];
}

export function sanitizeProjectPathName(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  const name = normalized.replace(/\//g, '-').replace(/^-+|-+$/g, '');
  return name || 'project';
}
