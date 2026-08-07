# Use screenshots as evidence only

Fliwright does not use screenshots or pixel comparison to determine whether a test passes. Test assertions remain the sole verdict mechanism; ScreenshotCheckpoints capture the UI state after success or failure as RunBundle evidence. This avoids platform-rendering noise and keeps pass/fail semantics in the assertion library.
