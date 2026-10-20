# Cloud replay uses a single D3 elapsed-time scale

- Status: accepted
- Date: 2026-10-19
- Scope: @fliwright/cloud replay timeline
- Evidence: `packages/fliwright-cloud/tests/replay-model.test.ts`, `packages/fliwright-cloud/tests/time-timeline.test.ts`
- Changed-Files: `packages/fliwright-cloud/src/web/TimeTimeline.tsx`, `packages/fliwright-cloud/src/web/replay-model.ts`, `packages/fliwright-cloud/src/web/style.css`, `packages/fliwright-cloud/package.json`
- Supersedes: none

## Decision

Use D3's modular `d3-scale` package for replay's elapsed millisecond scale.
Keep the exact recorded domain: do not round or expand it with `nice()`.
Generate ticks and interval endpoints from that scale; use its clamped inverse
for pointer seeking so zoom and horizontal scrolling preserve time selection.
Valid start/end timestamps determine duration, with recorded duration metadata
used only when the timestamp pair is unavailable.

Duration bars must have no minimum width, padding or layout borders that inflate
short intervals. Use inset decoration for their visual boundaries. Zero-duration
and incomplete operations remain fixed-size point markers rather than implying
an invented duration.

## Verification

The cloud test suite covers unequal durations, gaps, overlapping steps, missing
and zero timings, conflicting duration metadata, and pointer seeking on zoomed
surfaces. Cloud build and TypeScript lint also pass.
