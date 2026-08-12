# Research: Unified VM Service Endpoint Acquisition

Date: 2026-08-08

## Decision

Unify **VM Service endpoint acquisition**, not merely URL parsing. Treat a VM
Service URL as a short-lived, worker-local capability attached to one app and
one device session. For managed execution, the worker that starts the Flutter
app must obtain and consume the endpoint. The TeamTestQueue control plane must
receive endpoint metadata and health results, never the `wsUri` itself.

The preferred managed-launch source is Flutter's structured
`app.debugPort.params.wsUri` event. The existing `@fliwright/tdd`
`FlutterDaemonController` already follows that exact sequence: it calls
`app.start`, waits for the matching `app.debugPort`, and retains the returned
`wsUri` with its `appId`. [Flutter daemon's official protocol documentation]
states that `app.debugPort` provides `appId`, `port`, `wsUri`, and optional
`baseUri`, and explicitly says to use `wsUri` rather than construct a URL from
the port.

[Flutter daemon's official protocol documentation]: https://github.com/flutter/flutter/blob/3.41.9/packages/flutter_tools/doc/daemon.md#appdebugport

## What Exists Today

| Path | Acquisition method | Scope | Limitation |
| --- | --- | --- | --- |
| VS Code extension | DAP `output` URL extraction; cached URL; `.fliwright/config.json`; fixed loopback port scan | A developer's editor and host | Has no authority over a newly provisioned cloud device or an external device farm session. Output formatting, adapter ownership, and network topology are incidental. |
| CLI | Explicit flag, environment, config, workspace config, then fixed loopback port scan | Local attach | Duplicates discovery logic; the scan assumes fixed host-local ports and currently does not preserve tokenized paths from `/json/version`. |
| TDD runtime | `flutter daemon` -> `app.start` -> matching `app.debugPort.wsUri` | The process/device started by that runtime | It is the right managed-launch primitive but is not yet exposed as the common acquisition contract. |
| Core | Opens an endpoint and selects a runnable isolate | Any reachable endpoint | Does not currently own acquisition, candidate policy, or endpoint lifetime. |

Evidence in the repository:

- [`VmServiceDiscovery.ts`](../../packages/fliwright-vscode/src/session/VmServiceDiscovery.ts) parses
  debug output, reads workspace state, and scans `127.0.0.1` ports. Its tests
  confirm the intended developer-local fallback behavior in
  [`VmServiceDiscovery.test.ts`](../../packages/fliwright-vscode/tests/VmServiceDiscovery.test.ts).
- [`extension.ts`](../../packages/fliwright-vscode/src/extension.ts) attaches a
  Debug Adapter Protocol tracker only to Flutter/Dart debug sessions, clears
  the workspace value at session start, and writes the observed endpoint to
  `.fliwright/config.json`.
- [`vm-discovery.ts`](../../packages/fliwright-cli/src/vm-discovery.ts) repeats
  a separate, simpler priority chain and local port scan.
- [`FlutterDaemonController.ts`](../../packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts)
  obtains `wsUri` from the `app.debugPort` event correlated by `appId`; its
  focused tests are in
  [`FlutterDaemonController.test.ts`](../../packages/fliwright-tdd/tests/daemon/FlutterDaemonController.test.ts).
- [`VMServiceConnector.ts`](../../packages/fliwright-core/src/VMServiceConnector.ts)
  already verifies a live VM protocol connection when it selects a runnable
  isolate, while [`bridge.dart`](../../packages/fliwright-bridge/lib/src/bridge.dart)
  exposes the bridge compatibility and runtime-mode handshake.

## Why the VS Code Mechanism Cannot Be the Cloud Mechanism

The DAP tracker is useful as a local **attach-mode convenience**. It is not a
device-discovery protocol:

1. It only observes a debug adapter owned by the local VS Code extension host.
   A queue worker or cloud provider does not have that adapter or its output.
2. A URL such as `ws://127.0.0.1:...` is usually reachable only from the
   Flutter-tool process that created port forwarding or DDS. It is not a
   globally routable address for a queue coordinator.
3. Restarting or relaunching an app invalidates the URL and its token. A
   project-level cache is therefore not a device/session registry.
4. Log scraping is necessarily heuristic. It can see stale lines, several apps,
   or unrelated URLs; port scans cannot identify the intended app or reach a
   remote device network.

Flutter itself makes the same distinction. Its attach implementation combines
device-log discovery and mDNS, then establishes forwarding locally. This is
appropriate only for an attach adapter that owns that device connection, not
for a control plane attempting host-wide discovery. [Flutter's attach discovery
source] and [ProtocolDiscovery source] are the primary references.

[Flutter's attach discovery source]: https://github.com/flutter/flutter/blob/3.41.9/packages/flutter_tools/lib/src/device_vm_service_discovery_for_attach.dart#L15-L108
[ProtocolDiscovery source]: https://github.com/flutter/flutter/blob/3.41.9/packages/flutter_tools/lib/src/protocol_discovery.dart#L17-L144

## Recommended Unified Contract

Put the reusable data model, normalization, ranking, verification, and
selection policy in `@fliwright/core`; keep host- and transport-specific
providers in their owning integrations. This preserves the repository boundary
where core owns the reusable VM-service client protocol and VS Code owns editor
UX ([architecture responsibility matrix](../../harness/architecture/README.md)).

```text
explicit / env / workspace config       Flutter daemon              cloud-farm relay
            |                                  |                         |
            +----------- EndpointSource implementations --------------+
                                      |
                         VmServiceEndpointResolver (core)
                         normalize -> rank -> verify -> lease
                                      |
                     FliwrightDriver + required bridge handshake
                                      |
                        local session or worker-local test runner
```

Suggested contract shape (names are illustrative, not an implementation
commit):

```ts
interface VmServiceEndpoint {
  url: string;
  kind: 'direct-vm' | 'dds' | 'relay';
  source: string;
  scope: 'developer-workspace' | 'execution-worker';
  appId?: string;
  deviceId?: string;
  acquiredAt: string;
}

interface VmServiceEndpointSource {
  acquire(request: VmServiceAcquisitionRequest): Promise<VmServiceEndpoint[]>;
}

interface VmServiceEndpointLease extends VmServiceEndpoint {
  verify(): Promise<VmServiceEndpointHealth>;
  invalidate(): Promise<void>;
  dispose(): Promise<void>;
}
```

The resolver should accept ordered sources, normalize complete `ws:`/`wss:`
URIs without stripping their path token, and return a lease only after:

1. opening the WebSocket;
2. verifying `getVM` returns a runnable isolate;
3. requiring `ext.fliwright.handshake` to report a compatible, initialized
   bridge and the target's required capabilities.

`FliwrightDriver.connect()` currently treats the bridge handshake as
best-effort for compatibility. Managed execution should use a stricter
preflight verifier rather than silently accepting a VM without the Fliwright
bridge.

### Provider Ownership

| Provider | Owner | Use |
| --- | --- | --- |
| Explicit URL, environment, local workspace runtime config | CLI/MCP/VS Code adapters using core policy | Attach to an app the user already started. `.fliwright/config.json` remains a local convenience cache only. |
| Flutter/Dart DAP output | VS Code adapter | Low-risk local convenience source; retain it but do not make it the common managed path. |
| Local port scan | CLI/VS Code adapter | Last-resort developer convenience. Do not enable it in workers. |
| `flutter daemon` `app.debugPort.wsUri` | Extract the existing daemon controller into a reusable launch-source adapter, initially owned by `@fliwright/tdd` | Default for a worker that builds/starts an emulator or directly attached test device. |
| `flutter run --vmservice-out-file` | Same worker launch adapter | Structured fallback when the worker owns `flutter run` but cannot use the daemon protocol. Flutter writes `wsAddress` after attaching to the app. |
| Vendor relay/tunnel | A cloud-provider worker adapter | The adapter creates/receives the provider's worker-reachable endpoint and returns it as `kind: 'relay'`. No generic device scan can replace this integration. |

Flutter documents `--vmservice-out-file` in its `run` command and writes the
attached service `wsAddress` in the resident runner ([run option]
and [resident-runner write]). This is a better fallback than parsing stdout
when the worker owns the Flutter process.

[run option]: https://github.com/flutter/flutter/blob/3.41.9/packages/flutter_tools/lib/src/commands/run.dart#L76-L84
[resident-runner write]: https://github.com/flutter/flutter/blob/3.41.9/packages/flutter_tools/lib/src/resident_runner.dart#L1260-L1270

## Cloud Execution Lifecycle

The first planned cloud surface is a self-hosted, single-tenant queue backed by
team-operated workers, initially a Mac mini with configured simulators. This
fits the model exactly: the worker, not the queue API, owns the Flutter tool,
device connection, and endpoint. See [ADR 0002](../adr/0002-start-cloud-platform-with-a-single-tenant-team-queue.md),
[ADR 0003](../adr/0003-run-queued-e2e-work-on-team-operated-workers.md), and
the [ExecutionWorker definition](../../CONTEXT.md).

For each `ExecutionAttempt`:

1. The queue allocates an exclusive worker/device slot and completes worker
   reset.
2. The worker starts the registered `ApplicationTarget` on the allocated
   device through the launch provider.
3. The worker acquires `app.debugPort.wsUri`, or its vendor relay equivalent,
   and immediately obtains a verified endpoint lease.
4. The test process runs on that same worker. It may receive the endpoint in
   a child-process environment only for that attempt; it must not write the
   URL to the project workspace or RunBundle.
5. On hot restart, process relaunch, socket loss, or lease expiry, invalidate
   the old lease and reacquire from the launch/provider session. Never retry
   by scanning a coordinator's loopback ports.
6. On completion, dispose the driver, stop the app/relay, delete transient
   endpoint state, and return only redacted acquisition diagnostics plus
   worker/device metadata in the RunBundle.

This is aligned with the existing queue design: an `ApplicationTarget` binds
the build profile and simulator configuration, while a worker resolves and
executes it from its pre-provisioned environment
([ADR 0004](../adr/0004-restrict-queued-work-to-registered-application-targets.md)).

## Security and Operational Rules

- Treat the full URI, including its path token, as a secret-capability value.
  Do not send it to the queue API, UI, telemetry, artifacts, or shared
  `.fliwright/config.json`. Do not reconstruct it from only a port.
- Do not disable VM-service authentication codes to simplify a relay. Flutter's
  own command source warns that doing so creates remote-code-execution risk.
  ([Flutter source warning](https://github.com/flutter/flutter/blob/3.41.9/packages/flutter_tools/lib/src/commands/run.dart#L84-L91))
- Record only source kind, worker/device/app correlation IDs, timestamps,
  protocol/bridge versions, and redacted connection errors in the RunBundle.
- Model DDS separately from a direct VM endpoint. Flutter's DDS implementation
  binds a loopback service and changes the connection endpoint, so consumers
  must use the supplied URI, not presume a direct device port.
  ([DDS source](https://github.com/flutter/flutter/blob/3.41.9/packages/flutter_tools/lib/src/base/dds.dart#L62-L112))
- Fail preflight when a device-cloud provider cannot supply a worker-reachable
  debug endpoint or the target has no compatible bridge. Installing an APK on a
  newly started device alone is insufficient to make its VM Service
  discoverable.
- Application-side `dart:developer` `Service.getInfo()` can expose the current
  `serverWebSocketUri`, but it is only an address in the app/device network
  namespace. It does not create the forwarding, relay, or reachability needed
  by a separate worker. ([Dart `Service.getInfo` API](https://api.dart.dev/dart-developer/Service/getInfo.html))
- Reject Release targets during managed-execution preflight. Flutter documents
  that Release mode disables debugging and service extensions; Debug is the
  supported starting mode, and Profile capability should be proved through the
  handshake for each target. ([Flutter build modes](https://docs.flutter.dev/testing/build-modes))

## Rollout

1. Add the core resolver data model and strict verifier, with no VS Code or
   subprocess dependency. Port URL normalization and candidate ranking from the
   extension, then remove the CLI's divergent copy. The resolver only consumes
   providers; it does not own Flutter process, device, or relay control.
2. Expose the existing daemon path as a launch source, retaining its existing
   real-daemon probe and tests. Make it the default for TDD and the first
   `ExecutionWorker`.
3. Convert VS Code log parsing and port scan to adapter-provided attach sources;
   retain the current configuration file only for local developer attach.
4. Add a provider contract test suite: daemon event correlation, stale lease
   rejection after restart, URI-token preservation, strict bridge preflight,
   and a fake cloud-relay source. Run one real simulator/device probe per
   supported Flutter SDK in CI or worker provisioning.
5. Add a vendor adapter only when the cloud platform adds a provider that the
   worker cannot control through `flutter daemon`. The adapter's acceptance
   criterion is a verified, worker-local endpoint lease, not log visibility.

No implementation code was changed by this research.
