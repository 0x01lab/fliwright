/**
 * TDD Loop monitor controller: owns the {@link TddLoopPanel}, polls the read-only
 * {@link TddLoopStatusSource}, and registers the panel/take-over commands.
 *
 * Single-driver ownership (design principle 4): the controller is READ-ONLY. It never creates a
 * `FliwrightDriver`, never connects to a VM service, never spawns a flutter daemon. The take-over
 * command is opt-in and disabled by default — it only fires a user-confirmation prompt and (on
 * approval) emits a request that the agent/MCP runtime cede the loop. It does NOT start a second
 * driver here.
 */
import * as vscode from 'vscode';
import { TddLoopPanel } from './TddLoopPanel.js';
import type { TddLoopStatusSource } from './TddLoopStatusSource.js';
import { toTddLoopViewModel } from './TddLoopViewModel.js';
import type { TddLoopSnapshot } from './TddLoopViewModel.js';

/** Commands contributed by this controller. */
export const TDD_LOOP_OPEN_COMMAND = 'fliwright.openTddLoop';
export const TDD_LOOP_REFRESH_COMMAND = 'fliwright.refreshTddLoop';
/** Opt-in take-over command (design principle 4 — opt-in, never the default). */
export const TDD_LOOP_TAKE_OVER_COMMAND = 'fliwright.tddTakeOver';

/** Configuration key gating the take-over command. */
export const TDD_LOOP_TAKE_OVER_ENABLED_CONFIG = 'fliwright.tddTakeOverEnabled';

/** Auto-refresh interval (ms). Conservative: the source is a file poll. */
const DEFAULT_AUTO_REFRESH_MS = 3000;

export interface TddLoopControllerOptions {
  /** Auto-refresh poll interval. Defaults to 3s. */
  autoRefreshMs?: number;
}

/**
 * Manages the TDD Loop monitor lifecycle. Constructed once in `activate`; disposed with the
 * extension context. Kept dependency-injected (source + extension URI) for hermetic testing.
 */
export class TddLoopController implements vscode.Disposable {
  private readonly panel: TddLoopPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly autoRefreshMs: number;
  private poll: ReturnType<typeof setInterval> | undefined;
  private takeOverArmed = false;

  constructor(
    private readonly source: TddLoopStatusSource,
    extensionUri: vscode.Uri | undefined,
    options: TddLoopControllerOptions = {},
  ) {
    this.autoRefreshMs = options.autoRefreshMs ?? DEFAULT_AUTO_REFRESH_MS;
    this.panel = new TddLoopPanel(extensionUri, {
      onRefresh: async () => { await this.refresh(); },
    });
  }

  /** Register all TDD Loop commands. Returns disposables (caller pushes into subscriptions). */
  registerCommands(): vscode.Disposable[] {
    return [
      vscode.commands.registerCommand(TDD_LOOP_OPEN_COMMAND, async () => {
        const snapshot = await this.refresh();
        this.panel.open(snapshot);
      }),
      vscode.commands.registerCommand(TDD_LOOP_REFRESH_COMMAND, async () => {
        const snapshot = await this.refresh();
        this.panel.update(snapshot);
      }),
      // Take-over is opt-in (design principle 4). Hidden unless the user enables it in settings
      // AND arms it via this command (which itself prompts for confirmation). It never starts a
      // second driver locally — it only signals intent to the MCP-owned runtime.
      vscode.commands.registerCommand(TDD_LOOP_TAKE_OVER_COMMAND, async () => {
        if (!this.isTakeOverEnabled()) {
          await vscode.window.showInformationMessage(
            'TDD take-over is off by default to respect single-driver ownership. Enable "Fliwright › Tdd Take Over Enabled" in settings, then run this command again.',
          );
          return;
        }
        const choice = await vscode.window.showWarningMessage(
          'Take over the TDD loop?',
          { modal: true, detail: 'This signals the running MCP-owned TDD runtime to cede the loop so VS Code can drive it. Only one driver may run the loop at a time. Continue?' },
          'Take over',
        );
        if (choice !== 'Take over') return;
        this.takeOverArmed = true;
        // No local driver is created here. The actual hand-off is owned by the MCP runtime side.
        await vscode.commands.executeCommand('fliwright.refreshTddLoop');
      }),
    ];
  }

  /** Read the source once, push to the panel, and return the snapshot. */
  async refresh(): Promise<TddLoopSnapshot | undefined> {
    const snapshot = await this.source.read();
    this.panel.update(snapshot);
    return snapshot;
  }

  /** Start the auto-refresh poll. Idempotent. */
  startAutoRefresh(): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      void this.refresh();
    }, this.autoRefreshMs);
  }

  /** Whether the take-over command should be enabled (gated by a setting). Exposed for tests. */
  isTakeOverEnabled(): boolean {
    const cfg = vscode.workspace.getConfiguration('fliwright');
    return Boolean(cfg.get<boolean>(TDD_LOOP_TAKE_OVER_ENABLED_CONFIG));
  }

  /** Whether take-over has been armed (for tests / status). Resets only on dispose. */
  isTakeOverArmed(): boolean {
    return this.takeOverArmed;
  }

  /** Exposed so the host can render a snapshot for the open command without a second read. */
  toViewModel(snapshot: TddLoopSnapshot | undefined) {
    return toTddLoopViewModel(snapshot);
  }

  dispose(): void {
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
