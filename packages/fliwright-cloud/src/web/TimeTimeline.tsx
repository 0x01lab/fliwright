import { Button } from './components/ui/button.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui.js';
import {
  buildTimeAxis,
  createTimeScale,
  durationLabel,
  durationMs,
  stepAtTime,
  type ReplayNode,
} from './replay-model.js';

const statuses: Record<string, string> = {
  passed: '通过',
  failed: '失败',
  interrupted: '中断',
  running: '运行中',
  skipped: '跳过',
};
const elapsed = (value: number) =>
  value === 0
    ? '0'
    : value < 1000
      ? `${Math.round(value)}ms`
      : `${Number((value / 1000).toFixed(2))}s`;
const frameWidth = 112;
const frameHeight = 160;

/** Recorded-time playback uses animation frames for a linear playhead at the selected speed. */
export function TimeTimeline({
  nodes,
  bounds,
  selectedId,
  onSelect,
  screenshots,
  selectedScreenshotIndex = 0,
  controls,
  playback,
}: {
  nodes: ReplayNode[];
  bounds: { startedAt?: unknown; endedAt?: unknown };
  selectedId?: string;
  onSelect: (id: string, screenshotIndex?: number) => void;
  screenshots?: (node: ReplayNode) => string[];
  selectedScreenshotIndex?: number;
  controls?: React.ReactNode;
  playback?: {
    playing: boolean;
    speed: number;
    onSelect: (id: string) => void;
    onPause: () => void;
    onEnd: () => void;
  };
}) {
  const axis = useMemo(() => buildTimeAxis(nodes, bounds), [nodes, bounds]);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ time: number }>();
  const [cursor, setCursor] = useState<{ id: string; time: number }>();
  const viewport = useRef<HTMLDivElement>(null);
  const selectedBar = useRef<HTMLButtonElement>(null);
  const selectedFrame = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offset: number }>();
  const [dragging, setDragging] = useState(false);
  const [surfaceWidth, setSurfaceWidth] = useState(600);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const update = () => setSurfaceWidth(element.getBoundingClientRect().width || 600);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [axis.entries.length > 0]);
  const selected = axis.entries.find((entry) => entry.node.id === selectedId);
  const cursorTime =
    cursor?.id === selectedId ? cursor?.time : selected?.startMs;
  // Keep per-frame updates inside the timeline. The preview only needs to
  // render again when playback reaches a different operation.
  const playbackState = useRef({ axis, playback, time: cursorTime ?? 0, selectedId });
  playbackState.current = { axis, playback, time: cursorTime ?? 0, selectedId };
  const playing = playback?.playing ?? false;
  const speed = playback?.speed ?? 1;
  useEffect(() => {
    if (!playing) return;
    const duration = playbackState.current.axis.durationMs;
    if (!duration) {
      playbackState.current.playback?.onEnd();
      return;
    }
    const initialTime = playbackState.current.time >= duration ? 0 : playbackState.current.time;
    const startedAt = performance.now();
    let activeId = playbackState.current.selectedId;
    const update = (time: number) => {
      const state = playbackState.current;
      const node = stepAtTime(state.axis, time);
      if (!node) return;
      setCursor({ id: node.id, time });
      if (node.id !== activeId) {
        activeId = node.id;
        state.playback?.onSelect(node.id);
      }
    };
    update(initialTime);
    let frame: number;
    const advance = (timestamp: number) => {
      const time = Math.min(duration, initialTime + (timestamp - startedAt) * speed);
      update(time);
      if (time >= duration) playbackState.current.playback?.onEnd();
      else frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, axis.durationMs]);
  const timeScale = createTimeScale(axis.durationMs);
  const percent = (value: number) => `${timeScale(value)}%`;
  const intervalWidth = (start: number, end: number) =>
    `${timeScale(end) - timeScale(start)}%`;
  const pointerTime = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return axis.durationMs && rect.width > 0
      ? timeScale.invert(((clientX - rect.left) / rect.width) * 100)
      : 0;
  };
  useEffect(() => {
    if (drag.current || playing) return;
    const bar = selectedFrame.current ?? selectedBar.current,
      container = viewport.current;
    if (!bar || !container) return;
    const box = bar.getBoundingClientRect(),
      view = container.getBoundingClientRect();
    if (box.left < view.left || box.right > view.right)
      container.scrollLeft += box.left - view.left - container.clientWidth / 3;
    if (box.top < view.top + 36 || box.bottom > view.bottom)
      container.scrollTop += box.top - view.top - container.clientHeight / 2;
  }, [selectedId, selectedScreenshotIndex, zoom, surfaceWidth, playing]);
  useEffect(() => {
    if (!playing || !surface.current || !viewport.current) return;
    const container = viewport.current;
    const view = container.getBoundingClientRect();
    const rect = surface.current.getBoundingClientRect();
    const x = rect.left + timeScale(cursorTime ?? 0) / 100 * rect.width;
    if (x > view.right - 12) container.scrollLeft += x - view.right + 12;
    else if (x < view.left + 12) container.scrollLeft += x - view.left - 12;
  }, [playing, cursorTime, zoom, surfaceWidth]);
  const seek = (time: number) => {
    time = Math.max(0, Math.min(axis.durationMs, Math.round(time)));
    const node = stepAtTime(axis, time);
    if (node) {
      setCursor({ id: node.id, time });
      onSelect(node.id);
    }
  };
  const actionsHeight = Math.max(1, axis.lanes) * 12 + 8;
  // Keep each image anchored to its step's completion time. Pack nearby images
  // into separate rows without distorting the shared time scale.
  const { frames, frameLaneCount } = useMemo(() => {
    const frameLaneEnds: number[] = [];
    const frames = axis.entries.flatMap((entry) =>
      (screenshots?.(entry.node) ?? []).map((url, imageIndex) => ({
        entry, url, imageIndex, time: entry.endMs,
      })),
    ).sort((a, b) => a.time - b.time).map((frame) => {
      const x = timeScale(frame.time) / 100 * surfaceWidth;
      const left = Math.max(0, Math.min(x - frameWidth / 2, surfaceWidth - frameWidth));
      let lane = frameLaneEnds.findIndex((end) => end + 8 <= left);
      if (lane < 0) lane = frameLaneEnds.length;
      frameLaneEnds[lane] = left + frameWidth;
      return { ...frame, left, lane };
    });
    return { frames, frameLaneCount: frameLaneEnds.length };
  }, [axis, screenshots, surfaceWidth]);
  const frameLaneHeight = frameHeight + 8;
  const height = actionsHeight + (frames.length ? frameLaneCount * frameLaneHeight + 8 : 0);
  return (
    <section className="min-w-0 border-b border-border bg-card" aria-label="执行时间轴" data-ui="trace-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 max-sm:px-2.5" data-ui="trace-heading">
        <div className="flex items-center gap-2 text-xs [&>svg]:size-3.5 [&>svg]:text-muted-foreground [&>span]:text-[11px] [&>span]:text-muted-foreground" data-ui="trace-title">
          <Icon name="clock" />
          <b>执行时间轴</b>
          <span>
            {durationLabel(axis.durationMs)}
            <span className="mx-2 text-border" data-ui="trace-separator">/</span>
            {axis.entries.length} 个操作
          </span>
        </div>
        <div className="flex items-center gap-2 max-sm:ml-auto" data-ui="trace-tools">
          <span className="mr-3 flex items-center gap-2 text-[10px] text-muted-foreground max-sm:hidden [&_i]:size-2 [&_i]:rounded-sm" data-ui="trace-legend">
            <i className="bg-pass" />
            通过
            <i className="bg-destructive" data-ui="failed" />
            失败
          </span>
          <Button
            variant="secondary"
            size="icon"
            className="size-8"
            aria-label="缩小时间轴"
            disabled={zoom === 1}
            onClick={() => setZoom((z) => z / 2)}
          >
            −
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="w-8.5 font-mono text-[10px]"
            aria-label="重置时间轴缩放"
            onClick={() => setZoom(1)} data-ui="trace-zoom"
          >
            {zoom}×
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="size-8"
            aria-label="放大时间轴"
            disabled={zoom === 8}
            onClick={() => setZoom((z) => z * 2)}
          >
            +
          </Button>
        </div>
      </div>
      {axis.entries.length ? (
        <>
          <div className="max-h-60 overflow-auto overscroll-contain px-3 [scrollbar-width:thin] max-sm:px-2.5" ref={viewport} data-ui="trace-viewport">
            <div
              className="relative"
              ref={surface}
              style={{ width: `${zoom * 100}%`, minWidth: 600 }} data-ui="trace-surface"
            >
              <div className="sticky top-0 z-10 h-9 border-b border-border bg-card" data-ui="trace-ruler">
                <div className="pointer-events-none absolute inset-0 overflow-hidden [&>span]:absolute [&>span]:h-full [&>span]:border-l [&>span]:border-border [&>span]:px-1 [&>span]:pt-1 [&>span]:font-mono [&>span]:text-[10px] [&>span]:whitespace-nowrap [&>span]:text-muted-foreground" aria-hidden="true" data-ui="trace-ruler-ticks">
                  {axis.ticks.map((t) => (
                    <span key={t} style={{ left: percent(t) }}>
                      {elapsed(t)}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  role="slider"
                  className={`absolute bottom-0 z-10 size-6 -translate-x-1/2 cursor-ew-resize touch-none border-0 bg-transparent p-0 select-none before:absolute before:inset-x-1 before:top-1 before:bottom-0 before:rounded-sm before:bg-primary before:[clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)] after:absolute after:top-2 after:left-2.5 after:h-2 after:w-1 after:border-x after:border-primary-foreground after:opacity-80 hover:before:brightness-110 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-1 disabled:cursor-default disabled:opacity-50 ${dragging ? "before:brightness-110" : ''}`}
                  style={{ left: percent(cursorTime ?? 0) }}
                  aria-label="定位执行时间"
                  aria-orientation="horizontal"
                  aria-valuemin={0}
                  aria-valuemax={axis.durationMs}
                  aria-valuenow={cursorTime ?? 0}
                  aria-valuetext={`${elapsed(cursorTime ?? 0)}，${selected?.node.title ?? '选择操作'}`}
                  disabled={!axis.durationMs}
                  title="拖动手柄调整当前时间；方向键微调，Home / End 跳到起止时间"
                  onPointerDown={(e) => {
                    if (e.button !== 0 || !surface.current) return;
                    playback?.onPause();
                    const rect = surface.current.getBoundingClientRect();
                    drag.current = {
                      pointerId: e.pointerId,
                      offset: e.clientX - rect.left - timeScale(cursorTime ?? 0) / 100 * rect.width,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDragging(true);
                    setHover(undefined);
                  }}
                  onPointerMove={(e) => {
                    if (drag.current?.pointerId !== e.pointerId || !surface.current) return;
                    seek(pointerTime(e.clientX - drag.current.offset, surface.current));
                  }}
                  onPointerUp={(e) => {
                    if (drag.current?.pointerId !== e.pointerId) return;
                    if (surface.current)
                      seek(pointerTime(e.clientX - drag.current.offset, surface.current));
                    drag.current = undefined;
                    setDragging(false);
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                  onPointerCancel={() => {
                    drag.current = undefined;
                    setDragging(false);
                  }}
                  onLostPointerCapture={() => {
                    drag.current = undefined;
                    setDragging(false);
                  }}
                  onKeyDown={(e) => {
                    const step = Math.max(1, Math.round(axis.durationMs / 100));
                    const time = cursorTime ?? 0;
                    const target = {
                      ArrowLeft: time - step,
                      ArrowDown: time - step,
                      ArrowRight: time + step,
                      ArrowUp: time + step,
                      PageDown: time - step * 10,
                      PageUp: time + step * 10,
                      Home: 0,
                      End: axis.durationMs,
                    }[e.key];
                    if (target === undefined) return;
                    e.preventDefault();
                    e.stopPropagation();
                    seek(target);
                  }} data-ui={`trace-playhead ${dragging ? 'dragging' : ''}`}
                />
              </div>
              <div
                className="relative cursor-crosshair"
                style={{ height }}
                onPointerMove={(e) => {
                  const time = pointerTime(e.clientX, e.currentTarget);
                  setHover({ time });
                }}
                onPointerLeave={() => setHover(undefined)}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  seek(pointerTime(e.clientX, e.currentTarget));
                }} data-ui="trace-tracks"
              >
                {axis.ticks.map((t) => (
                  <span
                    key={t}
                    className="pointer-events-none absolute inset-y-0 border-l border-dashed border-border"
                    style={{ left: percent(t) }} data-ui="trace-gridline"
                  />
                ))}
                {selected && (
                  <span
                    className="pointer-events-none absolute inset-y-0 bg-accent opacity-55"
                    style={{
                      left: percent(selected.startMs),
                      width: intervalWidth(selected.startMs, selected.endMs),
                    }} data-ui="trace-selection"
                  />
                )}
                {axis.entries.map((entry) => {
                  const n = entry.node,
                    active = n.id === selectedId;
                  const point = entry.endMs === entry.startMs;
                  return (
                    <Button
                      variant="ghost"
                      key={n.id}
                      ref={active ? selectedBar : undefined}
                      className={`absolute z-10 block h-3 min-h-0 min-w-0 rounded-none border-0 bg-transparent p-0 after:absolute after:inset-x-0 after:top-1 after:h-0.5 after:rounded-full after:bg-pass after:opacity-65 hover:z-20 hover:bg-accent hover:after:opacity-100 data-[selected=true]:z-20 data-[selected=true]:bg-accent data-[selected=true]:after:opacity-100 data-[status=failed]:after:bg-destructive data-[status=running]:after:bg-muted-foreground data-[status=interrupted]:after:bg-warn data-[status=skipped]:after:bg-muted-foreground ${point ? "-translate-x-1/2" : ''} ${active ? "bg-accent" : ''} ${entry.complete ? '' : "after:opacity-40"}`}
                      style={{
                        left: percent(entry.startMs),
                        width: point
                          ? 8
                          : intervalWidth(entry.startMs, entry.endMs),
                        top: entry.lane * 12,
                      }}
                      data-step-id={n.id}
                      data-status={n.status}
                      data-selected={active}
                      aria-pressed={active}
                      aria-label={`时间轴：${n.title}，${statuses[n.status] ?? n.status}，${durationLabel(durationMs(n))}`}
                      title={`${n.title}\n${elapsed(entry.startMs)} → ${entry.complete ? elapsed(entry.endMs) : '结束时间未采集'} · ${durationLabel(durationMs(n))}`}
                      onClick={() => {
                        setCursor(undefined);
                        onSelect(n.id);
                      }} data-ui={`trace-action ${point ? 'point' : ''} ${active ? 'selected' : ''} ${entry.complete ? '' : 'incomplete'}`}
                    />
                  );
                })}
                {frames.map(({ entry, url, imageIndex, time, left, lane }) => (
                  <React.Fragment key={`${entry.node.id}-${imageIndex}`}>
                    <span
                      className="pointer-events-none absolute w-px bg-border"
                      style={{ left: percent(time), top: actionsHeight, height: lane * frameLaneHeight + 6 }}
                      aria-hidden="true" data-ui="trace-frame-marker"
                    />
                    <Button
                      variant="ghost"
                      ref={entry.node.id === selectedId && imageIndex === selectedScreenshotIndex ? selectedFrame : undefined}
                      className={`absolute z-10 grid h-40 min-h-0 w-28 overflow-hidden rounded-sm bg-muted p-0 shadow-sm hover:bg-accent [&_img]:block [&_img]:h-full [&_img]:min-h-0 [&_img]:w-full [&_img]:object-contain ${entry.node.id === selectedId && imageIndex === selectedScreenshotIndex ? "bg-accent" : ''}`}
                      style={{ left, top: actionsHeight + lane * frameLaneHeight + 6 }}
                      data-step-id={entry.node.id}
                      data-time-ms={time}
                      aria-label={`截图：${entry.node.title}，${elapsed(time)}，第 ${imageIndex + 1} 张`}
                      aria-pressed={entry.node.id === selectedId && imageIndex === selectedScreenshotIndex}
                      title={`${entry.node.title} · ${elapsed(time)}（${entry.complete ? '步骤结束' : '步骤开始'}）`}
                      onClick={() => {
                        setCursor({ id: entry.node.id, time });
                        onSelect(entry.node.id, imageIndex);
                      }} data-ui={`trace-frame ${entry.node.id === selectedId && imageIndex === selectedScreenshotIndex ? 'selected' : ''}`}
                    >
                      <TimelineScreenshot key={url} url={url} title={entry.node.title} />
                    </Button>
                  </React.Fragment>
                ))}
                <span
                  className="pointer-events-none absolute inset-y-0 z-20 w-px bg-primary"
                  style={{ left: percent(cursorTime ?? 0) }} data-ui="trace-cursor"
                />
                {hover && (
                  <span
                    className="pointer-events-none absolute inset-y-0 z-20 w-px bg-muted-foreground opacity-55"
                    style={{ left: percent(hover.time) }} data-ui="trace-hover-line"
                  />
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs px-2.5 py-4 text-xs" data-ui="empty compact">
          此尝试未采集有效时间，可在步骤列表中查看已有证据。
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2" data-ui="trace-controls">
        {controls}
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums [&_b]:font-medium [&_b]:text-foreground" aria-label="当前时间 / 总时长" data-ui="trace-current-time">
          <b>{elapsed(cursorTime ?? 0)}</b>
          <span>/</span>
          {elapsed(axis.durationMs)}
        </span>
      </div>
    </section>
  );
}

function TimelineScreenshot({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="grid h-full content-center justify-items-center text-[9px] whitespace-normal text-muted-foreground" data-ui="trace-frame-missing"><Icon name="camera" />截图不可用</span>
  ) : (
    <img src={url} alt={`${title} · 时间轴截图`} loading="lazy" draggable={false} onError={() => setFailed(true)} />
  );
}
