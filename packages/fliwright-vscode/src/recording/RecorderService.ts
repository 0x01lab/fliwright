import * as path from 'node:path';
import * as vscode from 'vscode';
import { applyDartVerification, parseDartVerificationEvidence, cleanFlowWithAi, buildFlowFromRecording, fingerprintScenario, generateRecordingAutomation, ScenarioResolver, type AiRuntime, type DartVerificationEvidence, type FlowCleanPlan, type GenerateRecordingAutomationOptions, type FliwrightDriver, type FliwrightFlowDocument, type RecordingFrame } from '@fliwright/core';
import { resolveProjectConfig } from '@fliwright/cli';
import { loadWorkspaceConfig, resolveWorkspacePath } from '../config.js';
import { verifyRecordingReplay } from '@fliwright/cli/run';
import type { RecordingSession } from '../types.js';
import { RecordingPersistenceService, type RecordingListItem } from './RecordingPersistenceService.js';

type RecorderLike = FliwrightDriver['recorder'] & {
  getFrames?: () => RecordingFrame[];
  setOperationIncluded?: (operationIndex: number, included: boolean) => string;
};

export interface RecordingStartOptions {
  testName?: string;
  onDidChange?: (session: RecordingSession) => void;
  /** 每录制一个操作时的回调 */
  onStepRecorded?: (step: { action: string; selector: string; timestamp: number }) => void;
}

export interface RecordingFlowCleanOptions {
  aiRuntime?: Pick<AiRuntime, 'generate'>;
  apply?: boolean;
  instructions?: string;
  protectedNodeIds?: string[];
  timeoutMs?: number;
}

export interface RecordingFlowCleanResult {
  flow: FliwrightFlowDocument;
  plan: FlowCleanPlan;
  applied: boolean;
}

export async function resolveRecordingTestName(session: RecordingSession): Promise<string | undefined> {
  const existingName = firstNonEmpty(session.testName, session.flow?.title, session.flow?.source?.testName);
  if (existingName) return existingName;

  const input = await vscode.window.showInputBox({
    title: 'Start Fliwright Recording',
    prompt: 'Generated test name',
    value: 'recorded test',
  });
  if (input === undefined) return undefined;
  return input.trim() || 'recorded test';
}

export class RecorderService {
  private session: RecordingSession = { status: 'idle', rawEventCount: 0, operationCount: 0, frames: [] };
  private onDidChange: ((session: RecordingSession) => void) | undefined;
  private onStepRecorded: ((step: { action: string; selector: string; timestamp: number }) => void) | undefined;
  private readonly persistence = new RecordingPersistenceService();
  private flowPersistQueue: Promise<void> = Promise.resolve();
  private flowUpdateRevision = 0;

  getSession(): RecordingSession {
    return { ...this.session };
  }

  reset(): RecordingSession {
    this.session = { status: 'idle', rawEventCount: 0, operationCount: 0, frames: [] };
    this.onDidChange = undefined;
    this.onStepRecorded = undefined;
    this.flowUpdateRevision++;
    return this.getSession();
  }

  listPersistedRecordings(workspaceRoot: vscode.Uri): Promise<RecordingListItem[]> {
    return this.persistence.list(workspaceRoot);
  }

  async loadPersistedRecording(recordingDir: vscode.Uri): Promise<RecordingSession> {
    const session = await this.persistence.load(recordingDir);
    this.setSession(session);
    return this.getSession();
  }

  loadFlow(flow: FliwrightFlowDocument, flowFile?: vscode.Uri): RecordingSession {
    this.setSession({
      status: 'preview',
      rawEventCount: 0,
      operationCount: flow.nodes.length,
      frames: [],
      testName: flow.source?.testName ?? flow.title ?? flow.id,
      recordingId: flow.source?.recordingId,
      targetFile: flow.source?.targetFile,
      flow,
      flowFile: flowFile?.fsPath,
    });
    return this.getSession();
  }

