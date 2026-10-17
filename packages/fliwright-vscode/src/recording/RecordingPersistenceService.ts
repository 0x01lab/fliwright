import * as vscode from 'vscode';
import { copyRecordingArtifacts, flowFileName, parseRecordingManifest, type FliwrightFlowDocument, type RecordingManifest } from '@fliwright/core';
import { loadWorkspaceConfig, resolveWorkspacePath } from '../config.js';
import type { RecordingSession } from '../types.js';

export type PersistedRecordingManifest = RecordingManifest;

export interface RecordingListItem {
  id: string;
  label: string;
  description?: string;
  recordingDir: vscode.Uri;
  manifestUri: vscode.Uri;
  manifest: PersistedRecordingManifest;
}

export class RecordingPersistenceService {
  async save(workspaceRoot: vscode.Uri, session: RecordingSession, recordingId = createRecordingId(session)): Promise<vscode.Uri> {
    const config = await loadWorkspaceConfig(workspaceRoot);
    const recordingDir = vscode.Uri.joinPath(resolveWorkspacePath(workspaceRoot, config.paths.recordings), recordingId);
    await vscode.workspace.fs.createDirectory(recordingDir);
    const frames = session.frames ?? [];
    await copyRecordingArtifacts({ frames, rawEventsFile: session.recording?.rawEventsFile },
      session.artifactDirectory, recordingDir.fsPath);

    const now = new Date().toISOString();
    const manifest: PersistedRecordingManifest = {
      schemaVersion: 2,
      id: recordingId,
      createdAt: new Date(session.startedAt ?? Date.now()).toISOString(),
      updatedAt: now,
      rawEventCount: session.rawEventCount,
      operationCount: session.operationCount,
      testName: session.testName,
      targetFile: session.targetFile,
      generatedCode: session.generatedCode,
      flow: session.flow,
      flowFile: session.flowFile,
      recording: session.recording,
      recordedSelectors: session.recordedSelectors,
      generationOptions: session.generationOptions,
      readiness: session.readiness,
      checkpoints: session.checkpoints,
      frames,
    };
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(recordingDir, 'recording.json'),
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    );
    return recordingDir;
  }

  async saveProjectFlow(workspaceRoot: vscode.Uri, flow: FliwrightFlowDocument): Promise<vscode.Uri> {
    const config = await loadWorkspaceConfig(workspaceRoot);
    const flowsRoot = resolveWorkspacePath(workspaceRoot, config.paths.flows);
    await vscode.workspace.fs.createDirectory(flowsRoot);
    const flowUri = vscode.Uri.joinPath(flowsRoot, flowFileName(flow.id));
    await vscode.workspace.fs.writeFile(
      flowUri,
      Buffer.from(`${JSON.stringify(flow, null, 2)}\n`, 'utf8'),
    );
    return flowUri;
  }

  async list(workspaceRoot: vscode.Uri): Promise<RecordingListItem[]> {
    const config = await loadWorkspaceConfig(workspaceRoot);
    const recordingsRoot = resolveWorkspacePath(workspaceRoot, config.paths.recordings);
    let entries: [string, unknown][];
    try {
      entries = await vscode.workspace.fs.readDirectory(recordingsRoot) as [string, unknown][];
    } catch {
      return [];
    }

    const recordings: RecordingListItem[] = [];
    for (const [name] of entries) {
      const recordingDir = vscode.Uri.joinPath(recordingsRoot, name);
      const manifestUri = vscode.Uri.joinPath(recordingDir, 'recording.json');
      try {
        const manifest = parseRecordingManifest(Buffer.from(await vscode.workspace.fs.readFile(manifestUri)).toString('utf8'));
        recordings.push({
          id: manifest.id,
          label: manifest.testName || manifest.id,
          description: `${manifest.operationCount} operations · ${manifest.updatedAt}`,
          recordingDir,
          manifestUri,
          manifest,
        });
      } catch {
        // Ignore corrupt or partial recording directories.
      }
    }
    recordings.sort((a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt));
    return recordings;
  }

  async load(recordingDir: vscode.Uri): Promise<RecordingSession> {
    const manifestUri = vscode.Uri.joinPath(recordingDir, 'recording.json');
    const manifest = parseRecordingManifest(Buffer.from(await vscode.workspace.fs.readFile(manifestUri)).toString('utf8'));
    // Read metadata only. The webview requests individual visible images by URL.
    const frames = manifest.frames;

    return {
      status: 'preview',
      startedAt: Date.parse(manifest.createdAt),
      rawEventCount: manifest.rawEventCount,
      operationCount: manifest.operationCount,
      frames,
      generatedCode: manifest.generatedCode,
      flow: manifest.flow,
      targetFile: manifest.targetFile,
      testName: manifest.testName,
      recordingId: manifest.id,
      recordingDir: recordingDir.fsPath,
      artifactDirectory: recordingDir.fsPath,
      flowFile: manifest.flowFile,
      recording: manifest.recording,
      recordedSelectors: manifest.recordedSelectors,
      generationOptions: manifest.generationOptions,
      readiness: manifest.readiness,
      checkpoints: manifest.checkpoints,
    };
  }
}

function createRecordingId(session: RecordingSession): string {
  const startedAt = session.startedAt ?? Date.now();
  return `recording-${startedAt}`;
}
