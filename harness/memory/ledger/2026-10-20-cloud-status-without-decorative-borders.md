# Cloud status styling avoids decorative borders

- Status: accepted
- Date: 2026-10-20
- Scope: @fliwright/cloud web UI
- Evidence: `packages/fliwright-cloud/src/web/style.css`, `docs/fliwright-theme.md`
- Changed-Files: `packages/fliwright-cloud/src/web/style.css`, `packages/fliwright-cloud/src/web/ui.tsx`, `packages/fliwright-cloud/src/web/Replay.tsx`, `packages/fliwright-cloud/src/web/TimeTimeline.tsx`, `packages/fliwright-cloud/src/web/TestBoard.tsx`
- Supersedes: none

## Decision

Do not use decorative colored outlines, status edge stripes, colored group
underlines, or selection outlines in Cloud UI. Communicate state and selection
through subtle fills, spacing, text, and icons. Keep visible focus rings for
keyboard navigation; use neutral dividers only where they clarify structure.

For success and failure states, use a solid green or red circle with a white
check or cross. Keep these result icons consistent across replay steps, the
timeline and the test board, with an accessible text label. Other states keep
their own semantic icons.
