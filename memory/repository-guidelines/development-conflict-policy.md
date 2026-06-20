# Development Conflict Policy

During active development, prefer converging the codebase on the intended
behavior instead of preserving conflicting behavior.

If new work reveals old logic, generated scripts, docs, or tests that conflict
with the current design, update the conflicting pieces directly. Do not add
compatibility shims, fallback branches, duplicate code paths, or "try old API,
then new API" logic unless the user explicitly asks for backward compatibility.

When removing the old path, keep the change complete: update callers, tests,
docs, generated examples, and built artifacts as needed so the repository has
one clear source of truth.
