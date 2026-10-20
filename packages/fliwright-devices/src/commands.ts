import { execFile } from 'node:child_process';

/** Internal process seam: bounded output, no shell interpolation, cooperative cancellation. */
export function runTool(bin: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8', timeout: options.timeoutMs, signal: options.signal, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
