import * as vscode from 'vscode';
import type { StateProviderEntry } from '../types.js';

export const STATE_PROVIDER_DOCUMENT_SCHEME = 'fliwright-provider';

export interface StateProviderDocument {
  provider: StateProviderEntry;
  value: unknown;
  readAt: string;
}

export class StateProviderDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly documents = new Map<string, StateProviderDocument>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    const document = this.documents.get(uri.toString());
    if (!document) {
      return JSON.stringify({
        error: 'Provider value is not loaded.',
        uri: uri.toString(),
      }, null, 2);
    }
    return JSON.stringify(providerDocumentContent(document), null, 2);
  }

  update(document: StateProviderDocument): vscode.Uri {
    const uri = providerDocumentUri(document.provider.key);
    this.documents.set(uri.toString(), document);
    this.onDidChangeEmitter.fire(uri);
    return uri;
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
    this.documents.clear();
  }
}

export function providerDocumentUri(providerKey: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: STATE_PROVIDER_DOCUMENT_SCHEME,
    authority: 'state',
    path: `/${encodeURIComponent(providerKey)}.json`,
    query: `provider=${encodeURIComponent(providerKey)}`,
  });
}

function providerDocumentContent(document: StateProviderDocument): Record<string, unknown> {
  const provider = document.provider;
  return {
    key: provider.key,
    type: provider.type,
    valueType: provider.valueType ?? inferValueType(document.value),
    readable: provider.readable ?? true,
    overridable: provider.overridable ?? false,
    watching: provider.watching ?? false,
    error: provider.error,
    readAt: document.readAt,
    value: document.value,
  };
}

function inferValueType(value: unknown): string {
  if (value === null) return 'Null';
  if (Array.isArray(value)) return 'List';
  return typeof value;
}
