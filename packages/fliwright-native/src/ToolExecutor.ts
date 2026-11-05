import { NativeError, type NativeOperationContext } from '@fliwright/core';
import { executeOwnedNativeTool } from './OwnedNativeTool.js';

export interface ToolExecutionOptions { env?: NodeJS.ProcessEnv; }
export type ToolExecutor = (program: string, args: readonly string[], context: NativeOperationContext, options?: ToolExecutionOptions) => Promise<Buffer>;

/** Execute without a host shell, bounding time, output and child lifetime. */
export const executeTool: ToolExecutor = executeOwnedNativeTool;

/** ADB's remote shell still parses a command, even with a host argv array. */
export function quoteAndroidShell(value: string): string {
  if (value.includes('\0')) throw new NativeError('precondition_failed', 'NUL is not permitted in Android shell arguments.');
  return `'${value.replaceAll("'", "'\\''")}'`;
}
