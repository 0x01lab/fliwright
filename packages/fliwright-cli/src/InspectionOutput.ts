import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { resolveProjectConfig } from './config.js';

/** Resolve explicit files or a unique temporary capture under the project's cache. */
export async function inspectionOutput(options: { cwd?: string; output?: string }, name: string): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  if (options.output) return resolve(cwd, options.output);
  const config = await resolveProjectConfig(cwd);
  return join(config.cacheRoot!, 'inspect', randomUUID(), `${name}.png`);
}
