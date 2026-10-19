import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.js';
import {
  buildTimeAxis,
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

/** A trace overview backed by recorded timestamps, shared by team and share views. */
export function TimeTimeline({
  nodes,
  bounds,
  selectedId,
  onSelect,
}: {
  nodes: ReplayNode[];
  bounds: { startedAt?: unknown; endedAt?: unknown };
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const axis = buildTimeAxis(nodes, bounds);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ id?: string; time: number }>();
  const [cursor, setCursor] = useState<{ id: string; time: number }>();
  const viewport = useRef<HTMLDivElement>(null);
  const selectedBar = useRef<HTMLButtonElement>(null);
  const selected = axis.entries.find((entry) => entry.node.id === selectedId);
  const cursorTime =
    cursor?.id === selectedId ? cursor?.time : selected?.startMs;
  const span = axis.durationMs || 1;
  const percent = (value: number) => `${(value / span) * 100}%`;
  useEffect(() => {
    const bar = selectedBar.current,
      container = viewport.current;
    if (!bar || !container) return;
    const box = bar.getBoundingClientRect(),
      view = container.getBoundingClientRect();
    if (box.left < view.left || box.right > view.right)
      container.scrollLeft += box.left - view.left - container.clientWidth / 3;
    if (box.top < view.top + 28 || box.bottom > view.bottom)
      container.scrollTop += box.top - view.top - container.clientHeight / 2;
  }, [selectedId, zoom]);
  const seek = (time: number) => {
    const node = stepAtTime(axis, time);
    if (node) {
      setCursor({ id: node.id, time });
      onSelect(node.id);
    }
  };
  const hoverEntry = axis.entries.find((e) => e.node.id === hover?.id);
  const height = Math.max(2, axis.lanes) * 28 + 12;
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
          <button
            className="btn btn-icon btn-sm"
            aria-label="缩小时间轴"
            disabled={zoom === 1}
            onClick={() => setZoom((z) => z / 2)}
          >
            −
          </button>
          <button
            className="btn btn-sm trace-zoom"
            aria-label="重置时间轴缩放"
            onClick={() => setZoom(1)}
          >
            {zoom}×
          </button>
          <button
            className="btn btn-icon btn-sm"
            aria-label="放大时间轴"
            disabled={zoom === 8}
            onClick={() => setZoom((z) => z * 2)}
          >
            +
          </button>
        </div>
      </div>
      {axis.entries.length ? (
        <>
          <div className="trace-viewport" ref={viewport}>
            <div
              className="trace-surface"
              style={{ width: `${zoom * 100}%`, minWidth: 600 }}
            >
              <div className="trace-ruler" aria-hidden="true">
                {axis.ticks.map((t) => (
                  <span key={t} style={{ left: percent(t) }}>
                    {elapsed(t)}
                  </span>
                ))}
              </div>
              <div
                className="trace-tracks"
                style={{ height }}
                onPointerMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const time = Math.max(
                    0,
                    Math.min(
                      axis.durationMs,
                      ((e.clientX - rect.left) / rect.width) * axis.durationMs,
                    ),
                  );
                  const target = (e.target as HTMLElement).closest<HTMLElement>(
                    '[data-step-id]',
                  );
                  setHover({ time, id: target?.dataset.stepId });
                }}
                onPointerLeave={() => setHover(undefined)}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  seek(
                    Math.max(
                      0,
                      Math.min(
                        axis.durationMs,
                        ((e.clientX - rect.left) / rect.width) *
                          axis.durationMs,
                      ),
                    ),
                  );
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
                      width: percent(selected.endMs - selected.startMs),
                    }}
                  />
                )}
                {axis.entries.map((entry) => {
                  const n = entry.node,
                    active = n.id === selectedId;
                  const point = entry.endMs === entry.startMs;
                  return (
                    <button
                      key={n.id}
                      ref={active ? selectedBar : undefined}
                      className={`trace-action ${n.status} ${point ? 'point' : ''} ${active ? 'selected' : ''} ${entry.complete ? '' : 'incomplete'}`}
                      style={{
                        left: percent(entry.startMs),
                        width: point ? 8 : percent(entry.endMs - entry.startMs),
                        top: entry.lane * 28 + 6,
                      }}
                      data-step-id={n.id}
                      aria-pressed={active}
                      aria-label={`时间轴：${n.title}，${statuses[n.status] ?? n.status}，${durationLabel(durationMs(n))}`}
                      title={`${n.title}\n${elapsed(entry.startMs)} → ${entry.complete ? elapsed(entry.endMs) : '结束时间未采集'} · ${durationLabel(durationMs(n))}`}
                      onClick={() => {
                        setCursor(undefined);
                        onSelect(n.id);
                      }}
                    >
                      {!point && (
                        <>
                          <Icon
                            name={
                              n.status === 'failed'
                                ? 'x'
                                : n.kind === 'assertion'
                                  ? 'check'
                                  : n.kind === 'frame'
                                    ? 'camera'
                                    : 'chevron'
                            }
                          />
                          <span>{n.title}</span>
                          <small>{durationLabel(durationMs(n))}</small>
                        </>
                      )}
                    </button>
                  );
                })}
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
          <div className="trace-seek">
            <span>{elapsed(cursorTime ?? 0)}</span>
            <input
              type="range"
              min={0}
              max={axis.durationMs || 1}
              step={1}
              value={cursorTime ?? 0}
              disabled={!axis.durationMs}
              aria-label="定位执行时间"
              aria-valuetext={`${elapsed(cursorTime ?? 0)}，${selected?.node.title ?? '选择操作'}`}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <span>{elapsed(axis.durationMs)}</span>
          </div>
          <div className="trace-caption" aria-live="polite">
            {hoverEntry ? (
              <>
                <b>{hoverEntry.node.title}</b>
                <span>
                  {elapsed(hoverEntry.startMs)} —{' '}
                  {hoverEntry.complete
                    ? elapsed(hoverEntry.endMs)
                    : '结束未采集'}{' '}
                  · {statuses[hoverEntry.node.status]}
                </span>
              </>
            ) : (
              <>
                <span>点击操作查看截图与详情，拖动时间游标定位</span>
                <span>
                  {axis.missing.length
                    ? `${axis.missing.length} 个操作未采集时间，可在步骤列表查看`
                    : '横向位置为开始时间，条宽为实际耗时'}
                </span>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="empty compact">
          此尝试未采集有效时间，可在步骤列表中查看已有证据。
        </div>
      )}
    </section>
  );
}
