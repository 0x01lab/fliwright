import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import { resolveProjectConfig } from '@fliwright/cli';
import { verifyRecordingReplay } from '@fliwright/cli/run';
import {
  applyDartVerification, fingerprintScenario,
  copyRecordingArtifacts,
  generateRecordingAutomation,
  recordingCheckpointSchema,
  captureRecording,
  openRecordingCapture,
  buildFlowFromRecording,
  type FliwrightFlowDocument,
  type RecordingResult,
  type RecordingManifest,
  type RecordingReadinessResult,
  type RecordingCaptureResource,
  type RecordingCheckpointCandidate,
  ScenarioResolver,
  readWorkspaceConfigSync,
} from '@fliwright/core';

export const RecordParamsSchema = z.object({
  vmServiceUrl: z.string().optional().describe('Dart VM Service WebSocket URL'),
  cwd: z.string().optional().describe('Project directory containing fliwright.config.ts'),
  duration: z.number().finite().nonnegative().optional().describe('Recording duration in seconds (default: 30)').default(30),
  testName: z.string().optional().describe('Test name for generated code').default('recorded test'),
  lang: z.enum(['ts', 'dart']).optional().describe('Output language').default('ts'),
  dartAppEntrypoint: z.string().optional().describe('Dart app test entrypoint package URI compatible with integration_test'),
  resetToHomeBeforeEach: z.boolean().optional().default(true)
    .describe('Whether generated TS code should navigate to the home route before each test'),
  homeRoute: z.string().optional().default('/')
    .describe('Route used by the generated beforeEach home reset hook'),
  mode: z.enum(['script', 'test']).optional().default('script')
    .describe('Generated automation kind; test mode requires a scenario and confirmed assertions'),
  scenario: z.string().optional().describe('Named deterministic scenario for test mode'),
  assertions: z.array(recordingCheckpointSchema).optional().describe('Observed checkpoints; only explicitly confirmed valid checkpoints generate expect'),
  verify: z.boolean().optional().default(false)
    .describe('Request replay verification before treating the recording as verified'),
  dartVerification: z.object({
    status: z.enum(['passed', 'failed']), runId: z.string().min(1), contentFingerprint: z.string().min(1),
    appEntrypoint: z.string().min(1), platform: z.string().min(1), artifactPath: z.string().optional(), issues: z.array(z.string()).optional(),
  }).optional().describe('Evidence from the Dart compiler and Flutter replay; required to verify Dart output'),
});

export interface RecordResult {
  testCode: string;
  testName: string;
  operationCount: number;
  flow: FliwrightFlowDocument;
  readiness: RecordingReadinessResult;
  blockers: string[];
  recording: RecordingResult;
  checkpoints: RecordingCheckpointCandidate[];
  replayPath?: string;
  recordingPath: string;
}

export type RecordingCaptureFactory = (vmUrl: string) => Promise<RecordingCaptureResource>;

