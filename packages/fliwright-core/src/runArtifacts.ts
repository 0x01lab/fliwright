import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

export const FLIWRIGHT_RUNS_ROOT_ENV = 'FLIWRIGHT_RUNS_ROOT';

export interface ProjectRunsRootResult {
  hash: string;
  rootDir: string;
  runsDir: string;
}

export interface ResolveFliwrightRunsRootOptions {
  /** Explicit root from config or caller options. Highest priority. */
  runsRoot?: string;
  /** Project root used for default and relative artifact paths. */
  projectRoot?: string;
  /** Environment source. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override the user home, primarily for tests. Defaults to os.homedir(). */
  homeDir?: string;
}

export interface EnsureFliwrightRunsRootOptions extends ResolveFliwrightRunsRootOptions {
  /** Project identity supplied by editor integrations. */
  projectPath?: string;
}

/** Locate the project config from nested working directories without loading TypeScript. */
export function resolveFliwrightProjectRoot(start = process.cwd()): string {
  const initial = resolve(start);
  let directory = initial;
  let packageRoot: string | undefined;
  while (true) {
    if (existsSync(join(directory, 'fliwright.config.ts'))) return directory;
    if (!packageRoot && existsSync(join(directory, 'package.json'))) packageRoot = directory;
    const parent = dirname(directory);
    if (parent === directory) return packageRoot ?? initial;
    directory = parent;
  }
}

export function resolveFliwrightRunsRoot(options: ResolveFliwrightRunsRootOptions = {}): string {
  const env = options.env ?? process.env;
  return resolve(options.projectRoot ?? resolveFliwrightProjectRoot(),
    options.runsRoot ?? env[FLIWRIGHT_RUNS_ROOT_ENV] ?? '.fliwright/runs');
}

/** Resolve reusable and temporary data independently of the run history. */
export function resolveFliwrightCacheRoot(options: { cacheRoot?: string; projectRoot?: string } = {}): string {
  return resolve(options.projectRoot ?? resolveFliwrightProjectRoot(), options.cacheRoot ?? '.fliwright/cache');
}

export async function ensureFliwrightRunsRoot(
  options: EnsureFliwrightRunsRootOptions = {},
): Promise<string> {
  const runsDir = resolveFliwrightRunsRoot(options);
  await mkdir(runsDir, { recursive: true });

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
