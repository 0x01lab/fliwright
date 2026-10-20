# Deploy Cloud Server and host Workers as separate packages

- Status: accepted
- Date: 2026-10-19

## Context

Device computers connect to one centralized Cloud Server. Bundling the host
executor and server into the same package forces different deployment roles to
share an entry point and loads server persistence in the device process.

## Decision

`@fliwright/cloud` owns the queue, leases, device policies, reports and browser
administration. `@fliwright/cloud-worker` owns CLI-started discovery, task
execution, supervised process groups, reset, recovery and publication retries.
Workers call `@fliwright/devices`; the server receives normalized snapshots.

`@fliwright/cloud-protocol` owns shared wire schemas, inferred device snapshot
types, the HTTP client and artifact path validation. It depends on neither
runtime nor the native discovery implementation. Both runtimes consume its
public exports. Worker source never imports the Cloud Server; the server is a
development dependency only for HTTP integration tests.

The Worker entry point is `fliwright-cloud-worker run <config.json>` with
`discover`, `recover` and `retry-uploads` commands. Each configured execution
slot keeps its own process and root. Host IDs identify computers, so slot
instances on one host can share that host identity. All hosts report to the
configured central Server using distinct host credentials.

Old Cloud Worker commands and exports are removed instead of forwarded. This
changes deployment paths, not lease fencing, cleanup or execution semantics.

## Consequences

Server and Worker can be built and exported as separate production deployment
directories. The private workspace packages are not yet npm releases. Process
managers such as launchd/systemd run the CLI; the CLI does not install a daemon.
Discovery works without an execution root or reset policy. Device enrollment
remains independent of deploying an executor on the host.

Isolation tests reject host-runtime imports in Cloud and server/SQLite imports
in Worker subprocesses; HTTP integration tests exercise discovery, polling and
graceful shutdown. Existing execution failure and recovery tests move with the
Worker implementation.