export async function handleRecord(
  input: z.input<typeof RecordParamsSchema>,
  state: ServerState,
  openCapture: RecordingCaptureFactory = openRecordingCapture,
  signal?: AbortSignal,
): Promise<RecordResult> {
  const params = RecordParamsSchema.parse(input);
  const cwd = params.cwd ?? process.cwd();
  const config = await resolveProjectConfig(cwd);
  const vmUrl = params.vmServiceUrl || process.env.FLIWRIGHT_VM_URL || process.env.FLIWRIGHT_VM_SERVICE_URL
    || config.vmServiceUrl || readWorkspaceConfigSync(cwd).vmServiceUrl;
  if (!vmUrl) {
    throw new Error('No VM Service URL provided. Pass vmServiceUrl parameter or set FLIWRIGHT_VM_URL env var.');
  }

  state.setVmServiceUrl(vmUrl);

  let scenarioFingerprint: string | undefined;
  let scenarioIssue: string | undefined;
  if (params.scenario) {
    try {
      scenarioFingerprint = fingerprintScenario(new ScenarioResolver(config.scenarios ?? {}).resolve(params.scenario));
    } catch {
      scenarioIssue = `unknown deterministic scenario '${params.scenario}'`;
    }
  }

  const lang = params.lang;
  const testName = params.testName;
  const captured = await captureRecording({
    open: () => openCapture(vmUrl),
    signal,
    durationMs: params.duration * 1000,
    start: { captureScreenshots: true, filterNoise: true },
    generate: {
      lang, testName, mode: params.mode,
      dartAppEntrypoint: params.dartAppEntrypoint,
      resetToHomeBeforeEach: lang === 'ts' && params.resetToHomeBeforeEach,
      homeRoute: params.homeRoute,
    },
  });
  const generated = generateRecordingAutomation(captured, {
    lang, testName, mode: params.mode,
    dartAppEntrypoint: params.dartAppEntrypoint,
    resetToHomeBeforeEach: lang === 'ts' && params.resetToHomeBeforeEach,
    homeRoute: params.homeRoute,
    checkpoints: params.assertions,
    scenarioName: params.scenario,
    scenarioFingerprint,
  });
  const { recording, readiness: generatedReadiness } = generated;
  const { code: testCode, operations, frames } = recording;
  const blockers = [
    ...generatedReadiness.issues,
    ...((params.mode === 'test' || params.verify) && scenarioIssue ? [scenarioIssue] : []),
  ];
  const recordingPath = resolve(cwd, config.paths.recordings, `recording-${randomUUID()}`);
  const createdAt = new Date().toISOString();
  const flow = buildFlowFromRecording({ frames, operations, testName });
  await mkdir(recordingPath, { recursive: true });
  await copyRecordingArtifacts(recording, captured.artifactDirectory, recordingPath);
  const persist = async (readiness: RecordingReadinessResult) => {
    await writeFile(resolve(recordingPath, 'recording.json'), JSON.stringify({
      schemaVersion: 2, id: recordingPath.split(/[\\/]/).pop()!, mode: params.mode, testName,
      createdAt, updatedAt: new Date().toISOString(),
      rawEventCount: recording.eventCache?.eventCount ?? recording.receivedSequences.length,
      operationCount: operations.length, generatedCode: testCode,
      readiness, frames, flow, recording, checkpoints: generated.checkpoints,
      recordedSelectors: [...captured.selectors], generationOptions: { lang, testName, mode: params.mode,
        dartAppEntrypoint: params.dartAppEntrypoint,
        resetToHomeBeforeEach: lang === 'ts' && params.resetToHomeBeforeEach,
        homeRoute: params.homeRoute, checkpoints: generated.checkpoints, scenarioName: params.scenario, scenarioFingerprint },
    } satisfies RecordingManifest, null, 2) + '\n');
    await writeFile(resolve(recordingPath, `draft.${lang === 'dart' ? 'dart' : params.mode === 'test' ? 'test.ts' : 'script.ts'}`), testCode);
    await writeFile(resolve(recordingPath, 'blockers.json'), JSON.stringify(readiness.issues, null, 2) + '\n');
  };
  // Preserve the original capture even if replay fails or its process throws.
  await persist(generatedReadiness);
  let verification: Awaited<ReturnType<typeof verifyRecordingReplay>> | undefined;
  if (params.verify) {
    if (!params.scenario) blockers.push('verification requires a deterministic scenario');
    else if (lang === 'dart' && !params.dartVerification) blockers.push('Dart verification requires its own compilation and Flutter run; provide dartVerification evidence before publishing');
    else if (lang === 'dart') {
      // Dart evidence comes from its own compiler and Flutter run; never use the TS replay verifier.
    }
    else if (blockers.length === 0) {
      verification = await verifyRecordingReplay({ code: testCode, scenario: params.scenario,
        directory: recordingPath,
        scenarioFingerprint, cwd: params.cwd ?? process.cwd(), vmUrl, mode: params.mode, signal,
        capture: { ...captured, recording },
      });
      if (!verification.passed) blockers.push(...verification.issues);
    }
  }

  let finalReadiness: RecordingReadinessResult = { ...generatedReadiness,
      readiness: blockers.length ? 'draft' : verification?.verifiedRunId ? 'verified' : generatedReadiness.readiness,
      ...(verification?.verifiedRunId ? { verifiedRunId: verification.verifiedRunId } : {}),
      ...(verification?.replayRunId ? { replayRunId: verification.replayRunId } : {}),
      issues: blockers };
  if (lang === 'dart' && params.dartVerification) finalReadiness = applyDartVerification(finalReadiness, params.dartVerification);
  const finalBlockers = finalReadiness.issues;
  await persist(finalReadiness);
  return {
    testCode,
    testName,
    operationCount: operations.length,
    flow,
    recordingPath,
    readiness: finalReadiness,
    blockers: finalBlockers,
    recording,
    checkpoints: generated.checkpoints,
    ...(verification?.replayPath ? { replayPath: verification.replayPath } : {}),
  };
}

export function registerRecordTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_record',
    'Record user interactions on a Flutter app and generate test code',
    RecordParamsSchema.shape,
    async (params, extra) => {
      const result = await handleRecord(params, state, openRecordingCapture, extra.signal);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
