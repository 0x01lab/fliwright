# Cloud console owns its shadcn components and Tailwind theme

- Status: accepted
- Date: 2026-10-19
- Scope: @fliwright/cloud web UI
- Evidence: `packages/fliwright-cloud/tests/web-ui.test.ts`, `packages/fliwright-cloud/src/web/components/ui/`, browser verification of form submission, replay tabs, slider and mobile themes
- Supersedes: none
- Changed-Files: `packages/fliwright-cloud/src/web/Replay.tsx`, `packages/fliwright-cloud/src/web/TimeTimeline.tsx`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cloud/src/web/ui.tsx`, `packages/fliwright-cloud/src/web/components/ui/badge.tsx`, `packages/fliwright-cloud/src/web/components/ui/button.tsx`, `packages/fliwright-cloud/src/web/components/ui/card.tsx`, `packages/fliwright-cloud/src/web/components/ui/checkbox.tsx`, `packages/fliwright-cloud/src/web/components/ui/input.tsx`, `packages/fliwright-cloud/src/web/components/ui/label.tsx`, `packages/fliwright-cloud/src/web/components/ui/native-select.tsx`, `packages/fliwright-cloud/src/web/components/ui/slider.tsx`, `packages/fliwright-cloud/src/web/components/ui/table.tsx`, `packages/fliwright-cloud/src/web/components/ui/tabs.tsx`, `packages/fliwright-cloud/src/web/components/ui/textarea.tsx`, `packages/fliwright-cloud/src/web/lib/utils.ts`, `packages/fliwright-cloud/package.json`, `packages/fliwright-cloud/tsconfig.json`, `packages/fliwright-cloud/src/web/style.css`, `packages/fliwright-cloud/vite.config.mjs`, `packages/fliwright-cloud/components.json`

## Decision

The cloud console uses package-local shadcn/ui components and Tailwind CSS 4
through the Vite plugin. UI source belongs to the cloud package; do not import
VS Code Webview components across package ownership boundaries. Add primitives
under `src/web/components/ui/` and style them with semantic Tailwind tokens.
Specialized replay/timeline geometry remains in the components layer.

The single cloud header uses the package-local shadcn Navigation Menu backed by
`@radix-ui/react-navigation-menu` (`^1.4.1`, approved in `framework.json`).
Only run history and queue are direct navigation links; device management,
Worker hosts, application targets and reports live in the configuration menu.
The logo returns to `/`. Compose menu links with TanStack `Link` through
`NavigationMenuLink asChild`; close the controlled menu on route changes and
selection while preserving modified-click and native keyboard behavior.
Evidence: `packages/fliwright-cloud/tests/web-routing.test.ts`.

Compose navigation links through `Button asChild` so anchors retain their native
semantics. Ordinary buttons default to `type="button"`; submission explicitly
uses `type="submit"`. Native Select retains form validation and values. Replay
keyboard shortcuts must leave Radix tabs, sliders and checkboxes in control of
their own keyboard interaction. Accessible slider labels belong on the thumb.

## Verification

- Cloud build and type checking pass.
- Cloud suite: 34 tests across 9 files, including composition and form semantics.
- Browser: required SHA validation, successful task submission, replay tabs via
  arrow keys, slider Home/ArrowRight, checkbox state, and a 390px dark form.
