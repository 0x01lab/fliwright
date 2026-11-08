# Screenshot-based UI review during development

Use Fliwright to reach the real app state and capture it. The agent compares
the image with the supplied Figma reference and decides which differences need
app changes. Repeat this after visual fixes so the final evidence reflects the
latest code.

## Capture and compare

1. Identify the actual Figma frame and its intended state through the available
   Figma tools or supplied design export. Do not substitute a nearby frame or
   invent measurements when design context is unavailable.
2. Prepare matching app content using the project's named scenario where useful.
   Match viewport, theme, locale and text scale; wait for the relevant content
   and layout to settle. Dismiss the keyboard unless it belongs in the design.
3. Capture the current viewport with the project's installed CLI:

   ```sh
   pnpm exec fliwright app screenshot --pixel-ratio 1 --json
   ```

   Use `--session "$SESSION_ID"` for an existing connection session. The command
   resolves the app endpoint from project configuration/environment otherwise;
   see [screenshot](commands/command-app.screenshot.md) for explicit connection
   and long-image options. The default destination is unique, preserving earlier
   captures. Open the returned `data.path` with the agent's image tool.
4. Inspect the runtime and design images. Check alignment, spacing, hierarchy,
   typography and wrapping, colors, icons/images, radii, clipping and fixed
   controls. Use Figma properties to substantiate exact values; describe a
   visual estimate as an estimate. Widget snapshots help locate implementation
   targets but do not establish visual fidelity.
5. Fix unintended differences, synchronize the running app, restore the same
   state and capture it again. Recheck affected states such as an open sheet or
   error message when the change touches them. Report the Figma reference,
   final screenshot paths, remaining differences and any unverified states.

A screenshot comparison helps catch UI drift; one screen at one viewport does
not establish correctness across devices or interactive states. If the app or
design is unavailable, state that visual verification is pending.

## Optional automated evidence

Use `flow review-*` when durable mappings between several app states and Figma
frames, saved capture manifests or CI pixel checks are useful. A Flow and Figma
REST credentials are not prerequisites for the direct agent workflow above.

Pixel differences are sensitive to fonts, antialiasing, dynamic content and
image scale. A passing ratio does not certify typography, tokens or component
mapping. The built-in `layoutPx` metric measures image dimension differences,
not individual component positions. Keep visual findings explicit; pixel
comparison and external analysis supplement each other.
