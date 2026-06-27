import * as vscode from 'vscode';
import { FliwrightDriver } from '@fliwright/core';
import { riverpodPlugin } from '@fliwright/plugin-riverpod';
import type { DeviceConnectionState } from '../types.js';
import { resolveVmServiceUrl } from './VmServiceDiscovery.js';

export interface FliwrightSessionOptions {
  createDriver?: () => FliwrightDriver;
}

export class FliwrightSession implements vscode.Disposable {
  private readonly onDidChangeStateEmitter = new vscode.EventEmitter<DeviceConnectionState>();
  readonly onDidChangeState = this.onDidChangeStateEmitter.event;

  private driver: FliwrightDriver | undefined;
  private stateValue: DeviceConnectionState = { status: 'disconnected' };

  constructor(private readonly options: FliwrightSessionOptions = {}) {}

  get state(): DeviceConnectionState {
    return this.stateValue;
  }

  get connectedDriver(): FliwrightDriver {
    if (!this.driver || !isActiveConnectionState(this.stateValue)) {
      throw new Error('Connect to a Flutter VM Service before using this command.');
    }
    return this.driver;
  }

  get currentUrl(): string | undefined {
    return 'url' in this.stateValue ? this.stateValue.url : undefined;
  }

  setRunning(label: string): DeviceConnectionState {
    const previous = this.stateValue;
    this.setState({ status: 'running', url: this.currentUrl, startedAt: Date.now(), label });
    return previous;
  }

  finishRunning(previous: DeviceConnectionState): void {
    if (this.stateValue.status !== 'running') return;

    const url = this.currentUrl;
    if (this.driver && url) {
      this.setState({ status: 'connected', url, connectedAt: Date.now() });
      return;
    }

    this.setState(previous.status === 'running' ? { status: 'disconnected' } : previous);
  }

  setRecording(): void {
    const url = this.currentUrl;
    if (url) {
      this.setState({ status: 'recording', url, startedAt: Date.now() });
    }
  }

  setScanning(label?: string, force = false): void {
    if (force || !isActiveConnectionState(this.stateValue)) {
      this.setState({ status: 'scanning', label });
    }
  }

  setConnectedIdle(): void {
    const url = this.currentUrl;
    if (this.driver && url) {
      this.setState({ status: 'connected', url, connectedAt: Date.now() });
    }
  }

  async connect(inputUrl?: string): Promise<DeviceConnectionState> {
    const url = await resolveVmServiceUrl({ userInput: inputUrl });
    if (!url) {
      const errorState: DeviceConnectionState = {
        status: 'error',
        message: 'No VM Service URL configured or discovered.',
      };
      this.setState(errorState);
      return errorState;
    }

    await this.disconnect(false);
    this.setState({ status: 'connecting', url });

    const driver = this.options.createDriver?.() ?? new FliwrightDriver({ plugins: [riverpodPlugin()] });
    try {
      await driver.connect(url);
      this.driver = driver;
      const connectedState: DeviceConnectionState = {
        status: 'connected',
        url,
        connectedAt: Date.now(),
      };
      this.setState(connectedState);
      return connectedState;
    } catch (error) {
      await driver.dispose().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const errorState: DeviceConnectionState = { status: 'error', url, message };
      this.setState(errorState);
      return errorState;
    }
  }

  async disconnect(emit = true): Promise<void> {
    const current = this.driver;
    this.driver = undefined;
    if (current) {
      await current.dispose();
    }
    if (emit) {
      this.setState({ status: 'disconnected' });
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.driver || !isActiveConnectionState(this.stateValue)) return false;

    try {
      await this.driver.sendRequest('getVM');
      return true;
    } catch {
      return false;
    }
  }

  async markConnectionLost(message: string): Promise<void> {
    const url = this.currentUrl;
    await this.disconnect(false);
    this.setState({ status: 'error', url, message });
  }

  dispose(): void {
    void this.disconnect(false);
    this.onDidChangeStateEmitter.dispose();
  }

  private setState(state: DeviceConnectionState): void {
    this.stateValue = state;
    this.onDidChangeStateEmitter.fire(state);
  }
}

function isActiveConnectionState(state: DeviceConnectionState): boolean {
  return state.status === 'connected' || state.status === 'recording' || state.status === 'running';
}
