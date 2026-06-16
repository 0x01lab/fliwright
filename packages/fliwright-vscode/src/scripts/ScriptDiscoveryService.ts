import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadConfig } from '../config.js';
import type { ScriptFileEntry } from '../types.js';

const DEFAULT_SCRIPT_GLOBS = [
  '.fliwright/scripts/**/*.js',
  '.fliwright/scripts/**/*.mjs',
  '.fliwright/scripts/**/*.cjs',
];

export class ScriptDiscoveryService {
  async discover(workspaceRoot: vscode.Uri): Promise<ScriptFileEntry[]> {
    const globs = expandScriptGlobs(loadConfig().scriptGlob);
    const seen = new Set<string>();
    const entries: ScriptFileEntry[] = [];

    for (const glob of globs) {
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, glob));
      for (const uri of uris) {
        if (seen.has(uri.fsPath)) continue;
        seen.add(uri.fsPath);
        entries.push({
          kind: 'scriptFile',
          uri,
          label: path.basename(uri.fsPath),
          description: path.relative(workspaceRoot.fsPath, uri.fsPath),
        });
      }
    }

    return entries.sort((a, b) => (a.description ?? a.label).localeCompare(b.description ?? b.label));
  }
}

export function expandScriptGlobs(value: string | undefined): string[] {
  const input = value?.trim();
  if (!input) return DEFAULT_SCRIPT_GLOBS;

  const expanded = expandBraces(input)
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);

  return expanded.length > 0 ? expanded : DEFAULT_SCRIPT_GLOBS;
}

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!match) return [pattern];
  const [, prefix, body, suffix] = match;
  return body.split(',').flatMap((part) => expandBraces(`${prefix}${part}${suffix}`));
}