  async start(driver: FliwrightDriver, options: RecordingStartOptions = {}): Promise<RecordingSession> {
    const startedAt = Date.now();
    this.onDidChange = options.onDidChange;
    this.onStepRecorded = options.onStepRecorded;
    this.setSession({
      status: 'recording',
      startedAt,
      rawEventCount: 0,
      operationCount: 0,
      frames: [],
      testName: options.testName,
    });
    await driver.recorder.start({
      captureScreenshots: true,
      filterNoise: true,
      onOperation: () => {
        this.setSession({
          ...this.session,
          rawEventCount: driver.recorder.getRawEventCount(),
          operationCount: driver.recorder.getOperations().length,
          frames: getRecorderFrames(driver.recorder),
          artifactDirectory: driver.recorder.getArtifactDirectory(),
        });
      },
      onFrame: () => {
        this.setSession({
          ...this.session,
          rawEventCount: driver.recorder.getRawEventCount(),
          operationCount: driver.recorder.getOperations().length,
          frames: getRecorderFrames(driver.recorder),
          artifactDirectory: driver.recorder.getArtifactDirectory(),
        });
      },
    });
    return this.getSession();
  }

  async stop(driver: FliwrightDriver, targetFile?: vscode.Uri, options: GenerateRecordingAutomationOptions = {}, workspaceRoot?: vscode.Uri): Promise<RecordingSession> {
    const { checkpoints: _checkpoints, ...captureOptions } = options;
    const result = await driver.recorder.stop({
      lang: options.lang ?? 'ts',
      testName: this.session.testName,
      resetToHomeBeforeEach: options.resetToHomeBeforeEach ?? (options.lang ?? 'ts') === 'ts',
      homeRoute: '/',
      mode: 'script',
      ...captureOptions,
    });
    const { code: generatedCode, frames, operations } = result;
    const recordingId = this.session.recordingId ?? `recording-${this.session.startedAt ?? Date.now()}`;
    this.setSession(await this.generateSession({
      status: 'preview',
      startedAt: this.session.startedAt,
      rawEventCount: driver.recorder.getRawEventCount(),
      operationCount: operations.length,
      frames,
      generatedCode,
      recording: result,
      artifactDirectory: driver.recorder.getArtifactDirectory(),
      recordedSelectors: [...driver.recorder.getSelectors()],
      generationOptions: {
        mode: 'script',
        resetToHomeBeforeEach: (options.lang ?? 'ts') === 'ts',
        homeRoute: '/',
        ...options,
      },
      targetFile: targetFile?.fsPath,
      testName: options.testName ?? this.session.testName,
      recordingId,
      flow: buildFlowFromRecording({
        frames,
        operations,
        recordingId,
        testName: options.testName ?? this.session.testName,
        targetFile: targetFile?.fsPath,
      }),
    }, workspaceRoot));
    if (workspaceRoot) await this.persistSession(workspaceRoot);
    return this.getSession();
  }

  async insertGeneratedCode(): Promise<vscode.Uri> {
    if (!this.session.generatedCode) {
      throw new Error('Stop recording before inserting generated code.');
    }
    this.requirePublishable();

    const active = vscode.window.activeTextEditor;
    if (!active) {
      throw new Error('Open a TypeScript test file before inserting recorded code, or save it as a new file.');
    }

    await active.edit((builder) => {
      builder.insert(active.selection.active, `\n${this.session.generatedCode}\n`);
    });
    this.setSession({
      ...this.session,
      targetFile: active.document.uri.fsPath,
      flow: withFlowTargetFile(this.session.flow, active.document.uri.fsPath),
    });
    return active.document.uri;
  }

  async setFrameIncluded(driver: FliwrightDriver, frameId: string, included: boolean, workspaceRoot?: vscode.Uri): Promise<RecordingSession> {
    const frame = this.session.frames?.find((candidate) => candidate.id === frameId);
    if (!frame || frame.operationIndex == null) {
      throw new Error('This frame is not associated with a generated operation yet.');
    }
    const recorder = driver.recorder as RecorderLike;
    if (typeof recorder.setOperationIncluded !== 'function') {
      throw new Error('The connected recorder does not support manual frame filtering.');
    }
    recorder.setOperationIncluded(frame.operationIndex, included);
    const frames = getRecorderFrames(recorder);
    const operations = recorder.getOperations();
    this.setSession(await this.generateSession({
      ...this.session,
      frames,
      operationCount: operations.length,
      rawEventCount: recorder.getRawEventCount(),
      recording: this.session.recording ? { ...this.session.recording, frames, operations } : undefined,
      recordedSelectors: [...recorder.getSelectors()],
      flow: this.session.recordingId
        ? buildFlowFromRecording({
            frames,
            operations,
            recordingId: this.session.recordingId,
            testName: this.session.testName,
            targetFile: this.session.targetFile,
          })
        : this.session.flow,
    }, workspaceRoot));
    if (workspaceRoot) await this.persistSession(workspaceRoot);
    return this.getSession();
  }

