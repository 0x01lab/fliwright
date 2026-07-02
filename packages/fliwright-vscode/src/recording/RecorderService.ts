import * as path from 'node:path';
import * as vscode from 'vscode';
import { cleanFlowWithAi, buildFlowFromRecording, type AiRuntime, type FlowCleanPlan, type CodegenOptions, type FliwrightDriver, type FliwrightFlowDocument, type RecordingFrame } from '@fliwright/core';
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
          rawEventCount: driver.recorder.getRawEvents().length,
          operationCount: driver.recorder.getOperations().length,
          frames: getRecorderFrames(driver.recorder),
        });
      },
      onFrame: () => {
        this.setSession({
          ...this.session,
          rawEventCount: driver.recorder.getRawEvents().length,
          operationCount: driver.recorder.getOperations().length,
          frames: getRecorderFrames(driver.recorder),
        });
      },
    });
    return this.getSession();
  }

  async stop(driver: FliwrightDriver, targetFile?: vscode.Uri, options: CodegenOptions = {}, workspaceRoot?: vscode.Uri): Promise<RecordingSession> {
    const generatedCode = await driver.recorder.stop({
      lang: 'ts',
      testName: this.session.testName,
      resetToHomeBeforeEach: true,
      homeRoute: '/',
      ...options,
    });
    const frames = getRecorderFrames(driver.recorder);
    const operations = driver.recorder.getOperations();
    const recordingId = this.session.recordingId ?? `recording-${this.session.startedAt ?? Date.now()}`;
    this.setSession({
      status: 'preview',
      startedAt: this.session.startedAt,
      rawEventCount: driver.recorder.getRawEvents().length,
      operationCount: operations.length,
      frames,
      generatedCode,
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
    });
    if (workspaceRoot) await this.persistSession(workspaceRoot);
    return this.getSession();
  }

  async insertGeneratedCode(): Promise<vscode.Uri> {
    if (!this.session.generatedCode) {
      throw new Error('Stop recording before inserting generated code.');
    }

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
    const generatedCode = recorder.setOperationIncluded(frame.operationIndex, included);
    const frames = getRecorderFrames(recorder);
    const operations = recorder.getOperations();
    this.setSession({
      ...this.session,
      frames,
      operationCount: operations.length,
      rawEventCount: recorder.getRawEvents().length,
      generatedCode: this.session.status === 'preview' ? generatedCode : this.session.generatedCode,
      flow: this.session.recordingId
        ? buildFlowFromRecording({
            frames,
            operations,
            recordingId: this.session.recordingId,
            testName: this.session.testName,
            targetFile: this.session.targetFile,
          })
        : this.session.flow,
    });
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

  async saveGeneratedCode(workspaceRoot: vscode.Uri, targetFile?: vscode.Uri): Promise<vscode.Uri> {
    if (!this.session.generatedCode) {
      throw new Error('Stop recording before saving generated code.');
    }

    const target = targetFile ?? vscode.Uri.file(path.join(
      workspaceRoot.fsPath,
      'tests',
      `recorded-${Date.now()}.test.ts`,
    ));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
    await vscode.workspace.fs.writeFile(target, Buffer.from(`${this.session.generatedCode}\n`, 'utf8'));
    await vscode.window.showTextDocument(target);
    this.setSession({
      ...this.session,
      targetFile: target.fsPath,
      flow: withFlowTargetFile(this.session.flow, target.fsPath),
    });
    await this.persistSession(workspaceRoot);
    return target;
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
