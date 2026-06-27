import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type Listener<T> = (event: T) => void;

export class Uri {
  constructor(public readonly fsPath: string) {}

  get path(): string {
    return this.fsPath.replace(/\\/g, '/');
  }

  toString(): string {
    return this.fsPath;
  }

  static file(filePath: string): Uri {
    return new Uri(path.resolve(filePath));
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...segments));
  }
}

export class RelativePattern {
  constructor(
    public readonly base: Uri,
    public readonly pattern: string,
  ) {}
}

export class EventEmitter<T> {
  private listeners: Array<Listener<T>> = [];

  readonly event = (listener: Listener<T>) => {
    this.listeners.push(listener);
    return { dispose: () => this.disposeListener(listener) };
  };

  fire(event: T): void {
    for (const listener of this.listeners) listener(event);
  }

  dispose(): void {
    this.listeners = [];
  }

  private disposeListener(listener: Listener<T>): void {
    this.listeners = this.listeners.filter((entry) => entry !== listener);
  }
}

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export class TreeItem {
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: ThemeIcon;
  command?: Command;
  resourceUri?: Uri;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: TreeItemCollapsibleState,
  ) {}
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ViewColumn {
  Beside = -2,
}

export enum ProgressLocation {
  Window = 10,
}

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  constructor(public readonly start: Position, public readonly end: Position) {}
}

export class Selection extends Range {}

export class CodeLens {
  constructor(
    public readonly range: Range,
    public command?: Command,
  ) {}
}

export interface Command {
  command: string;
  title: string;
  arguments?: unknown[];
}

export interface Disposable {
  dispose(): void;
}

export interface TreeDataProvider<T> {
  onDidChangeTreeData?: unknown;
  getTreeItem(element: T): TreeItem;
  getChildren(element?: T): T[] | Promise<T[]>;
}

let workspaceFoldersValue: Array<{ uri: Uri }> | undefined;
let configValue: Record<string, unknown> = {};
let showInputBoxResult: string | undefined = undefined;
let showQuickPickResultProvider: ((items: unknown[], options?: { canPickMany?: boolean }) => unknown) | undefined;
let showSaveDialogResult: Uri | undefined = undefined;
export const __webviewPanels: Array<{
  webview: {
    cspSource: string;
    html: string;
    postedMessages: unknown[];
    asWebviewUri(uri: Uri): Uri;
    postMessage(message: unknown): Promise<boolean>;
    onDidReceiveMessage(): Disposable;
  };
  reveal(): void;
  dispose(): void;
}> = [];

export const workspace = {
  get workspaceFolders() {
    return workspaceFoldersValue;
  },
  set workspaceFolders(value: Array<{ uri: Uri }> | undefined) {
    workspaceFoldersValue = value;
  },
  getConfiguration() {
    return {
      get<T>(key: string, defaultValue: T): T {
        return (key in configValue ? configValue[key] : defaultValue) as T;
      },
    };
  },
  fs: {
    readFile(uri: Uri) {
      return fs.readFile(uri.fsPath);
    },
    writeFile(uri: Uri, bytes: Uint8Array) {
      return fs.writeFile(uri.fsPath, bytes);
    },
    createDirectory(uri: Uri) {
      return fs.mkdir(uri.fsPath, { recursive: true });
    },
    stat(uri: Uri) {
      return fs.stat(uri.fsPath);
    },
    async readDirectory(uri: Uri) {
      const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((entry) => [entry.name, entry.isDirectory() ? 2 : 1] as [string, number]);
    },
  },
  async findFiles(pattern: RelativePattern): Promise<Uri[]> {
    const [prefix, suffix] = pattern.pattern.split('*');
    const dir = path.join(pattern.base.fsPath, prefix.replace(/\/$/, ''));
    const entries = await fs.readdir(dir).catch(() => []);
    return entries
      .filter((entry) => entry.endsWith(suffix ?? ''))
      .map((entry) => Uri.file(path.join(dir, entry)));
  },
  async openTextDocument(input: Uri | { language?: string; content?: string }): Promise<{ uri?: Uri; languageId?: string; getText(): string }> {
    if (input instanceof Uri) {
      return { uri: input, getText: () => '' };
    }
    return {
      languageId: input.language,
      getText: () => input.content ?? '',
    };
  },
};

export const window = {
  createOutputChannel() {
    return { appendLine() {}, show() {}, dispose() {} };
  },
  createStatusBarItem() {
    const item = { text: '', command: undefined as string | undefined, show() {}, dispose() {} };
    (this as any)._lastStatusBarItem = item;
    return item;
  },
  createWebviewPanel() {
    const panel = {
      webview: {
        cspSource: 'vscode-resource:',
        html: '',
        postedMessages: [] as unknown[],
        asWebviewUri(uri: Uri) {
          return uri;
        },
        postMessage(message: unknown) {
          this.postedMessages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage() {
          return { dispose() {} };
        },
      },
      onDidDispose() {
        return { dispose() {} };
      },
      reveal() {},
      dispose() {},
    };
    __webviewPanels.push(panel);
    return panel;
  },
  registerTreeDataProvider() {
    return { dispose() {} };
  },
  activeTextEditor: undefined as any,
  showInputBox: async () => showInputBoxResult,
  showTextDocument: async (documentOrUri?: unknown) => ({
    document: 'uri' in (documentOrUri as any ?? {}) ? documentOrUri : { uri: documentOrUri },
    selection: undefined,
    edit: async () => true,
    revealRange() {},
  }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showQuickPick: async (items: unknown[], options?: { canPickMany?: boolean }) => (
    showQuickPickResultProvider ? showQuickPickResultProvider(items, options) : (options?.canPickMany ? items : items[0])
  ),
  showSaveDialog: async () => showSaveDialogResult,
  withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
};

export const commands = {
  registerCommand() {
    return { dispose() {} };
  },
  executeCommand: async () => undefined,
};

export const languages = {
  registerCodeLensProvider() {
    return { dispose() {} };
  },
};

export const debug = {
  registerDebugAdapterTrackerFactory() {
    return { dispose() {} };
  },
  onDidStartDebugSession() {
    return { dispose() {} };
  },
};

export const env = {
  clipboard: {
    writeText: async () => undefined,
  },
};

export function __setWorkspaceRoot(root: string | undefined): void {
  workspaceFoldersValue = root ? [{ uri: Uri.file(root) }] : undefined;
}

export function __setConfiguration(config: Record<string, unknown>): void {
  configValue = config;
}

export function __setShowInputBoxResult(result: string | undefined): void {
  showInputBoxResult = result;
}

export function __setShowQuickPickResult(provider: ((items: unknown[], options?: { canPickMany?: boolean }) => unknown) | undefined): void {
  showQuickPickResultProvider = provider;
}

export function __setShowSaveDialogResult(result: Uri | undefined): void {
  showSaveDialogResult = result;
}
