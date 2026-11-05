import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { resolveFliwrightProjectRoot } from '@fliwright/core';

const iconPaths = [
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
  'ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png',
  'macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_512.png',
  'macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_1024.png',
  'web/icons/Icon-512.png',
];
const normalize = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').replace(/app$/, '');

/** Embed the target app's launcher icon, including apps/<app> Flutter workspaces. */
export async function loadReportProjectIcon(cwd: string, app?: string, signal?: AbortSignal): Promise<string | undefined> {
  const root = resolveFliwrightProjectRoot(cwd);
  const names = new Set([app, basename(root)].filter((name): name is string => Boolean(name)).map(normalize));
  const roots = [root];
  try {
    const apps = await readdir(join(root, 'apps'), { withFileTypes: true });
    const matches = apps.filter(entry => entry.isDirectory() && names.has(normalize(entry.name)));
    if (matches.length === 1) roots.push(join(root, 'apps', matches[0].name));
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
  for (const directory of roots) for (const path of iconPaths) {
    signal?.throwIfAborted();
    try {
      const file = join(directory, path);
      const info = await stat(file);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) continue;
      const bytes = await readFile(file, { signal });
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) continue;
      return `data:image/png;base64,${bytes.toString('base64')}`;
    } catch (error) {
      signal?.throwIfAborted();
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  return undefined;
}
