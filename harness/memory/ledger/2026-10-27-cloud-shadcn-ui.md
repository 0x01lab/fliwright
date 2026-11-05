# Cloud composes shadcn primitives with Tailwind utilities

- Status: accepted
- Date: 2026-10-27
- Scope: @fliwright/cloud web console
- Evidence: `packages/fliwright-cloud/src/web/style.css`, `packages/fliwright-cloud/src/web/components/ui/dialog.tsx`, `packages/fliwright-cloud/tests/projects.test.ts`, `packages/fliwright-cloud/tests/time-timeline.test.ts`
- Changed-Files: `packages/fliwright-cloud/package.json`, `packages/fliwright-cloud/src/web/Devices.tsx`, `packages/fliwright-cloud/src/web/Projects.tsx`, `packages/fliwright-cloud/src/web/Replay.tsx`, `packages/fliwright-cloud/src/web/TestBoard.tsx`, `packages/fliwright-cloud/src/web/TimeTimeline.tsx`, `packages/fliwright-cloud/src/web/WorkerExecutionTimeline.tsx`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cloud/src/web/ScenarioBuilder.tsx`, `packages/fliwright-cloud/src/web/ui.tsx`, `packages/fliwright-cloud/src/web/style.css`, `packages/fliwright-cloud/src/web/theme.css`, `packages/fliwright-cloud/src/web/index.html`, `packages/fliwright-cloud/src/web/components/ui/dialog.tsx`, `packages/fliwright-cloud/src/web/components/ui/alert.tsx`, `packages/fliwright-cloud/src/web/components/ui/empty.tsx`, `packages/fliwright-cloud/src/web/components/ui/navigation-menu.tsx`, `packages/fliwright-cloud/src/web/components/ui/resizable.tsx`, `packages/fliwright-cloud/src/web/components/ui/slider.tsx`
- Supersedes: none

## Decision

The Cloud console uses locally owned shadcn/ui radix-mira primitives for common controls, dialogs, cards, alerts and empty states. Compose layouts and state presentation with Tailwind utilities; keep `style.css` limited to the Tailwind import, theme import and source discovery. Preserve semantic theme tokens in `theme.css` and runtime geometry for timelines rather than introducing business selector CSS.

Controlled workflow dialogs use Radix focus management and scroll locking. When a workflow mounts its dialog separately from the trigger, explicitly capture and restore the trigger on close; prevent Escape and outside dismissal during submission. Portal interaction tests query the document body and await focus restoration. Use `data-ui` for stable DOM hooks instead of coupling runtime behavior and tests to utility class strings.
