import { z } from 'zod';

export const secureFileMaxBytes = 1024 * 1024;
export const secureFileMaxCount = 25;
export const secureFilePathSchema = z.string().min(1).max(240).refine(path =>
  path.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && !['.', '..', '.git'].includes(part.toLowerCase())),
  'Use a project-relative file path such as .env/sentry.dev.json');

export interface SecureFileReference { id: string; path: string }
export interface ProjectSecureFile extends SecureFileReference { size: number; createdAt: number }

export function flutterFileArguments(args: string[]) {
  const files: Array<{ path: string; valueIndex: number; prefix: string }> = [];
  const flag = '--dart-define-from-file';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === flag && args[index + 1] && !args[index + 1].startsWith('--')) {
      files.push({ path: args[++index], valueIndex: index, prefix: '' });
    } else if (arg.startsWith(`${flag}=`)) {
      files.push({ path: arg.slice(flag.length + 1), valueIndex: index, prefix: `${flag}=` });
    }
  }
  return files;
}
