// packages/fliwright-vscode/src/webview/viewer/format.ts

export function formatStamp(ts?: string): string {
  return ts ? String(ts).replace('T', ' ').replace(/\..*/, '') : '';
}

export function formatClock(ts?: string): string {
  return ts && ts.length >= 19 ? ts.slice(11, 19) : (ts ?? '');
}

export function formatDuration(startedAt?: string, endedAt?: string, status?: string): string {
  if (!startedAt) return '';
  const start = Date.parse(startedAt);
  if (!start) return '';
  const end = endedAt ? Date.parse(endedAt) : NaN;
  if (!end) return status === 'running' ? '…' : '';
  const ms = end - start;
  if (!isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatScalar(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Tailwind text-color class for type-coloring a scalar value (Playwright-style). */
export function valueClass(v: unknown): string {
  if (v === null) return 'text-muted-foreground';
  if (typeof v === 'boolean') return 'text-value-number';
  if (typeof v === 'number') return 'text-value-number';
  if (typeof v === 'string') return 'text-value-string';
  return 'text-foreground';
}
