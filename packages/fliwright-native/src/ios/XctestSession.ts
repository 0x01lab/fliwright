import { NativeError, type DeviceCapabilities, type NativeCommand, type NativeIdentity, type NativeOperationContext,
  type NativeQuery, type NativeSessionAdapter, type NativeSnapshot } from '@fliwright/core';
import type { RunnerBroker } from './RunnerBroker.js';
import { parseXctestSnapshot } from './XctestSnapshot.js';

interface XctestSessionOptions {
  identity: NativeIdentity;
  broker: Pick<RunnerBroker, 'request'>;
  allowedAppIds: string[];
  systemAppIds: string[];
  close(): Promise<void>;
}

/** Adapter for a ready, owned XCTest Runner; native coordinates are screen points. */
export class XctestSession implements NativeSessionAdapter {
  readonly identity: NativeIdentity;
  private latest?: NativeSnapshot;
  private closed = false;
  private closing?: Promise<void>;
  constructor(private readonly options: XctestSessionOptions) { this.identity = options.identity; }

  async capabilities(_context: NativeOperationContext): Promise<DeviceCapabilities> {
    this.checkOpen();
    return xctestCapabilities();
  }
  async snapshot(context: NativeOperationContext, query?: NativeQuery): Promise<NativeSnapshot> {
    this.checkOpen();
    const appIds = query?.scope === 'app' ? [this.identity.appId] : query?.scope === 'system' ? this.options.systemAppIds
      : query && typeof query.scope === 'object' ? [query.scope.appId] : this.options.allowedAppIds;
    if (appIds.some(id => !this.options.allowedAppIds.includes(id))) throw new NativeError('precondition_failed', 'Native query application is not allowlisted.');
    const payload = await this.options.broker.request('snapshot', { ...(query ? { query } : {}), appIds }, context);
    this.latest = parseXctestSnapshot(payload, this.identity, this.options.allowedAppIds);
    return this.latest;
  }
  async execute(command: NativeCommand, context: NativeOperationContext): Promise<unknown> {
    this.checkOpen();
    if (command.kind === 'click' || command.kind === 'fill') {
      const current = this.latest?.nodes.find(node => node.id === command.node.id);
      if (this.latest?.id !== command.snapshotId || !current || JSON.stringify(current) !== JSON.stringify(command.node)) {
        throw new NativeError('precondition_failed', 'XCTest target does not belong to the latest snapshot.');
      }
      if (command.kind === 'fill' && (current.password || typeof command.text !== 'string'
        || command.text.length > 4096 || /[^\x20-\x7e]/.test(command.text))) {
        throw new NativeError('unsupported_capability', 'XCTest replacement requires at most 4096 printable ASCII characters in a readable non-password text field.');
      }
      return this.options.broker.request(command.kind, command, context);
    }
    if (command.kind === 'swipe') return this.options.broker.request('swipe', command, context);
    throw new NativeError('unsupported_capability', `${command.kind} is not supported by the XCTest adapter.`);
  }
  async screenshot(context: NativeOperationContext): Promise<Buffer> {
    this.checkOpen();
    const payload = await this.options.broker.request('screenshot', {}, context) as { png?: unknown } | undefined;
    if (typeof payload?.png !== 'string' || payload.png.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.png)) {
      throw new NativeError('protocol_mismatch', 'Invalid XCTest screenshot payload.');
    }
    const png = Buffer.from(payload.png, 'base64');
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new NativeError('protocol_mismatch', 'XCTest screenshot is not a PNG.');
    return png;
  }
  dispose(): Promise<void> {
    if (!this.closing) { this.closed = true; this.closing = this.options.close(); }
    return this.closing;
  }
  private checkOpen(): void { if (this.closed) throw new NativeError('cancelled', 'XCTest session has closed.'); }
}

/** Static support declarations shared with read-only doctor; readiness still requires a live Runner. */
export function xctestCapabilities(): DeviceCapabilities {
  const backend = 'xctest';
  const supported = { support: 'supported' as const, ready: true, backend };
  const unsupported = { support: 'unsupported' as const, ready: false, backend };
  const unverified = { support: 'unverified' as const, ready: false, backend };
  return {
    ...Object.fromEntries(['native.query', 'native.click', 'native.swipe', 'screen.capture'].map(key => [key, supported])),
    'native.fill.basic': { ...unverified, reason: 'Replacement/input must be verified on the selected iOS version and text control.' },
    'native.fill.unicode': { ...unverified, reason: 'Unicode replacement has not yet passed device verification.' },
    'native.back': { ...unsupported, reason: 'iOS has no Android Back action; locate the real navigation control.' },
    'biometrics.match': { ...unverified, reason: 'A supported headless iOS biometric injection interface has not been verified.' },
    'biometrics.reject': { ...unverified, reason: 'A supported headless iOS biometric injection interface has not been verified.' },
  };
}
