import * as vscode from 'vscode';
import { FLIWRIGHT_FLOWS_DIR, flowFileName, sanitizeFlowFileId, type FliwrightFlowDocument } from '@fliwright/core';

export interface CreateFlowOptions {
  title: string;
}

export interface CreatedFlowFile {
  uri: vscode.Uri;
  flow: FliwrightFlowDocument;
}

export class FlowFileService {
  async create(workspaceRoot: vscode.Uri, options: CreateFlowOptions): Promise<CreatedFlowFile> {
    const now = new Date().toISOString();
    const baseId = sanitizeFlowFileId(options.title);
    const id = await nextAvailableFlowId(workspaceRoot, baseId);
    const flow: FliwrightFlowDocument = {
      version: 1,
      id,
      title: options.title,
      createdAt: now,
      updatedAt: now,
      source: { kind: 'manual' },
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const uri = vscode.Uri.joinPath(workspaceRoot, ...FLIWRIGHT_FLOWS_DIR.split('/'), flowFileName(id));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceRoot, ...FLIWRIGHT_FLOWS_DIR.split('/')));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(flow, null, 2)}\n`, 'utf8'));
    return { uri, flow };
  }
}

async function nextAvailableFlowId(workspaceRoot: vscode.Uri, baseId: string): Promise<string> {
  const flowsRoot = vscode.Uri.joinPath(workspaceRoot, ...FLIWRIGHT_FLOWS_DIR.split('/'));
  for (let index = 0; index < 1000; index++) {
    const id = index === 0 ? baseId : `${baseId}-${index + 1}`;
    const uri = vscode.Uri.joinPath(flowsRoot, flowFileName(id));
    if (!(await exists(uri))) return id;
  }
  return `${baseId}-${Date.now()}`;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
