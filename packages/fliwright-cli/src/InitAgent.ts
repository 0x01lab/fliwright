import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from './CommandRegistry.js';

const skillNames = ['fliwright-cli-workflows', 'fliwright-agent-memory', 'write-fliwright-tests', 'write-fliwright-mock-rules'];
const start = '<!-- fliwright:start -->';
const end = '<!-- fliwright:end -->';
const instructions = `${start}
## Fliwright Flutter automation

- Read .agents/skills/fliwright-cli-workflows/SKILL.md for CLI workflows; read fliwright-agent-memory when exploring or operating the app and reusing UI discoveries; read write-fliwright-tests for tests/scripts and write-fliwright-mock-rules for HTTP mock files.
- Run the project-local CLI from this Flutter project root: pnpm exec fliwright or npx --no-install fliwright.
- Discover commands with schema --json and schema <command.path> --json before calling them. Prefer --json; check exit code, ok and command-specific readiness/partial results, including data on failure.
- Start the bridge entrypoint test_driver/fliwright_app.dart. Repeated exploration uses session open and explicit --session; close sessions when finished. Inspect snapshots before interacting and open screenshot files returned at data.path.
- Keep tests in .fliwright/tests and scripts in .fliwright/scripts. Reuse project fixtures, stable Key/semantics/text locators and named composed TestScenario declarations. Never persist snapshot refs.
- Authenticated business tests seed app-owned auth state through auth.seedLoggedIn; never use real login, CAPTCHA bypass or generic auth provider overrides as setup. run --scenario prepares each attempt, including retries.
- run/script/record are finite commands and do not reuse --session. Preserve runId and artifact paths, inspect failures/timeline before repairing code, and query operation journals before retrying uncertain mutations.
- Do not commit VM Service URLs, credentials or generated run/cache artifacts. Do not claim live verification without a successful App connection and evidence.
${end}`;

export interface AgentSetupResult {
  name: 'codex';
  skills: string[];
  conflicts: string[];
}
interface Changes { created: string[]; updated: string[]; skipped: string[]; }
interface InstalledSkills { schemaVersion: 1; files: Record<string, string>; }

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Validate the complete bundled resource tree before creating project files. */
export async function prepareAgentSetup(project: string, skillsRoot = fileURLToPath(new URL('../dist/skills/', import.meta.url))) {
  const files = new Map<string, Buffer>();
  async function collect(directory: string, prefix: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await collect(join(directory, entry.name), relative);
      else if (entry.isFile()) files.set(relative, await readFile(join(directory, entry.name)));
      else throw new CliError('INIT_SKILLS_INVALID', `Unsupported bundled Skill resource: ${relative}`, 3);
    }
  }
  for (const name of skillNames) {
    if (!await exists(join(skillsRoot, name, 'SKILL.md'))) throw new CliError('INIT_SKILLS_MISSING', `CLI package is missing bundled Skill ${name}. Reinstall the published CLI package.`, 3);
    await collect(join(skillsRoot, name), name);
  }
  // Do not follow project symlinks when writing managed resources or instructions.
  for (const relative of ['.agents', '.agents/skills', '.agents/skills/.fliwright-managed.json', 'AGENTS.md']) {
    const target = join(project, relative);
    if (await exists(target) && (await lstat(target)).isSymbolicLink()) throw new CliError('INVALID_INPUT', `Refusing to replace linked ${relative}; configure Agent files in the owning project.`, 2);
  }
  const agentsPath = join(project, 'AGENTS.md');
  const agentsExisted = await exists(agentsPath);
  const agents = agentsExisted ? await readFile(agentsPath, 'utf8') : '';
  const starts = [...agents.matchAll(/<!-- fliwright:start -->/g)];
  const ends = [...agents.matchAll(/<!-- fliwright:end -->/g)];
  if (starts.length !== ends.length || starts.length > 1 || (starts.length === 1 && starts[0].index! >= ends[0].index!)) {
    throw new CliError('INVALID_INPUT', 'AGENTS.md has malformed Fliwright markers. Repair the managed block before running init.', 2);
  }

  const skillRoot = join(project, '.agents/skills');
  const statePath = join(skillRoot, '.fliwright-managed.json');
  let previous: InstalledSkills = { schemaVersion: 1, files: {} };
  if (await exists(statePath)) {
    try {
      const value = JSON.parse(await readFile(statePath, 'utf8')) as InstalledSkills;
      if (!value || value.schemaVersion !== 1 || !value.files || typeof value.files !== 'object' || Array.isArray(value.files) || Object.values(value.files).some((hash) => typeof hash !== 'string')) throw new Error('Invalid manifest');
      previous = value;
    } catch {
      throw new CliError('INVALID_INPUT', 'Invalid .agents/skills/.fliwright-managed.json. Restore it before updating Skills.', 2);
    }
  }

  return async (changes: Changes): Promise<AgentSetupResult> => {
    const next: InstalledSkills = { schemaVersion: 1, files: { ...previous.files } };
    const conflicts: string[] = [];
    const installed: string[] = [];
    for (const name of skillNames) {
      const directory = join(skillRoot, name);
      const owned = Object.keys(previous.files).some((file) => file.startsWith(`${name}/`));
      if (await exists(directory) && (!owned || (await lstat(directory)).isSymbolicLink())) {
        conflicts.push(`.agents/skills/${name}`);
        continue;
      }
      let complete = true;
      for (const [relative, content] of files) {
        if (!relative.startsWith(`${name}/`)) continue;
        const target = join(skillRoot, relative);
        const projectRelative = `.agents/skills/${relative}`;
        const parts = relative.split('/');
        let linked = false;
        for (let i = 1; i <= parts.length; i++) {
          const part = join(skillRoot, ...parts.slice(0, i));
          if (await exists(part) && (await lstat(part)).isSymbolicLink()) { linked = true; break; }
        }
        if (linked) { conflicts.push(projectRelative); complete = false; continue; }
        const old = await exists(target) ? await readFile(target) : undefined;
        const digest = hash(content);
        if (old && hash(old) !== digest && hash(old) !== previous.files[relative]) {
          conflicts.push(projectRelative); complete = false; continue;
        }
        if (!old || hash(old) !== digest) {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, content);
          (old ? changes.updated : changes.created).push(projectRelative);
        } else changes.skipped.push(projectRelative);
        next.files[relative] = digest;
      }
      if (complete) installed.push(name);
    }
    await mkdir(skillRoot, { recursive: true });
    const state = `${JSON.stringify(next, null, 2)}\n`;
    if (!await exists(statePath) || await readFile(statePath, 'utf8') !== state) {
      const existed = await exists(statePath);
      await writeFile(statePath, state);
      (existed ? changes.updated : changes.created).push('.agents/skills/.fliwright-managed.json');
    }
    const updated = starts.length ? agents.slice(0, starts[0].index) + instructions + agents.slice(ends[0].index! + end.length)
      : `${agents}${agents && !agents.endsWith('\n') ? '\n' : ''}${agents ? '\n' : ''}${instructions}\n`;
    if (updated !== agents) {
      await writeFile(agentsPath, updated);
      (agentsExisted ? changes.updated : changes.created).push('AGENTS.md');
    } else changes.skipped.push('AGENTS.md');
    return { name: 'codex', skills: installed, conflicts };
  };
}

function hash(content: Buffer): string { return createHash('sha256').update(content).digest('hex'); }
