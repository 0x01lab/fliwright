import { join } from 'node:path';

export const FLIWRIGHT_FLOWS_DIR = '.fliwright/flows';

export function flowFileName(flowId: string): string {
  return `${sanitizeFlowFileId(flowId)}.flow.json`;
}

export function flowFilePath(workspaceRoot: string, flowId: string): string {
  return join(workspaceRoot, FLIWRIGHT_FLOWS_DIR, flowFileName(flowId));
}

export function sanitizeFlowFileId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'flow';
}