  async updateFlow(flow: FliwrightFlowDocument, workspaceRoot?: vscode.Uri): Promise<RecordingSession> {
    const revision = ++this.flowUpdateRevision;
    const nextSession: RecordingSession = {
      ...this.session,
      flow: {
        ...flow,
        updatedAt: new Date().toISOString(),
      },
    };
    this.setSession(nextSession);
    if (workspaceRoot) await this.enqueuePersistSession(workspaceRoot, nextSession, revision);
    return this.getSession();
  }

  async cleanFlow(options: RecordingFlowCleanOptions = {}, workspaceRoot?: vscode.Uri): Promise<RecordingFlowCleanResult> {
    if (!this.session.flow) {
      throw new Error('Stop recording or load a saved recording before cleaning the flow.');
    }
    const cleaned = await cleanFlowWithAi(this.session.flow, {
      ai: options.aiRuntime,
      instructions: options.instructions,
      protectedNodeIds: options.protectedNodeIds,
      timeoutMs: options.timeoutMs,
    });
    const applied = options.apply ?? false;
    if (applied) {
      await this.updateFlow(cleaned.flow, workspaceRoot);
    }
    return {
      flow: cleaned.flow,
      plan: cleaned.plan,
      applied,
    };
  }

  /** Use the generated language for both the save dialog and the default output path. */
  async getGeneratedCodeSaveOptions(workspaceRoot: vscode.Uri): Promise<vscode.SaveDialogOptions> {
    const mode = this.session.readiness?.automationKind ?? 'script';
    const language = this.session.readiness?.language ?? 'ts';
    const config = await loadWorkspaceConfig(workspaceRoot);
    return {
      title: 'Save Recorded Automation',
      defaultUri: vscode.Uri.joinPath(
        resolveWorkspacePath(workspaceRoot, mode === 'test' ? config.paths.tests : config.paths.scripts),
        `recorded-${Date.now()}.${language === 'dart' ? 'dart' : `${mode}.ts`}`,
      ),
      filters: language === 'dart' ? { Dart: ['dart'] } : { TypeScript: ['ts'] },
    };
  }

