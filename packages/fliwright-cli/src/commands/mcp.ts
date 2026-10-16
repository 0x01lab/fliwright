import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawn } from 'node:child_process';

export type McpProfile = 'core' | 'development' | 'tdd' | 'flow' | 'full';

export function mcpConfigCommand(options: { profile?: McpProfile } = {}) {
  return {
    mcpServers: {
      fliwright: {
        command: 'fliwright-mcp',
        env: { FLIWRIGHT_MCP_TOOL_PROFILE: options.profile ?? 'core' },
      },
    },
  };
}

export async function mcpDoctorCommand(env: NodeJS.ProcessEnv = process.env) {
  const executable = await findExecutable('fliwright-mcp', env.PATH);
  return {
    available: Boolean(executable),
    executable,
    guidance: executable
      ? 'The optional MCP adapter is installed. Use `fliwright mcp serve` to start it.'
      : 'Install @fliwright/mcp, then ensure fliwright-mcp is available on PATH.',
  };
}

export function mcpServeCommand(options: { profile?: McpProfile; cwd?: string } = {}): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('fliwright-mcp', [], {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, FLIWRIGHT_MCP_TOOL_PROFILE: options.profile ?? 'core' },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

async function findExecutable(name: string, pathValue: string | undefined): Promise<string | null> {
  for (const directory of (pathValue ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, process.platform === 'win32' ? `${name}.cmd` : name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}
