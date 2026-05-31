import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import type { CodegenOptions, RecordedOperation } from '@fliwright/core';

export const RecordParamsSchema = z.object({
  vmServiceUrl: z.string().optional().describe('Dart VM Service WebSocket URL'),
  duration: z.number().optional().describe('Recording duration in seconds (default: 30)').default(30),
  testName: z.string().optional().describe('Test name for generated code').default('recorded test'),
  lang: z.enum(['ts', 'dart']).optional().describe('Output language').default('ts'),
});

export interface RecordResult {
  testCode: string;
  testName: string;
  operationCount: number;
}

interface RecorderLike {
  start: (options?: { onOperation?: (op: RecordedOperation, idx: number) => void }) => Promise<void>;
  stop: (options?: CodegenOptions) => Promise<string>;
  getOperations: () => RecordedOperation[];
}

export type RecorderFactory = (vmUrl: string) => Promise<RecorderLike>;

export async function handleRecord(
  params: z.infer<typeof RecordParamsSchema>,
  state: ServerState,
  createRecorder: RecorderFactory = defaultCreateRecorder,
): Promise<RecordResult> {
  const vmUrl = params.vmServiceUrl ?? process.env.FLIWRIGHT_VM_URL;
  if (!vmUrl) {
    throw new Error('No VM Service URL provided. Pass vmServiceUrl parameter or set FLIWRIGHT_VM_URL env var.');
  }

  state.setVmServiceUrl(vmUrl);

  const recorder = await createRecorder(vmUrl);

  await recorder.start();

  const durationMs = (params.duration ?? 30) * 1000;
  await new Promise((resolve) => setTimeout(resolve, durationMs));

  const codegenOptions: CodegenOptions = {
    lang: params.lang,
    testName: params.testName,
  };

  const testCode = await recorder.stop(codegenOptions);
  const operations = recorder.getOperations();

  return {
    testCode,
    testName: params.testName ?? 'recorded test',
    operationCount: operations.length,
  };
}

async function defaultCreateRecorder(vmUrl: string): Promise<RecorderLike> {
  const { FliwrightDriver } = await import('@fliwright/core');
  const driver = new FliwrightDriver();
  await driver.connect(vmUrl);
  return driver.recorder;
}

export function registerRecordTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_record',
    'Record user interactions on a Flutter app and generate test code',
    RecordParamsSchema.shape,
    async (params) => {
      const result = await handleRecord(params, state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
