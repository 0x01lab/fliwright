# Author project Support Settings

Use Support Settings for ordinary parameters that a developer should be able to set once in **Fliwright > Support Settings** and reuse across CLI, Vitest, and Node runs. Keep reproducible app setup in named `TestScenario` declarations. Read the target project's `fliwright.config.ts`, existing `.fliwright/support/` modules, and parameter call sites before extending them. Confirm the target project's installed Core, CLI, and VS Code extension support the feature.

## Define, register, and consume

Export the declaration from a module that can be imported during project discovery. Keep device connections and local value reads inside the support operation. Reuse the same declaration in the project registry and the consumer.

```ts
// .fliwright/support/preview-settings.ts
import { defineSupportSettings } from '@fliwright/core';

export const previewSettings = defineSupportSettings({
  id: 'preview',
  title: 'Preview',
  fields: {
    route: { type: 'string', label: 'Preview route', default: '/preview', minLength: 1, env: 'APP_PREVIEW_ROUTE' },
    timeoutMs: { type: 'number', label: 'Settle timeout (ms)', default: 3000, min: 0, integer: true },
    waitForIdle: { type: 'boolean', label: 'Wait for idle', default: true },
    layout: {
      type: 'select',
      label: 'Layout',
      default: 'compact',
      options: [{ value: 'compact', label: 'Compact' }, { value: 'expanded', label: 'Expanded' }],
    },
  },
});
```

```ts
// fliwright.config.ts
import { defineConfig } from '@fliwright/cli';
import { previewSettings } from './.fliwright/support/preview-settings.js';

export default defineConfig({ supportSettings: [previewSettings] });
```

Add the declaration to the existing `supportSettings` list and preserve the project's other config. Use stable support IDs, field keys, and select values because they identify saved values. Labels and descriptions can change independently of those identifiers.

```ts
// .fliwright/support/preview.ts
import { readSupportSettings, type Page } from '@fliwright/core';
import { previewSettings } from './preview-settings.js';

export async function openPreview(page: Page, timeoutMs?: number) {
  const settings = await readSupportSettings(previewSettings, {
    overrides: timeoutMs === undefined ? {} : { timeoutMs },
  });
  await page.navigate(settings.route);
  if (settings.waitForIdle) await page.settle({ timeout: settings.timeoutMs });
  return settings.layout; // typed as 'compact' | 'expanded' for the caller
}
```

Use `description`, `required`, `default`, and `env` as needed. Text is single-line with optional `minLength` and `maxLength`. Numbers are finite with optional `min`, `max`, and `integer`. Booleans render as checkboxes. Selects use unique string `value`s paired with labels. Use `minLength: 1` if an empty string is invalid. Use `required: true` without a default when the caller must supply a value. An optional field with no source or default resolves to `undefined`.

## Verify the value path

1. In a trusted VS Code workspace, open **Fliwright > Support Settings**, select the intended project and support, and verify the labels and controls. Save a distinctive non-secret value and reopen or refresh to check persistence. The panel can save a partial form.
2. Run the actual support entry point from the same project and verify an observable result reflects the saved value. Read once at operation start when a run needs a consistent snapshot. A missing required value fails when that support reads it, with the support ID and field in the error.
3. Verify existing per-run overrides still work. Each field resolves from explicit `overrides`, its declared environment variable, its saved value, then its default. Boolean environment values use `true` or `false`. An invalid value from a selected source reports a field error. Preserve `false`, `0`, and allowed empty strings. After **Reset** and **Save**, the field inherits from the remaining sources.

Saved values live on the execution host under `<runtimeRoot>/support-settings/<project-key>/<support-id>.json`. Use the same project and `FLIWRIGHT_RUNTIME_ROOT` across the editor and runner. The reader resolves the project from explicit `projectRoot`, `FLIWRIGHT_PROJECT_ROOT`, or the working directory in that order. In CI and deterministic tests, supply deliberate environments or `overrides` for behavior the test depends on. Keep credentials in environment variables outside the form and keep actual local values out of committed config, logs, and fixtures.

## Extend the VS Code control types

Project support modules register serializable field declarations that render with the installed controls. When a task explicitly calls for a new VS Code control type, make the extension in the Fliwright repository. Extend the field schema, inferred value type, and applicable value or environment validation in `packages/fliwright-core/src/SupportSettings.ts` together with control creation, display, and value conversion in `packages/fliwright-vscode/src/support/app.ts`. If the stored value shape changes, review the save-message parser in `SupportSettingsView.ts` and the persisted schema as well. Add regression coverage for editing, save/reload, reset, and reading the typed result through Core. Use `SupportSettings.test.ts` and `SupportSettingsView.test.ts` as the current examples.
