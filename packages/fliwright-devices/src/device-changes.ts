import { spawn, type ChildProcess } from 'node:child_process';
import { watch, readdirSync, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Native notifications invalidate inventory; callers rescan to obtain normalized state. */
export function watchDeviceChanges(
  tools: Record<'adb' | 'emulator' | 'xcrun', string>,
  host: NodeJS.Platform,
  changed: () => void,
  signal?: AbortSignal,
): () => void {
  if (signal?.aborted) return () => {};
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const children = new Set<ChildProcess>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  const directories = new Map<string, FSWatcher>();
  const notify = () => {
    if (stopped || debounce) return;
    debounce = setTimeout(() => { debounce = undefined; if (!stopped) changed(); }, 150);
  };
  const observe = (program: string, args: string[]) => {
    if (stopped) return;
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.add(child);
    child.stdout?.on('data', notify);
    child.stderr?.resume();
    let ended = false;
    const restart = () => {
      if (ended) return;
      ended = true;
      children.delete(child);
      child.kill();
      if (stopped) return;
      notify();
      const timer = setTimeout(() => { retries.delete(timer); observe(program, args); }, 5000);
      retries.add(timer);
    };
    child.once('error', restart);
    child.once('close', restart);
  };
  const watchDirectory = (path: string, listener: (event: string, file: string | null) => void) => {
    if (stopped || directories.has(path)) return;
    try {
      const watcher = watch(path, (event, file) => listener(event, file));
      directories.set(path, watcher);
      watcher.on('error', () => { watcher.close(); directories.delete(path); notify(); });
    } catch { /* Missing directories/tools are retried; periodic scans retain diagnostics. */ }
  };
  const avds = process.env.ANDROID_AVD_HOME || join(process.env.ANDROID_USER_HOME || join(homedir(), '.android'), 'avd');
  const simulators = join(homedir(), 'Library', 'Developer', 'CoreSimulator', 'Devices');
  const syncDirectories = () => {
    watchDirectory(avds, notify);
    if (host !== 'darwin') return;
    watchDirectory(simulators, () => { notify(); syncSimulators(); });
    syncSimulators();
  };
  const syncSimulators = () => {
    try {
      const paths = new Set(readdirSync(simulators).map((name) => join(simulators, name)));
      for (const [path, watcher] of directories) {
        if (path.startsWith(`${simulators}/`) && !paths.has(path)) { watcher.close(); directories.delete(path); }
      }
      for (const path of paths) watchDirectory(path, (_event, file) => {
        if (!file || file === 'device.plist') notify();
      });
    } catch { /* Xcode may not have created the simulator directory yet. */ }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener('abort', stop);
    clearTimeout(debounce);
    clearInterval(directoryRetry);
    for (const timer of retries) clearTimeout(timer);
    for (const watcher of directories.values()) watcher.close();
    for (const child of children) child.kill();
  };
  observe(tools.adb, ['track-devices']);
  if (host === 'darwin') observe(tools.xcrun, ['xcdevice', 'observe', '--both']);
  syncDirectories();
  const directoryRetry = setInterval(syncDirectories, 5000);
  signal?.addEventListener('abort', stop, { once: true });
  return stop;
}
