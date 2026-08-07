# Allow read-only runtime observation during planning

When static source and an IssueSnapshot do not provide enough app context, the managed Planner may use a bounded PlanningObservation on a Worker. It may read runtime snapshots, visible semantics, route state, and diagnostics, but may not interact, navigate, type, or cause side effects. A WorkerReset separates observation from an ExecutionAttempt. This improves prompt-to-plan accuracy without weakening the fail-closed execution policy.
