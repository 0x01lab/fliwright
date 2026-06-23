# Flutter Daemon Field Probe — 2026-06-22

The reproducible probe lives at `packages/fliwright-tdd/spike/probe-daemon-fields.mjs`.

This implementation encodes the field names verified from Flutter daemon source and expected by
the design review:

- stdout messages are line-delimited JSON arrays.
- requests are `{ id, method, params }`.
- responses carry `{ id, result }` or `{ id, error }`.
- app debug port events use `event: "app.debugPort"` and params `{ appId, wsUri }`.
- app control uses `app.start`, `app.restart { appId, fullRestart }`, and `app.stop { appId }`.

Live device verification was not run in this workspace session because it requires a booted Flutter
device/emulator and a runnable app. Run the probe from a Flutter app root before P0.3 planning and
update this file if the local SDK reports different field names.
