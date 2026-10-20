# Cloud navigation belongs to the client router

- Status: accepted
- Date: 2026-10-19
- Scope: @fliwright/cloud web navigation
- Evidence: `packages/fliwright-cloud/tests/web-routing.test.ts`, `packages/fliwright-cloud/src/web/app.tsx`
- Changed-Files: `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cloud/src/web/main.tsx`, `packages/fliwright-cloud/src/web/index.html`, `packages/fliwright-cloud/package.json`
- Supersedes: none

## Decision

The cloud console uses TanStack Router for its route tree, typed internal links,
programmatic navigation, search validation, browser history and scroll restoration.
The root layout stays mounted across route changes. Internal links compose through
`Button asChild` with `Link`; external URLs, artifact downloads and skip anchors
retain native browser behavior. Do not use document navigation for task submission,
reruns or share exchange.

Search query changes must update the mounted request list, including when only the
query changes on the current route. Dynamic request IDs remount detail state and
close the previous event stream. Share exchange removes the credential fragment
before POST, replaces history and requests only the shared report APIs.

Regression coverage mounts the actual React application in happy-dom and dispatches
real clicks/forms. Assert default-prevention, URL/content updates, retained layout,
browser history and event-stream cleanup rather than matching source strings.

## Verification

- The original sidebar click test failed because the app did not prevent native
  document navigation; it passes after integration.
- Cloud suite: 47 tests across 10 files; build and type checking pass.
- Browser navigation preserves the global search input when switching pages.
