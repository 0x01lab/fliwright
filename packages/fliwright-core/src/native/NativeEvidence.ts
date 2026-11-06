import { randomUUID } from 'node:crypto';
import type { EvidenceRequest, EvidenceResult } from '../RunSession.js';
import type { TimelineArtifactStore } from '../timeline/TimelineArtifactStore.js';
import type { NativeRuntime } from './NativeRuntime.js';
import { NativeError, type NativeOperationContext, type NativeQuery } from './types.js';

export interface NativeEvidenceOptions {
  artifactStore: TimelineArtifactStore;
  /** Per-channel budget, independent of an action's exhausted deadline. */
  timeoutMs?: number;
  getSignal?: () => AbortSignal | undefined;
}

/** Read-only capture while RunSession still owns the action; never re-enters the action queue. */
export function createNativeEvidenceProvider(runtime: NativeRuntime, options: NativeEvidenceOptions,
  lifetime: AbortSignal, onUnfinishedRead: () => void): (request: EvidenceRequest) => Promise<EvidenceResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new NativeError('precondition_failed', 'Native evidence budget must be positive.');
  return async request => {
    const controller = new AbortController();
    const external = options.getSignal?.();
    const signal = AbortSignal.any([controller.signal, lifetime, ...(external ? [external] : [])]);
    const context: NativeOperationContext = { requestId: `evidence-${randomUUID()}`, deadline: Date.now() + timeoutMs, signal };
    const suffix = `native-${request.operationId ?? 'checkpoint'}-${request.reason}-${request.kind}-${randomUUID()}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const capture = async () => {
      signal.throwIfAborted();
      const query = request.operationMetadata?.query as NativeQuery | undefined;
      const metadata = { surface: 'native', backend: runtime.adapter.identity.backend,
        generation: runtime.adapter.identity.generation, capturedAt: new Date().toISOString(), redacted: false };
      let artifact: { path: string };
      if (request.kind === 'screenshot') {
        await runtime.requireCapability('screen.capture', context);
        const png = await runtime.adapter.screenshot(context);
        signal.throwIfAborted();
        artifact = await options.artifactStore.writeScreenshot(suffix, png);
      } else if (request.kind === 'snapshot') {
        const snapshot = await runtime.readSnapshot(context, query);
        signal.throwIfAborted();
        // Wrapper deliberately differs from the Flutter snapshot schema.
        const redacted = runtime.options.runSession?.redactReport(snapshot) ?? snapshot;
        artifact = await options.artifactStore.writeSnapshot(suffix, { surface: 'native', schemaVersion: 1, query, snapshot: {
          ...redacted, nodes: redacted.nodes.map(node => node.password ? { ...node, text: '<masked>', value: '<masked>', label: '<masked>' } : node),
        } });
      } else {
        artifact = await options.artifactStore.writeDiagnostics(suffix, { surface: 'native', identity: runtime.adapter.identity,
          capturedAt: metadata.capturedAt, query, note: 'Screenshots and trees are independent samples.' });
      }
      signal.throwIfAborted();
      return { status: 'captured' as const, artifactPaths: [artifact.path], artifactMetadata: metadata };
    };
    try {
      return await Promise.race([capture(), new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => controller.abort(new NativeError('timeout', 'Native evidence capture timed out.')), timeoutMs);
        if (signal.aborted) abort();
      })]);
    } catch (error) {
      if (signal.aborted) onUnfinishedRead();
      return { status: signal.aborted ? 'timeout' : 'unavailable', error };
    } finally {
      clearTimeout(timer);
      if (abort) signal.removeEventListener('abort', abort);
      controller.abort(new NativeError('cancelled', 'Native evidence capture completed.'));
    }
  };
}
