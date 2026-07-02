import type { FliwrightFigmaBinding } from './types.js';

export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
  url: string;
  editorType?: 'design' | 'figjam' | 'slides' | 'make';
}

export function parseFigmaUrl(value: string): ParsedFigmaUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!isFigmaHost(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const editor = parts[0];
  if (!editor) return null;

  const fileKey = fileKeyFromPath(editor, parts);
  if (!fileKey) return null;

  return {
    fileKey,
    ...(nodeIdFromUrl(url) ? { nodeId: nodeIdFromUrl(url) } : {}),
    url: value,
    ...(editorType(editor) ? { editorType: editorType(editor) } : {}),
  };
}

export function figmaBindingFromUrl(value: string, existing: Partial<FliwrightFigmaBinding> = {}): FliwrightFigmaBinding | null {
  const parsed = parseFigmaUrl(value);
  if (!parsed) return null;
  return {
    ...existing,
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId ?? existing.nodeId ?? '',
    url: parsed.url,
  };
}

function isFigmaHost(hostname: string): boolean {
  return hostname === 'figma.com' || hostname.endsWith('.figma.com');
}

function fileKeyFromPath(editor: string, parts: string[]): string | undefined {
  if (editor === 'design' && parts[2] === 'branch' && parts[3]) return parts[3];
  if ((editor === 'design' || editor === 'board' || editor === 'slides' || editor === 'make') && parts[1]) return parts[1];
  return undefined;
}

function nodeIdFromUrl(url: URL): string | undefined {
  const nodeId = url.searchParams.get('node-id') ?? url.searchParams.get('nodeId');
  return nodeId?.replace(/-/g, ':');
}

function editorType(editor: string): ParsedFigmaUrl['editorType'] | undefined {
  switch (editor) {
    case 'design':
      return 'design';
    case 'board':
      return 'figjam';
    case 'slides':
      return 'slides';
    case 'make':
      return 'make';
    default:
      return undefined;
  }
}