  async saveGeneratedCode(workspaceRoot: vscode.Uri, targetFile?: vscode.Uri): Promise<vscode.Uri> {
    if (!this.session.generatedCode) {
      throw new Error('Stop recording before saving generated code.');
    }
    this.setSession(await this.generateSession(this.session, workspaceRoot));
    this.requirePublishable();
    const mode = this.session.readiness!.automationKind;
    const language = this.session.readiness!.language ?? 'ts';

    const target = targetFile ?? (await this.getGeneratedCodeSaveOptions(workspaceRoot)).defaultUri!;
    if (language === 'dart' && !target.fsPath.endsWith('.dart')) {
      throw new Error('Save Dart automation as a .dart file.');
    }
    if (mode === 'script' && /\.(test|spec)\.ts$/.test(target.fsPath)) {
      throw new Error('Save this automation as a .script.ts file, or confirm a scenario and assertions to generate a test.');
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
    await vscode.workspace.fs.writeFile(target, Buffer.from(this.session.generatedCode!, 'utf8'));
    await vscode.window.showTextDocument(target);
    this.setSession({
      ...this.session,
      targetFile: target.fsPath,
      flow: withFlowTargetFile(this.session.flow, target.fsPath),
    });
    await this.persistSession(workspaceRoot);
    return target;
  }

  /** Regenerate from captured operations and explicit checkpoint confirmations; derive the scenario identity from project config. */
  async reviewAutomation(workspaceRoot: vscode.Uri, options: GenerateRecordingAutomationOptions): Promise<RecordingSession> {
    this.setSession(await this.generateSession({ ...this.session,
      generationOptions: { ...this.session.generationOptions, ...options },
    }, workspaceRoot));
    await this.persistSession(workspaceRoot);
    return this.getSession();
  }

  /** Explicitly replay once, retain failed runs, and bind success only to unchanged content and scenario. */
  async verifyRecording(workspaceRoot: vscode.Uri, vmUrl: string, signal?: AbortSignal): Promise<RecordingSession> {
    this.setSession(await this.generateSession(this.session, workspaceRoot, false));
    this.requirePublishable();
    const scenario = this.session.generationOptions?.scenarioName;
    if (!scenario) throw new Error('Choose a deterministic scenario before replay verification.');
    if (this.session.generationOptions?.lang === 'dart') throw new Error('Dart verification requires its own compilation and Flutter run.');
    await this.persistSession(workspaceRoot);
    const candidate = this.getSession();
    const verified = await verifyRecordingReplay({ code: this.session.generatedCode!, scenario,
      scenarioFingerprint: this.session.readiness?.scenarioFingerprint,
      cwd: workspaceRoot.fsPath, vmUrl, directory: this.session.recordingDir, signal,
      mode: this.session.readiness!.automationKind,
      capture: candidate.recording ? { recording: candidate.recording,
        artifactDirectory: candidate.artifactDirectory,
        selectors: new Map(candidate.recordedSelectors), stopReason: 'requested' } : undefined,
    });
    const current = await this.generateSession(this.session, workspaceRoot, false);
    if (current.generatedCode !== candidate.generatedCode
      || current.recordingId !== candidate.recordingId
      || current.readiness?.scenarioFingerprint !== candidate.readiness?.scenarioFingerprint) {
      this.setSession(current);
      await this.persistSession(workspaceRoot);
      return this.getSession();
    }
    this.setSession({ ...this.session, readiness: { ...this.session.readiness!,
      readiness: verified.passed && verified.verifiedRunId ? 'verified' : 'draft',
      verifiedRunId: verified.verifiedRunId, replayRunId: verified.replayRunId,
      issues: verified.issues,
    } });
    await this.persistSession(workspaceRoot);
    return this.getSession();
  }

  /** Apply compile-and-run evidence produced by the Dart verifier to this exact recording. */
  async importDartVerification(workspaceRoot: vscode.Uri, evidenceFile: vscode.Uri): Promise<RecordingSession> {
    const value = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(evidenceFile)).toString('utf8'));
    return this.applyDartVerification(workspaceRoot, parseDartVerificationEvidence(value));
  }

  /** Apply compile-and-run evidence produced by the Dart verifier to this exact recording. */
  async applyDartVerification(workspaceRoot: vscode.Uri, evidence: DartVerificationEvidence): Promise<RecordingSession> {
    this.setSession(await this.generateSession(this.session, workspaceRoot, false));
    if (this.session.generationOptions?.lang !== 'dart') {
      throw new Error('Dart verification requires a Dart recording.');
    }
    if (!this.session.readiness) throw new Error('Generate the recording before applying Dart verification.');
    const readiness = applyDartVerification(this.session.readiness, evidence);
    this.setSession({ ...this.session, readiness });
    await this.persistSession(workspaceRoot);
    return this.getSession();
  }

  private requirePublishable(): void {
    if (!this.session.readiness || this.session.readiness.readiness === 'draft') {
      throw new Error(`Recording is a draft: ${this.session.readiness?.issues.join('; ') ?? 'Review the recording before saving.'}`);
    }
  }

  private async generateSession(session: RecordingSession, workspaceRoot?: vscode.Uri, preserveFailedReplay = true): Promise<RecordingSession> {
    if (!session.recording || !session.recordedSelectors) return session;
    const options = session.generationOptions ?? { mode: 'script' };
    let scenarioFingerprint: string | undefined;
    let scenarioIssue: string | undefined;
    if (options.scenarioName && workspaceRoot) {
      const config = await resolveProjectConfig(workspaceRoot.fsPath);
      try {
        scenarioFingerprint = fingerprintScenario(new ScenarioResolver(config.scenarios ?? {}).resolve(options.scenarioName));
      } catch { scenarioIssue = `unknown deterministic scenario '${options.scenarioName}'`; }
    }
    const generated = generateRecordingAutomation({ recording: session.recording,
      selectors: new Map(session.recordedSelectors),
      stopReason: 'requested',
    }, { ...options, testName: session.testName, scenarioFingerprint });
    const readiness = generated.readiness;
    if ((options.mode === 'test' || options.scenarioName) && !scenarioFingerprint) {
      readiness.readiness = 'draft';
      readiness.issues.push(scenarioIssue ?? 'Choose a configured deterministic scenario.');
    }
    const previous = session.readiness;
    if (readiness.language !== 'dart' && readiness.readiness !== 'draft' && previous?.readiness === 'verified'
      && previous.contentFingerprint === readiness.contentFingerprint
      && previous.scenarioFingerprint === readiness.scenarioFingerprint && previous.verifiedRunId) {
      readiness.readiness = 'verified';
      readiness.verifiedRunId = previous.verifiedRunId;
    }
    if (previous?.readiness === 'verified' && previous.language === 'dart' && previous.dartVerification
      && readiness.language === 'dart'
      && previous.contentFingerprint === readiness.contentFingerprint
      && previous.scenarioFingerprint === readiness.scenarioFingerprint
      && previous.dartVerification.contentFingerprint === readiness.contentFingerprint
      && previous.dartVerification.appEntrypoint === readiness.dartAppEntrypoint) {
      const restored = applyDartVerification(readiness, previous.dartVerification);
      readiness.readiness = restored.readiness;
      readiness.verifiedRunId = restored.verifiedRunId;
      readiness.dartVerification = restored.dartVerification;
      readiness.issues = restored.issues;
    }
    if (previous?.replayRunId) readiness.replayRunId = previous.replayRunId;
    if (preserveFailedReplay && previous?.readiness === 'draft' && previous.replayRunId
      && previous.contentFingerprint === readiness.contentFingerprint
      && previous.scenarioFingerprint === readiness.scenarioFingerprint) {
      readiness.readiness = 'draft';
      readiness.issues.push(...previous.issues.filter((issue) => !readiness.issues.includes(issue)));
    }
    return { ...session, generatedCode: generated.recording.code, readiness, checkpoints: generated.checkpoints };
  }

  private setSession(session: RecordingSession): void {
    this.session = session;
    this.onDidChange?.(this.getSession());
  }

  private async persistSession(workspaceRoot: vscode.Uri): Promise<void> {
    await this.persistSessionSnapshot(workspaceRoot, this.session, () => true);
  }

  private async enqueuePersistSession(workspaceRoot: vscode.Uri, session: RecordingSession, revision: number): Promise<void> {
    const task = this.flowPersistQueue
      .catch(() => undefined)
      .then(() => this.persistSessionSnapshot(
        workspaceRoot,
        session,
        () => revision === this.flowUpdateRevision,
      ));
    this.flowPersistQueue = task.catch(() => undefined);
    await task;
  }

  private async persistSessionSnapshot(
    workspaceRoot: vscode.Uri,
    session: RecordingSession,
    shouldApply: () => boolean,
  ): Promise<void> {
    if (session.status !== 'preview') return;
    if (session.flow && isStandaloneFlowSession(session)) {
      await writeFlowFile(vscode.Uri.file(session.flowFile), session.flow);
      if (!shouldApply()) return;
      this.setSession({
        ...this.session,
        flowFile: session.flowFile,
      });
      return;
    }

    const flowFile = session.flow
      ? (await this.persistence.saveProjectFlow(workspaceRoot, session.flow)).fsPath
      : session.flowFile;
    const persistedSession = { ...session, flowFile };
    const recordingDir = await this.persistence.save(workspaceRoot, persistedSession, session.recordingId);
    if (!shouldApply()) return;
    this.setSession({
      ...this.session,
      flowFile,
      recordingId: this.session.recordingId ?? session.recordingId ?? recordingDir.fsPath.split(/[\\/]/).pop(),
      recordingDir: recordingDir.fsPath,
      artifactDirectory: recordingDir.fsPath,
    });
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function isStandaloneFlowSession(session: RecordingSession): session is RecordingSession & { flow: FliwrightFlowDocument; flowFile: string } {
  return Boolean(
    session.flow
    && session.flowFile
    && !session.recordingDir
    && !session.generatedCode
    && (session.frames?.length ?? 0) === 0,
  );
}

async function writeFlowFile(uri: vscode.Uri, flow: FliwrightFlowDocument): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(flow, null, 2)}\n`, 'utf8'));
}

/** Dart output opens as source; the recording visual editor handles TypeScript. */
export function recordingEditorViewType(targetFile: string): 'default' | 'fliwright.testEditor' {
  return targetFile.endsWith('.dart') ? 'default' : 'fliwright.testEditor';
}

function getRecorderFrames(recorder: RecorderLike): RecordingFrame[] {
  return typeof recorder.getFrames === 'function' ? recorder.getFrames() : [];
}

function withFlowTargetFile<T extends NonNullable<RecordingSession['flow']> | undefined>(
  flow: T,
  targetFile: string,
): T {
  if (!flow) return flow;
  return {
    ...flow,
    source: {
      kind: flow.source?.kind ?? 'recording',
      ...flow.source,
      targetFile,
    },
    updatedAt: new Date().toISOString(),
  } as T;
}
