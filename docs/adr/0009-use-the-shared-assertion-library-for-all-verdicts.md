# Use the shared assertion library for all verdicts

Local development assistance, MCP, workers, and the cloud queue use the same Fliwright assertion library as their only verdict mechanism. The Planner may generate only SupportedAssertions; a requirement that cannot be expressed by one enters NeedsInput rather than being inferred by a model or screenshot. This keeps results consistent across execution environments and makes every pass/fail outcome auditable.
