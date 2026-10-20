import { extname } from 'node:path';
import { CloudError } from './contracts.js';
const extensions = new Set([
  '.json',
  '.jsonl',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.log',
  '.ts',
  '.dart',
]);
export function safeArtifactPath(path: string) {
  if (
    path.includes('\\') ||
    path.includes(':') ||
    /[\x00-\x1f]/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((p) => !p || p === '.' || p === '..') ||
    !extensions.has(extname(path).toLowerCase()) ||
    path === 'cloud-publication.json'
  )
    throw new CloudError(400, 'Unsafe artifact path');
  return path;
}
