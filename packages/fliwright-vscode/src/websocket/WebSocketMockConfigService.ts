import * as path from 'node:path';
import * as vscode from 'vscode';
import { getWorkspaceRoot } from '../config.js';
import { jsonErrorMessage, readJson, writeJson } from '../json.js';
import type {
  InvalidFileEntry,
  WebSocketMockDiscoveryResult,
  WebSocketMockProfileEntry,
  WebSocketMockProfileFile,
  WebSocketMockPushTemplate,
  WebSocketMockRuleFile,
} from '../types.js';

const MOCK_DIRECTORY = '.fliwright/mocks/websocket';

export class WebSocketMockConfigService {
  async discover(workspaceRoot = getWorkspaceRoot()): Promise<WebSocketMockDiscoveryResult | undefined> {
    if (!workspaceRoot) return undefined;
    const root = vscode.Uri.joinPath(workspaceRoot, MOCK_DIRECTORY);
    const invalid: InvalidFileEntry[] = [];
    const profiles: WebSocketMockProfileEntry[] = [];
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, `${MOCK_DIRECTORY}/*.json`));

    for (const uri of files) {
      try {
        const profile = await readJson<WebSocketMockProfileFile>(uri);
        this.validateProfile(profile);
        profiles.push({ kind: 'websocketProfile', uri, profile });
      } catch (error) {
        invalid.push({
          kind: 'invalid',
          uri,
          label: path.basename(uri.path),
          error: jsonErrorMessage(error),
        });
      }
    }

    profiles.sort((left, right) => left.profile.name.localeCompare(right.profile.name));
    invalid.sort((left, right) => left.label.localeCompare(right.label));
    return { root, profiles, invalid };
  }

  async createTemplate(workspaceRoot: vscode.Uri, fileName = 'example-websocket.json'): Promise<vscode.Uri> {
    const root = vscode.Uri.joinPath(workspaceRoot, MOCK_DIRECTORY);
    await vscode.workspace.fs.createDirectory(root);
    const uri = vscode.Uri.joinPath(root, ensureJsonFileName(fileName));
    await writeJson(uri, {
      version: 1,
      name: 'Example WebSocket profile',
      description: 'Mock selected subscriptions while the real connection remains active.',
      rules: [{
        id: 'orders',
        connection: 'public',
        channel: '/topic/orders',
        suppressRemote: true,
        onSubscribe: [{ payload: { id: 'mock-order-1', status: 'created' }, delayMs: 100 }],
      }],
      pushes: [{
        name: 'Order filled',
        connection: 'public',
        channel: '/topic/orders',
        payload: { id: 'mock-order-1', status: 'filled' },
      }],
    } satisfies WebSocketMockProfileFile);
    return uri;
  }

  async createProfileFromCall(
    workspaceRoot: vscode.Uri,
    fileName: string,
    call: { connection: string; channel?: string; direction: string; mockPayload?: unknown; payload?: unknown },
  ): Promise<vscode.Uri> {
    if (!call.channel) throw new Error('The selected WebSocket call has no topic or channel.');
    const payload = call.mockPayload ?? call.payload;
    if (payload === undefined) {
      throw new Error('The selected WebSocket call has no replayable payload.');
    }
    const rule = {
      id: `${call.connection}-${call.channel}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      connection: call.connection,
      channel: call.channel,
      suppressRemote: true,
      ...(call.direction === 'inbound' || call.direction === 'mock'
        ? { onSubscribe: [{ payload }] }
        : {}),
    };
    return this.writeProfile(workspaceRoot, fileName, {
      version: 1,
      name: `${call.connection} ${call.channel}`,
      description: `Created from observed ${call.direction} traffic.`,
      rules: [rule],
      pushes: call.direction === 'inbound' || call.direction === 'mock'
        ? [{
          name: 'Replay observed message',
          connection: call.connection,
          channel: call.channel,
          payload,
        }]
        : [],
    });
  }

  private async writeProfile(
    workspaceRoot: vscode.Uri,
    fileName: string,
    profile: WebSocketMockProfileFile,
  ): Promise<vscode.Uri> {
    const root = vscode.Uri.joinPath(workspaceRoot, MOCK_DIRECTORY);
    await vscode.workspace.fs.createDirectory(root);
    const uri = vscode.Uri.joinPath(root, ensureJsonFileName(fileName));
    await writeJson(uri, profile);
    return uri;
  }

  private validateProfile(profile: WebSocketMockProfileFile): void {
    if (profile.version !== 1) throw new Error('version must be 1');
    if (typeof profile.name !== 'string' || profile.name.trim() === '') throw new Error('name is required');
    if (!Array.isArray(profile.rules)) throw new Error('rules must be an array');
    profile.rules.forEach((rule, index) => this.validateRule(rule, `rules[${index}]`));
    if (profile.pushes !== undefined) {
      if (!Array.isArray(profile.pushes)) throw new Error('pushes must be an array');
      profile.pushes.forEach((push, index) => this.validatePush(push, `pushes[${index}]`));
    }
  }

  private validateRule(rule: WebSocketMockRuleFile, field: string): void {
    if (typeof rule.id !== 'string' || rule.id.trim() === '') throw new Error(`${field}.id is required`);
    this.validateTarget(rule.connection, rule.channel, field);
    if (rule.suppressRemote !== undefined && typeof rule.suppressRemote !== 'boolean') {
      throw new Error(`${field}.suppressRemote must be a boolean`);
    }
    if (rule.onSubscribe !== undefined) {
      if (!Array.isArray(rule.onSubscribe)) throw new Error(`${field}.onSubscribe must be an array`);
      rule.onSubscribe.forEach((push, index) => {
        if (push === null || typeof push !== 'object' || !('payload' in push)) {
          throw new Error(`${field}.onSubscribe[${index}].payload is required`);
        }
        this.validateDelay(push.delayMs, `${field}.onSubscribe[${index}].delayMs`);
      });
    }
  }

  private validatePush(push: WebSocketMockPushTemplate, field: string): void {
    if (typeof push.name !== 'string' || push.name.trim() === '') throw new Error(`${field}.name is required`);
    this.validateTarget(push.connection, push.channel, field);
    if (!Object.prototype.hasOwnProperty.call(push, 'payload')) {
      throw new Error(`${field}.payload is required`);
    }
    this.validateDelay(push.delayMs, `${field}.delayMs`);
  }

  private validateTarget(connection: unknown, channel: unknown, field: string): void {
    if (typeof connection !== 'string' || connection.trim() === '') throw new Error(`${field}.connection is required`);
    if (typeof channel !== 'string' || channel.trim() === '') throw new Error(`${field}.channel is required`);
  }

  private validateDelay(delay: unknown, field: string): void {
    if (delay !== undefined && (typeof delay !== 'number' || !Number.isInteger(delay) || delay < 0)) {
      throw new Error(`${field} must be a non-negative integer`);
    }
  }
}

function ensureJsonFileName(fileName: string): string {
  const trimmed = path.basename(fileName.trim() || 'example-websocket.json');
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
}
