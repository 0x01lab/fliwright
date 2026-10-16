# @fliwright/core

The reusable TypeScript runtime behind Fliwright's Playwright-style white-box
automation for Flutter. Most users should install `@fliwright/cli` and
`@fliwright/vitest` instead of constructing the core runtime directly.

Fliwright controls a trusted debug or test build through `fliwright_bridge` and
the Dart VM Service. It is not intended to control production builds.

See the repository [Quick Start](https://github.com/0x01lab/fliwright#quick-start)
and generated feature documentation for the current public interface.
