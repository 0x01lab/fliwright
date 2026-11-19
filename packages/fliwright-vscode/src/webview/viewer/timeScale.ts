/** Screen-only mapping; the recorded time domain is owned by core. */
export function createTimeScale(duration: number) {
  const domain = duration || 1;
  const scale = (time: number) => Math.max(0, Math.min(100, time / domain * 100));
  scale.invert = (percent: number) => Math.max(0, Math.min(domain, percent / 100 * domain));
  scale.ticks = duration ? Array.from({ length: 5 }, (_, i) => duration * i / 4) : [0];
  return scale;
}

export function durationLabel(value?: number): string {
  return value === undefined ? '—' : value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}
