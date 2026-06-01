import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadConfig, resolveWorkspacePath } from '../config.js';
import { jsonErrorMessage, readJson, writeJson } from '../json.js';
import type {
  HttpMethod,
  InvalidFileEntry,
  MockDiscoveryResult,
  MockEndpointEntry,
  MockEndpointFile,
  MockIndexFile,
} from '../types.js';

const METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export class MockConfigService {
  async discover(workspaceRoot: vscode.Uri): Promise<MockDiscoveryResult> {
    const config = loadConfig();
    const mockRoot = resolveWorkspacePath(workspaceRoot, config.mockDir);
    const indexUri = resolveWorkspacePath(workspaceRoot, config.mockIndex);
    const invalid: InvalidFileEntry[] = [];
    const index = await this.loadIndex(indexUri, invalid);
    const apiRoot = vscode.Uri.joinPath(mockRoot, 'api');
    const uris = await this.findEndpointFiles(workspaceRoot, config.mockDir);
    const indexedFiles = new Set(index?.files.map((file) => normalizeRelative(file)) ?? []);
    const endpoints: MockEndpointEntry[] = [];

    for (const uri of uris) {
      try {
        const endpointFile = await readJson<MockEndpointFile>(uri);
        this.validateEndpointFile(endpointFile);
        const relativeToMockRoot = normalizeRelative(path.posix.relative(mockRoot.path, uri.path));
        const relativeToApiRoot = normalizeRelative(path.posix.relative(apiRoot.path, uri.path));
        endpoints.push({
          kind: 'endpoint',
          uri,
          endpointFile,
          indexed: indexedFiles.size === 0
            || indexedFiles.has(relativeToMockRoot)
            || indexedFiles.has(`api/${relativeToApiRoot}`),
          defaultRule: index?.defaultRule,
        });
      } catch (error) {
        invalid.push({
          kind: 'invalid',
          uri,
          label: path.basename(uri.path),
          error: jsonErrorMessage(error),
        });
      }
    }

    endpoints.sort((a, b) => a.endpointFile.endpoint.localeCompare(b.endpointFile.endpoint));
    invalid.sort((a, b) => a.label.localeCompare(b.label));
    return { root: mockRoot, indexUri, index, endpoints, invalid };
  }

  async createTemplate(workspaceRoot: vscode.Uri, fileName = 'example-api.json'): Promise<vscode.Uri> {
    const config = loadConfig();
    const apiRoot = vscode.Uri.joinPath(resolveWorkspacePath(workspaceRoot, config.mockDir), 'api');
    await vscode.workspace.fs.createDirectory(apiRoot);
    const uri = vscode.Uri.joinPath(apiRoot, ensureJsonFileName(fileName));
    await writeJson(uri, {
      version: 1,
      name: 'Example API',
      description: 'Example mock endpoint',
      method: 'GET',
      endpoint: '/api/example',
      rules: [
        {
          name: 'success',
          status: 200,
          delay: 0,
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            success: true,
          },
        },
      ],
    });
    return uri;
  }

  private async loadIndex(uri: vscode.Uri, invalid: InvalidFileEntry[]): Promise<MockIndexFile | undefined> {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      return undefined;
    }

    try {
      const index = await readJson<MockIndexFile>(uri);
      this.validateIndex(index);
      return index;
    } catch (error) {
      invalid.push({
        kind: 'invalid',
        uri,
        label: path.basename(uri.path),
        error: jsonErrorMessage(error),
      });
      return undefined;
    }
  }

  private async findEndpointFiles(workspaceRoot: vscode.Uri, mockDir: string): Promise<vscode.Uri[]> {
    const relativePattern = `${mockDir.replace(/\\/g, '/')}/api/*.json`;
    return vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, relativePattern));
  }

  private validateIndex(index: MockIndexFile): void {
    if (index.version !== 1) throw new Error('version must be 1');
    if (!Array.isArray(index.files)) throw new Error('files must be an array');
    for (const file of index.files) {
      if (typeof file !== 'string' || file.trim() === '') {
        throw new Error('files entries must be non-empty strings');
      }
    }
  }

  private validateEndpointFile(file: MockEndpointFile): void {
    if (file.version !== 1) throw new Error('version must be 1');
    if (typeof file.name !== 'string' || file.name.trim() === '') throw new Error('name is required');
    if (!METHODS.has(file.method)) throw new Error(`method must be one of ${Array.from(METHODS).join(', ')}`);
    if (typeof file.endpoint !== 'string' || !file.endpoint.startsWith('/')) {
      throw new Error('endpoint must start with /');
    }
    if (!Array.isArray(file.rules) || file.rules.length === 0) throw new Error('rules must be a non-empty array');
    file.rules.forEach((rule, index) => {
      if (typeof rule.name !== 'string' || rule.name.trim() === '') throw new Error(`rules[${index}].name is required`);
      if (!Number.isInteger(rule.status) || rule.status < 100 || rule.status > 599) {
        throw new Error(`rules[${index}].status must be an HTTP status code`);
      }
      if (rule.delay !== undefined && (!Number.isFinite(rule.delay) || rule.delay < 0)) {
        throw new Error(`rules[${index}].delay must be a non-negative number`);
      }
    });
  }
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function ensureJsonFileName(fileName: string): string {
  const trimmed = path.basename(fileName.trim() || 'example-api.json');
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
}
