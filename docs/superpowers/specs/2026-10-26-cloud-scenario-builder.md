# Cloud scenario builder

Status: implementation contract

## Outcome

Project users can create a named test environment in the Cloud browser without
writing scenario declarations. A project-level scenario tab lists discovered
scenarios and opens a builder, including before a project is ready to run.

## Contract

- Repository configuration remains the source of truth. The builder previews,
  copies and downloads a TypeScript scenario file and shows how to merge its
  declarations into the existing `fliwright.config.ts`. It does not write to Git.
- Choose a unique name, a Mock directory and optional Mock profile, an optional
  starting route, and individual endpoint response overrides. Login, guest,
  expired-session and user-specific states are expressed by the Mock profile; the
  builder does not inject authentication state directly.
- Catalog collection publishes Mock directory, profile candidates, endpoint, HTTP
  method, available rule names and default selection; response bodies are not
  published. Profile candidates combine repository-declared Mock profiles with
  rule names, so a profile is a reusable rule combination rather than a separate
  auth setting.
  Discover `.fliwright/mocks` and directories referenced by repository scenarios.
- Missing Mock files do not block case collection or creation of a route-only
  scenario. The browser explains how to make file-based rules discoverable.
- A single mocks layer loads defaults once, applies the selected profile, then
  applies explicit endpoint/method overrides. Invalid or duplicate selections fail
  preparation before navigation.
- No dependencies or package dependency directions change.

## Acceptance

1. A project with cases but no scenarios can open the builder.
2. Users can combine different rules for different endpoints, including methods
   sharing a path, and generate a declaration accepted by the actual runtime.
3. Blank/duplicate names, invalid routes and stale rule selections block export.
4. Copy/download failures are visible and leave the preview available.
5. Export explains that it becomes runnable only after commit, scan and readiness
   confirmation; generating a file does not change project readiness.
6. Tests cover runtime composition, metadata collection/transport, and the browser
   generation path. Browser layout is checked visually when a browser is available.
