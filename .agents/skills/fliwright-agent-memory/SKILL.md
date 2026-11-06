---
name: fliwright-agent-memory
description: Reuse and maintain project-local memory while exploring or operating a Flutter app through Fliwright. Read relevant prior UI paths before exploration and preserve verified, reusable findings after the task.
---

# Fliwright Agent Memory

Use this Skill together with `fliwright-cli-workflows` when an agent explores or operates an app and prior UI discoveries could help future tasks.

Read the memory rules and entry schema in [references/memory-format.md](references/memory-format.md) before accessing project memory. Memory belongs to the Flutter app project at `.fliwright/memory/`, not the Fliwright CLI repository or this Skill installation.

At task start, inspect the small index and load only relevant entries. Verify current app and UI state before acting on recalled knowledge. During long tasks, save a sanitized checkpoint when a reusable discovery is at risk of leaving context. Before the final response, review the commands and results from this task, save only useful new evidence, and re-read changed files to confirm them.

Do not create an entry just to log that a task happened. Distinguish observed facts from a checked task goal. Never preserve raw CLI output, full snapshots, snapshot refs, runtime IDs, credentials, VM URLs, or real user-entered values. Follow the format reference for evidence, sanitization, stale knowledge, and interrupted tasks.
