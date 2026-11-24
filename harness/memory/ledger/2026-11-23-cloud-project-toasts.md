# Cloud feedback and notifications use shadcn Sonner

- Status: accepted
- Date: 2026-11-23
- Scope: @fliwright/cloud web console
- Evidence: User direction on 2026-11-23, `packages/fliwright-cloud/tests/projects.test.ts`, shadcn/ui `radix-mira` Sonner registry component
- Changed-Files: `packages/fliwright-cloud/src/web/components/ui/sonner.tsx`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cloud/src/web/Projects.tsx`, `packages/fliwright-cloud/src/web/style.css`, `packages/fliwright-cloud/package.json`, `harness/stack/framework.json`, `pnpm-lock.yaml`
- Supersedes: none

## Decision

All status-change feedback, action results (including submission failures), and message notifications must use the shared shadcn Sonner toast. Keep this feedback outside the content flow of pages, forms, and dialogs so messages never shift the interface.

Mount the package-local toaster in the workspace shell so notifications stay visible during navigation. Place toasts at the bottom right and let them dismiss automatically, with no close icon. Use the Cloud theme tokens and bundle Sonner's exported stylesheet to support Cloud's self-only style policy.
