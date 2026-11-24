import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  useLocation,
  useSearch,
} from '@tanstack/react-router';
import { Clock3 } from 'lucide-react';
import {
  boardBatch,
  type BoardSnapshot,
  type TestColumn,
} from '../request-board.js';
import { TestBoard } from './TestBoard.js';
import { BoardResultFacts } from './WorkspaceHeader.js';
import { useData } from './data.js';
import { Button } from './components/ui/button.js';

type Depths = Partial<Record<TestColumn, number>>;
type BoardPosition = {
  depths: Depths;
  left: number;
  tops: Record<string, number>;
};
const positions = new Map<string, BoardPosition>();

function QueueLanes({
  search,
  targetId,
  locationKey,
}: {
  search: string;
  targetId: string;
  locationKey: string;
}) {
  const [position] = useState<BoardPosition>(
    () => positions.get(locationKey) ?? { depths: {}, left: 0, tops: {} },
  );
  const [depths, setDepths] = useState(position.depths);
  const params = new URLSearchParams({
    ...(search && { search }),
    ...(targetId && { targetId }),
  });
  for (const [lane, size] of Object.entries(depths))
    params.set(lane, String(size));
  const { data, error, reload } = useData<BoardSnapshot>(
    `/api/board?${params}`,
    3000,
  );
  const retained = useRef<BoardSnapshot>();
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const host = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const snapshot = data ?? retained.current;
  useLayoutEffect(() => {
    if (!data) return;
    retained.current = data;
    setUpdatedAt(new Date());
    if (restored.current || !host.current) return;
    const deck = host.current.querySelector<HTMLElement>(
      '[data-ui=test-board-scroll]',
    )!;
    deck.scrollLeft = position.left;
    host.current
      .querySelectorAll<HTMLElement>('[data-lane]')
      .forEach((list) => {
        list.scrollTop = position.tops[list.dataset.lane!] ?? 0;
      });
    restored.current = true;
  }, [data, position]);
  useEffect(() => {
    if (!data || !host.current || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver((entries) => {
      const additions: Depths = {};
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const lane = entry.target.parentElement!.dataset.lane as TestColumn;
        additions[lane] = Math.min(
          data.totals[lane],
          (depths[lane] ?? boardBatch) + boardBatch,
        );
        observer.unobserve(entry.target);
      }
      if (Object.keys(additions).length)
        setDepths((previous) => {
          position.depths = { ...previous, ...additions };
          positions.set(locationKey, position);
          return position.depths;
        });
    });
    host.current.querySelectorAll('[data-lane]').forEach((list) => {
      if (
        list.children.length &&
        list.children.length <
          data.totals[(list as HTMLElement).dataset.lane as TestColumn]
      )
        observer.observe(list.lastElementChild!);
    });
    return () => observer.disconnect();
  }, [data, depths, position, locationKey]);
  return (
    <div
      ref={host}
      className="queue-lanes"
      onScrollCapture={(event) => {
        if (!restored.current) return;
        const element = event.target as HTMLElement;
        if (element.dataset.lane)
          position.tops[element.dataset.lane] = element.scrollTop;
        else if (element.dataset.ui === 'test-board-scroll')
          position.left = element.scrollLeft;
        positions.set(locationKey, position);
      }}
    >
      <BoardResultFacts totals={snapshot?.totals} search={search} />
      {error && (
        <div role="alert" className="bg-card p-2">
          {error}{' '}
          <Button variant="ghost" onClick={reload}>
            重试
          </Button>
        </div>
      )}
      <TestBoard
        items={snapshot?.items ?? []}
        totals={snapshot?.totals}
        queue={snapshot?.queue ?? []}
        targets={[]}
        loading={!snapshot && !error}
        unavailable={!snapshot && !!error}
        filtered={!!(search || targetId)}
      />
      <footer className="board-status" aria-label="看板状态">
        <span className="sync-state" data-state={error ? 'error' : updatedAt ? 'ready' : 'loading'}>
          <i aria-hidden="true" />{error ? '刷新失败' : updatedAt ? '自动刷新' : '同步中…'}
        </span>
        {updatedAt && <time className="board-updated" dateTime={updatedAt.toISOString()} title="最近更新"><Clock3 />{updatedAt.toLocaleTimeString('zh-CN', { hour12: false })}</time>}
      </footer>
    </div>
  );
}

export function QueueBoard() {
  const search = useSearch({ strict: false });
  const path = useLocation({ select: (l) => l.pathname });
  const query = search.search ?? '',
    targetId = search.targetId ?? '';
  const key = JSON.stringify([path, query, targetId]);
  return (
    <section className="queue-scene" aria-label="团队执行看板">
      <h1 className="sr-only">执行看板</h1>
      <QueueLanes
        key={key}
        locationKey={key}
        search={query}
        targetId={targetId}
      />
    </section>
  );
}
