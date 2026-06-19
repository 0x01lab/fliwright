import type {
  AgentVisibleFailure,
  TimelineArtifactRef,
  TimelineData,
  TimelineNode,
  TimelineNodeKind,
  TimelineNodeStartOptions,
  TimelineRecorderOptions,
  TimelineRunStatus,
} from './types.js';

export class TimelineRecorder {
  private readonly nodes: TimelineNode[] = [];
  private readonly stack: string[] = [];
  private readonly failures: AgentVisibleFailure[] = [];
  private counter = 0;
  private status: TimelineRunStatus = 'running';
  private endedAt: string | undefined;

  constructor(private readonly options: TimelineRecorderOptions) {}

  get runId(): string {
    return this.options.runId;
  }

  get testName(): string {
    return this.options.testName;
  }

  get mode() {
    return this.options.mode ?? 'test';
  }

  startNode(kind: TimelineNodeKind, title: string, options: TimelineNodeStartOptions = {}): TimelineNode {
    const parentId = options.parentId ?? this.stack[this.stack.length - 1];
    const node: TimelineNode = {
      id: this.nextNodeId(kind),
      ...(parentId ? { parentId } : {}),
      kind,
      title,
      status: 'running',
      startedAt: new Date().toISOString(),
      ...(options.route ? { route: options.route } : {}),
      ...(options.codeRef ? { codeRef: options.codeRef } : {}),
      ...(options.artifacts?.length ? { artifacts: [...options.artifacts] } : {}),
      ...(options.metadata ? { metadata: { ...options.metadata } } : {}),
    };
    this.nodes.push(node);
    this.stack.push(node.id);
    return node;
  }

  passNode(id: string, metadata?: Record<string, unknown>): TimelineNode {
    const node = this.requireNode(id);
    node.status = 'passed';
    node.endedAt = new Date().toISOString();
    if (metadata) node.metadata = { ...(node.metadata ?? {}), ...metadata };
    this.popStack(id);
    return node;
  }

  failNode(id: string, failure: AgentVisibleFailure, metadata?: Record<string, unknown>): TimelineNode {
    const node = this.requireNode(id);
    const normalized = { ...failure, timelineNodeId: failure.timelineNodeId ?? id };
    node.status = 'failed';
    node.endedAt = new Date().toISOString();
    node.error = normalized;
    if (metadata) node.metadata = { ...(node.metadata ?? {}), ...metadata };
    this.failures.push(normalized);
    this.status = 'failed';
    this.popStack(id);
    return node;
  }

  skipNode(id: string, metadata?: Record<string, unknown>): TimelineNode {
    const node = this.requireNode(id);
    node.status = 'skipped';
    node.endedAt = new Date().toISOString();
    if (metadata) node.metadata = { ...(node.metadata ?? {}), ...metadata };
    this.popStack(id);
    return node;
  }

  addArtifacts(id: string, artifacts: TimelineArtifactRef[]): TimelineNode {
    const node = this.requireNode(id);
    node.artifacts = [...(node.artifacts ?? []), ...artifacts];
    return node;
  }

  complete(status?: TimelineRunStatus): TimelineData {
    const finalStatus = status ?? (this.status === 'failed' ? 'failed' : 'passed');
    this.status = finalStatus;
    this.endedAt = new Date().toISOString();
    for (const node of this.nodes) {
      if (node.status === 'running') {
        node.status = finalStatus === 'failed' ? 'failed' : 'passed';
        node.endedAt = this.endedAt;
      }
    }
    this.stack.length = 0;
    return this.toJSON();
  }

  toJSON(): TimelineData {
    return {
      version: 1,
      runId: this.options.runId,
      testName: this.options.testName,
      mode: this.options.mode ?? 'test',
      status: this.status,
      startedAt: this.options.startedAt ?? this.nodes[0]?.startedAt ?? new Date().toISOString(),
      ...(this.endedAt ? { endedAt: this.endedAt } : {}),
      nodes: this.nodes.map((node) => ({ ...node, artifacts: node.artifacts ? [...node.artifacts] : undefined })),
      ...(this.failures.length ? { agentVisibleFailures: [...this.failures] } : {}),
    };
  }

  currentNode(): TimelineNode | undefined {
    const id = this.stack[this.stack.length - 1];
    return id ? this.nodes.find((node) => node.id === id) : undefined;
  }

  private requireNode(id: string): TimelineNode {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) throw new Error(`Timeline node not found: ${id}`);
    return node;
  }

  private popStack(id: string): void {
    const index = this.stack.lastIndexOf(id);
    if (index === -1) return;
    this.stack.splice(index, 1);
  }

  private nextNodeId(kind: TimelineNodeKind): string {
    this.counter += 1;
    return `${kind}-${this.counter}`;
  }
}
