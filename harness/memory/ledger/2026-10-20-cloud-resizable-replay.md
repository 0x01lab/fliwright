# Cloud replay uses local shadcn Resizable panels

- Status: accepted
- Date: 2026-10-20
- Scope: @fliwright/cloud replay UI
- Evidence: Cloud build, lint and 86 tests; browser checks of mouse dragging, keyboard resizing, focus mode and 390px/1100px/1600px layouts
- Changed-Files: `packages/fliwright-cloud/src/web/components/ui/resizable.tsx`, `packages/fliwright-cloud/src/web/Replay.tsx`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cloud/src/web/style.css`, `packages/fliwright-cloud/package.json`, `harness/stack/framework.json`, `pnpm-lock.yaml`
- Supersedes: none

## Decision

Cloud owns its shadcn Resizable wrapper over `react-resizable-panels` (`^2.1.9`),
using the same approved primitive version as the VS Code package without
importing across UI package boundaries. The replay defaults to 18% steps,
32% screenshot stage and 50% inspector, so evidence gets more room than the
phone preview. Both dividers remain accessible to pointer and keyboard users.

At widths up to 900px the group switches to vertical panels with 22% / 43% /
35% defaults and scrollable content. Focus mode retains resizable panels.
Replay arrow and space shortcuts must leave focused separator controls alone,
just as they already do for tabs, sliders and checkboxes.

Report-level run information, execution attempts, live events and sharing are
composed into the replay inspector as additional tabs. Keep their panels mounted
when inactive so the event stream and sharing form state survive tab switches;
only the active tab is displayed. The request page without a published report
retains standalone diagnostics. Shared reports receive no private report tabs.
Tab triggers use a fixed compact height so wrapped tab rows do not overlap the
content below them.
