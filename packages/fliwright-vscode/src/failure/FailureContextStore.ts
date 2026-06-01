import * as path from 'node:path';
import * as vscode from 'vscode';
import { jsonErrorMessage, readJson } from '../json.js';
import type { FailureEntry, RunResult } from '../types.js';

export class FailureContextStore {
  async loadLatest(dir: vscode.Uri, result?: RunResult): Promise<FailureEntry[]> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '*.json'));
    const entries: FailureEntry[] = [];

    for (const uri of files) {
      try {
        const value = await readJson<unknown>(uri);
        entries.push(...normalizeFailures(value));
      } catch (error) {
        entries.push({
          testName: path.basename(uri.fsPath),
          timestamp: new Date().toISOString(),
          error: jsonErrorMessage(error),
        });
      }
    }

    if (entries.length > 0) {
      return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    return result?.results
      .filter((test) => !test.passed)
      .map((test) => ({
        testName: test.name,
        timestamp: new Date().toISOString(),
        error: test.error,
      })) ?? [];
  }
}

function normalizeFailures(value: unknown): FailureEntry[] {
  if (Array.isArray(value)) return value.flatMap(normalizeFailures);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.failures)) return record.failures.flatMap(normalizeFailures);
  if (Array.isArray(record.entries)) return record.entries.flatMap(normalizeFailures);
  return [{
    testName: String(record.testName ?? record.name ?? 'Unnamed failure'),
    assertion: record.assertion as FailureEntry['assertion'],
    widgetTree: record.widgetTree,
    source: record.source as FailureEntry['source'],
    healingSuggestion: record.healingSuggestion as FailureEntry['healingSuggestion'],
    screenshotPath: typeof record.screenshotPath === 'string' ? record.screenshotPath : undefined,
    timestamp: String(record.timestamp ?? new Date().toISOString()),
    error: typeof record.error === 'string' ? record.error : undefined,
  }];
}
