import type { RunSession } from './RunSession.js';

// The Vitest runner and fixture factories execute in the same worker process,
// but their lifecycle hooks are owned by different modules. This small
// process-local registry is the handoff point for the active attempt; it is
// never persisted and must not be used as a cross-worker lock.
const activeSessions = new Map<string, RunSession>();

export function registerRunSession(testId: string, session: RunSession): void {
  activeSessions.set(testId, session);
}

export function getRunSession(testId: string): RunSession | undefined {
  return activeSessions.get(testId);
}

export function unregisterRunSession(testId: string, session?: RunSession): void {
  if (session && activeSessions.get(testId) !== session) return;
  activeSessions.delete(testId);
}

export function clearRunSessionRegistry(): void {
  activeSessions.clear();
}
