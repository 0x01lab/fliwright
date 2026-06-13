import type { RecordingFrame } from '@fliwright/core';

export type FrameKind = RecordingFrame['kind'];

export const KIND_COLORS: Record<FrameKind, string> = {
  tap: '#4b8f78',
  longPress: '#e0a458',
  drag: '#58a6ff',
  type: '#a371f7',
  pending: '#8a8f98',
};

export function kindColor(kind: FrameKind): string {
  return KIND_COLORS[kind] ?? KIND_COLORS.pending;
}

/** Formats a microsecond duration (Dart's inMicroseconds) as `800ms` / `1.2s`. */
export function formatDuration(durationMicros?: number): string {
  if (!durationMicros || durationMicros <= 0) return '';
  const ms = durationMicros / 1000;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Arrow glyph for the dominant axis of a drag delta. */
export function swipeDirection(delta?: { x: number; y: number }): string {
  if (!delta) return '';
  const absX = Math.abs(delta.x);
  const absY = Math.abs(delta.y);
  if (absX < 1 && absY < 1) return '';
  if (absY >= absX) return delta.y > 0 ? '↓' : '↑';
  return delta.x > 0 ? '→' : '←';
}

export function swipeDistance(delta?: { x: number; y: number }): number {
  if (!delta) return 0;
  return Math.round(Math.sqrt(delta.x ** 2 + delta.y ** 2));
}

/** Marker center as percentages within the screenshot. Synthetic frames center. */
export function markerPercent(frame: RecordingFrame): { x: number; y: number } {
  const width = frame.screenshot?.width;
  const height = frame.screenshot?.height;
  if (!width || !height || frame.synthetic) return { x: 50, y: 50 };
  return {
    x: clamp((frame.position.x / width) * 100, 0, 100),
    y: clamp((frame.position.y / height) * 100, 0, 100),
  };
}

/** Drag arrow end as percentages; null for non-drag or unsized frames. */
export function markerEndPercent(frame: RecordingFrame): { x: number; y: number } | null {
  if (frame.kind !== 'drag' || !frame.delta) return null;
  const width = frame.screenshot?.width;
  const height = frame.screenshot?.height;
  if (!width || !height) return null;
  const start = markerPercent(frame);
  return {
    x: clamp(start.x + (frame.delta.x / width) * 100, 0, 100),
    y: clamp(start.y + (frame.delta.y / height) * 100, 0, 100),
  };
}

export function coordLabel(frame: RecordingFrame): string {
  if (frame.synthetic) return '';
  return `${Math.round(frame.position.x)}, ${Math.round(frame.position.y)}`;
}

/** Inline badge text for longPress / drag / type; empty for tap/pending. */
export function badgeLabel(frame: RecordingFrame): string {
  switch (frame.kind) {
    case 'longPress': {
      const d = formatDuration(frame.duration);
      return d ? `⏱ ${d}` : '';
    }
    case 'drag': {
      const dist = swipeDistance(frame.delta);
      if (dist <= 0) return '';
      return `${swipeDirection(frame.delta)} ${dist}px`.trim();
    }
    case 'type': {
      if (!frame.text) return '';
      const replace = frame.action === 'replace' ? ' ↻' : '';
      return `⌨ "${frame.text}"${replace}`;
    }
    default:
      return '';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
