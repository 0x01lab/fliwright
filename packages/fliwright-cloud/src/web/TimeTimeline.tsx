import { Button } from './components/ui/button.js';
import React, { useEffect, useRef, useState } from 'react';
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

/** A trace overview backed by recorded timestamps, shared by team and share views. */
export function TimeTimeline({
  nodes,
  bounds,
  selectedId,
  onSelect,
  screenshots,
  selectedScreenshotIndex = 0,
  controls,
}: {
  nodes: ReplayNode[];
  bounds: { startedAt?: unknown; endedAt?: unknown };
  selectedId?: string;
  onSelect: (id: string, screenshotIndex?: number) => void;
  screenshots?: (node: ReplayNode) => string[];
  selectedScreenshotIndex?: number;
  controls?: React.ReactNode;
}) {
  const axis = buildTimeAxis(nodes, bounds);
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
    if (drag.current) return;
    const bar = selectedFrame.current ?? selectedBar.current,
      container = viewport.current;
    if (!bar || !container) return;
    const box = bar.getBoundingClientRect(),
      view = container.getBoundingClientRect();
    if (box.left < view.left || box.right > view.right)
      container.scrollLeft += box.left - view.left - container.clientWidth / 3;
    if (box.top < view.top + 36 || box.bottom > view.bottom)
      container.scrollTop += box.top - view.top - container.clientHeight / 2;
  }, [selectedId, selectedScreenshotIndex, zoom, surfaceWidth]);
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
  const frameLaneHeight = frameHeight + 8;
  const height = actionsHeight + (frames.length ? frameLaneEnds.length * frameLaneHeight + 8 : 0);
  return (
    <section className="trace-timeline" aria-label="执行时间轴">
      <div className="trace-heading">
        <div className="trace-title">
          <Icon name="clock" />
          <b>执行时间轴</b>
          <span>
            {durationLabel(axis.durationMs)}
            <span className="trace-separator">/</span>
            {axis.entries.length} 个操作
          </span>
        </div>
        <div className="trace-tools">
          <span className="trace-legend">
            <i />
            通过
            <i className="failed" />
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
            className="trace-zoom"
            aria-label="重置时间轴缩放"
            onClick={() => setZoom(1)}
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
          <div className="trace-viewport" ref={viewport}>
            <div
              className="trace-surface"
              ref={surface}
              style={{ width: `${zoom * 100}%`, minWidth: 600 }}
            >
              <div className="trace-ruler">
                <div className="trace-ruler-ticks" aria-hidden="true">
                  {axis.ticks.map((t) => (
                    <span key={t} style={{ left: percent(t) }}>
                      {elapsed(t)}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  role="slider"
                  className={`trace-playhead ${dragging ? 'dragging' : ''}`}
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
                  }}
                />
              </div>
              <div
                className="trace-tracks"
                style={{ height }}
                onPointerMove={(e) => {
                  const time = pointerTime(e.clientX, e.currentTarget);
                  setHover({ time });
                }}
                onPointerLeave={() => setHover(undefined)}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  seek(pointerTime(e.clientX, e.currentTarget));
                }}
              >
                {axis.ticks.map((t) => (
                  <span
                    key={t}
                    className="trace-gridline"
                    style={{ left: percent(t) }}
                  />
                ))}
                {selected && (
                  <span
                    className="trace-selection"
                    style={{
                      left: percent(selected.startMs),
                      width: intervalWidth(selected.startMs, selected.endMs),
                    }}
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
                      className={`trace-action block h-3 min-h-0 rounded-none border-0 p-0 ${n.status} ${point ? 'point' : ''} ${active ? 'selected' : ''} ${entry.complete ? '' : 'incomplete'}`}
                      style={{
                        left: percent(entry.startMs),
                        width: point
                          ? 8
                          : intervalWidth(entry.startMs, entry.endMs),
                        top: entry.lane * 12,
                      }}
                      data-step-id={n.id}
                      aria-pressed={active}
                      aria-label={`时间轴：${n.title}，${statuses[n.status] ?? n.status}，${durationLabel(durationMs(n))}`}
                      title={`${n.title}\n${elapsed(entry.startMs)} → ${entry.complete ? elapsed(entry.endMs) : '结束时间未采集'} · ${durationLabel(durationMs(n))}`}
                      onClick={() => {
                        setCursor(undefined);
                        onSelect(n.id);
                      }}
                    />
                  );
                })}
                {frames.map(({ entry, url, imageIndex, time, left, lane }) => (
                  <React.Fragment key={`${entry.node.id}-${imageIndex}`}>
                    <span
                      className="trace-frame-marker"
                      style={{ left: percent(time), top: actionsHeight, height: lane * frameLaneHeight + 6 }}
                      aria-hidden="true"
                    />
                    <Button
                      variant="ghost"
                      ref={entry.node.id === selectedId && imageIndex === selectedScreenshotIndex ? selectedFrame : undefined}
                      className={`trace-frame grid h-40 w-28 min-h-0 rounded-sm p-0 ${entry.node.id === selectedId && imageIndex === selectedScreenshotIndex ? 'selected' : ''}`}
                      style={{ left, top: actionsHeight + lane * frameLaneHeight + 6 }}
                      data-step-id={entry.node.id}
                      data-time-ms={time}
                      aria-label={`截图：${entry.node.title}，${elapsed(time)}，第 ${imageIndex + 1} 张`}
                      aria-pressed={entry.node.id === selectedId && imageIndex === selectedScreenshotIndex}
                      title={`${entry.node.title} · ${elapsed(time)}（${entry.complete ? '步骤结束' : '步骤开始'}）`}
                      onClick={() => {
                        setCursor({ id: entry.node.id, time });
                        onSelect(entry.node.id, imageIndex);
                      }}
                    >
                      <TimelineScreenshot key={url} url={url} title={entry.node.title} />
                    </Button>
                  </React.Fragment>
                ))}
                <span
                  className="trace-cursor"
                  style={{ left: percent(cursorTime ?? 0) }}
                />
                {hover && (
                  <span
                    className="trace-hover-line"
                    style={{ left: percent(hover.time) }}
                  />
                )}
              </div>
            </div>
          </div>

        </>
      ) : (
        <div className="empty compact">
          此尝试未采集有效时间，可在步骤列表中查看已有证据。
        </div>
      )}
      <div className="trace-controls">
        {controls}
        <span className="trace-current-time" aria-label="当前时间 / 总时长">
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
    <span className="trace-frame-missing"><Icon name="camera" />截图不可用</span>
  ) : (
    <img src={url} alt={`${title} · 时间轴截图`} loading="lazy" draggable={false} onError={() => setFailed(true)} />
  );
}
