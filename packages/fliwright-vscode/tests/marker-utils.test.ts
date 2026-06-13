import { describe, it, expect } from 'vitest';
import type { RecordingFrame } from '@fliwright/core';
import {
  kindColor,
  formatDuration,
  swipeDirection,
  swipeDistance,
  markerPercent,
  markerEndPercent,
  coordLabel,
  badgeLabel,
} from '../src/webview/recording-canvas/marker-utils.js';

function frame(over: Partial<RecordingFrame> = {}): RecordingFrame {
  return {
    id: 'f', index: 0, kind: 'tap', status: 'ready', timestamp: 0,
    position: { x: 0, y: 0 }, ...over,
  } as RecordingFrame;
}

describe('marker-utils', () => {
  it('maps each kind to its color', () => {
    expect(kindColor('tap')).toBe('#4b8f78');
    expect(kindColor('longPress')).toBe('#e0a458');
    expect(kindColor('drag')).toBe('#58a6ff');
    expect(kindColor('type')).toBe('#a371f7');
    expect(kindColor('pending')).toBe('#8a8f98');
  });

  it('formats duration from microseconds', () => {
    expect(formatDuration(1_200_000)).toBe('1.2s');
    expect(formatDuration(500_000)).toBe('500ms');
    expect(formatDuration(undefined)).toBe('');
  });

  it('derives swipe direction from delta', () => {
    expect(swipeDirection({ x: 0, y: 180 })).toBe('↓');
    expect(swipeDirection({ x: 0, y: -90 })).toBe('↑');
    expect(swipeDirection({ x: 120, y: 0 })).toBe('→');
    expect(swipeDirection({ x: -5, y: 0 })).toBe('←');
    expect(swipeDirection(undefined)).toBe('');
  });

  it('computes rounded swipe distance', () => {
    expect(swipeDistance({ x: 100, y: 100 })).toBe(141);
    expect(swipeDistance(undefined)).toBe(0);
  });

  it('centers synthetic frames regardless of position', () => {
    const f = frame({ synthetic: true, position: { x: 10, y: 10 }, screenshot: { base64: '', format: 'png', width: 320, height: 640 } });
    expect(markerPercent(f)).toEqual({ x: 50, y: 50 });
  });

  it('places non-synthetic frames by coordinate', () => {
    const f = frame({ position: { x: 160, y: 320 }, screenshot: { base64: '', format: 'png', width: 320, height: 640 } });
    expect(markerPercent(f)).toEqual({ x: 50, y: 50 });
  });

  it('computes drag arrow end from delta as percentages', () => {
    const f = frame({
      kind: 'drag',
      position: { x: 0, y: 0 },
      delta: { x: 320, y: 0 },
      screenshot: { base64: '', format: 'png', width: 320, height: 640 },
    });
    expect(markerEndPercent(f)).toEqual({ x: 100, y: 0 });
  });

  it('returns null end for non-drag frames', () => {
    expect(markerEndPercent(frame({ kind: 'tap' }))).toBeNull();
  });

  it('hides coord label for synthetic frames', () => {
    expect(coordLabel(frame({ synthetic: true, position: { x: 5, y: 6 } }))).toBe('');
    expect(coordLabel(frame({ position: { x: 5.7, y: 6.2 } }))).toBe('6, 6');
  });

  it('builds kind badges', () => {
    expect(badgeLabel(frame({ kind: 'longPress', duration: 800_000 }))).toBe('⏱ 800ms');
    expect(badgeLabel(frame({ kind: 'drag', delta: { x: 0, y: 180 } }))).toBe('↓ 180px');
    expect(badgeLabel(frame({ kind: 'type', text: 'leo@mail.com' }))).toBe('⌨ "leo@mail.com"');
    expect(badgeLabel(frame({ kind: 'type', text: 'x', action: 'replace' }))).toBe('⌨ "x" ↻');
    expect(badgeLabel(frame({ kind: 'tap' }))).toBe('');
  });
});
