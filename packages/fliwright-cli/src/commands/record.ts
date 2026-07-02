import { resolveVmUrl } from '../vm-discovery.js';
import { writeFile } from 'node:fs/promises';
import { AssertionSuggester, buildFlowFromRecording } from '@fliwright/core';
import type { CodegenOptions, FliwrightFlowDocument, RecordedOperation, RecordingFrame } from '@fliwright/core';

export interface RecordOptions {
  vmUrl?: string;
  output?: string;
  flowOutput?: string;
  lang?: 'ts' | 'dart';
  testName?: string;
  resetToHomeBeforeEach?: boolean;
  homeRoute?: string;
  cwd?: string;
}

export interface RecordResult {
  code: string;
  operations: RecordedOperation[];
  flow: FliwrightFlowDocument;
}

export interface RecorderLike {
  start: (options?: {
    onOperation?: (op: RecordedOperation, idx: number) => void;
    captureScreenshots?: boolean;
    filterNoise?: boolean;
  }) => Promise<void>;
  stop: (options?: CodegenOptions) => Promise<string>;
  getOperations: () => RecordedOperation[];
  getFrames?: () => RecordingFrame[];
}

export interface RecordDeps {
  resolveVmUrl?: (options: { cliFlag?: string; configUrl?: string }) => Promise<string | null>;
  createRecorder?: (vmUrl: string) => Promise<RecorderLike>;
  /** External stop signal. When it resolves, recording stops. Used for testing. */
  stopSignal?: Promise<void>;
}

export async function recordCommand(
  options: RecordOptions,
  deps: RecordDeps = {},
): Promise<RecordResult> {
  const resolver = deps.resolveVmUrl ?? resolveVmUrl;
  const vmUrl = await resolver({ cliFlag: options.vmUrl });

  if (!vmUrl) {
    throw new Error(
      'Could not find a running Flutter VM Service.\n\n' +
      '   Start your Flutter app first: flutter run\n' +
      '   Then re-run: fliwright record\n' +
      '   Or specify: fliwright record --vm-url ws://127.0.0.1:8181/ws',
    );
  }

  const createRecorder = deps.createRecorder ?? defaultCreateRecorder;
  const recorder = await createRecorder(vmUrl);

  const lang = options.lang ?? 'ts';
  const testName = options.testName ?? 'recorded test';

  console.log('🔴 Recording... Press Ctrl+C to stop.\n');

  await recorder.start({
    captureScreenshots: true,
    filterNoise: true,
    onOperation: (op, index) => {
      const label = op.kind === 'type' ? `type "${op.text}"` : op.kind;
      const pos = `(${op.position.x}, ${op.position.y})`;
      console.log(`  ${index + 1}. ${label} ${pos}`);
    },
  });

  // Wait for stop signal: either external (testing) or SIGINT
  if (deps.stopSignal) {
    await deps.stopSignal;
  } else {
    await waitForSigint();
  }

  const codegenOptions: CodegenOptions = {
    lang,
    testName,
    resetToHomeBeforeEach: options.resetToHomeBeforeEach ?? lang === 'ts',
    homeRoute: options.homeRoute,
  };
  const code = await recorder.stop(codegenOptions);
  const operations = recorder.getOperations();
  const flow = buildFlowFromRecording({
    frames: recorder.getFrames?.() ?? [],
    operations,
    testName,
    targetFile: options.output,
  });

  const suggester = new AssertionSuggester();
  const suggestions = suggester.suggest(operations);

  let finalCode = code;
  if (suggestions.length > 0) {
    const suggestionComments = suggestions.map((s) =>
      `  // Suggested assertion (${s.reason})\n  // ${s.template}`
    );
    finalCode = code + '\n\n// Assertion Suggestions:\n' + suggestionComments.join('\n');
  }

  if (options.output) {
    await writeFile(options.output, finalCode, 'utf8');
    console.log(`\n✅ Test written to ${options.output}`);
  } else {
    console.log('\n--- Generated Test Code ---\n');
    console.log(finalCode);
  }

  if (options.flowOutput) {
    await writeFile(options.flowOutput, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
    console.log(`\n✅ Flow written to ${options.flowOutput}`);
  }

  return {
    code: finalCode,
    operations,
    flow,
  };
}

function waitForSigint(): Promise<void> {
  return new Promise<void>((resolve) => {
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      console.log('\n⏹  Stopping recording...');
      resolve();
    };

    process.on('SIGINT', stop);

    // Poll to clean up the listener once resolved
    const check = setInterval(() => {
      if (stopped) {
        clearInterval(check);
        process.removeListener('SIGINT', stop);
      }
    }, 100);
  });
}

async function defaultCreateRecorder(vmUrl: string): Promise<RecorderLike> {
  const { FliwrightDriver } = await import('@fliwright/core');
  const driver = new FliwrightDriver();
  await driver.connect(vmUrl);
  return driver.recorder;
}
