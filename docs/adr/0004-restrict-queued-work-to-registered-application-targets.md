# Restrict queued work to registered application targets

Each queued E2E execution references a pre-registered ApplicationTarget at an immutable Git commit SHA, build profile, platform, and simulator configuration. Workers do not accept uploaded source bundles or arbitrary shell commands. This makes test results reproducible and prevents the team queue from becoming an arbitrary-code execution surface.
