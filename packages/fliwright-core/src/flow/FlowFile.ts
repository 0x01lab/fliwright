import type { FliwrightFlowDocument } from './types.js';
import { isAbsolute, join, relative } from 'node:path';

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

/** Keep a shared flow's target source file relative to its owning project. */
export function toProjectFlowDocument(flow: FliwrightFlowDocument, projectRoot: string): FliwrightFlowDocument {
  const targetFile = flow.source?.targetFile;
  if (!targetFile || !isAbsolute(targetFile)) return flow;
  return { ...flow, source: { ...flow.source!, targetFile: relative(projectRoot, targetFile).replace(/\\/g, '/') } };
}
