# Cloud startup and deployment

Implemented scope: repository commands and standalone Node 26 deployment, with
configuration and persistent state independent of executable installation paths.

- `pnpm cloud:init [directory]` creates `.fliwright/cloud/server.json` by default,
  exclusively, with private permissions and random stable publication/proxy secrets.
- `pnpm cloud:start [config]` runs the standard Server in the foreground.
  Server config precedence is argument, `FLIWRIGHT_CLOUD_CONFIG`, then the default
  path relative to the working directory. Relative `dataRoot` belongs to the
  configuration directory. `cloud:health` checks the backend with a bounded timeout.
- Local initialization enables an explicit `localUser` on loopback. Browser
  identity requires a loopback peer, exact configured Host, same-origin browser
  requests and Origin on mutations. Bearer authentication remains authoritative.
  Configuration rejects local identity on a wildcard listener or public origin.
- Team deployment uses the existing HTTPS identity proxy and user mapping;
  `localUser` must be removed. The CLI never installs OS services automatically.
- `cloud:deploy` and `cloud:deploy-worker` build the selected dependency closure
  and use pnpm's production deployment to a new release directory. The release
  contains the binary wrapper, compiled code, assets and runtime dependencies.
  Config/secrets/data stay outside the release; operators use launchd/systemd
  templates to supervise processes, choose restart behavior and collect logs.
- Existing preview data is preserved. It may be adopted by a new private config
  with the original publication secret and absolute dataRoot. The old ad-hoc
  launcher/proxy is not part of the supported startup path.

Verification: CLI subprocess tests cover private/exclusive init, another cwd,
env config selection, relative persistence paths, HTTP identity, health and
SIGTERM. HTTP tests cover local identity restrictions. Standalone deployment
smoke must invoke the packaged binary from outside the checkout and serve assets.
