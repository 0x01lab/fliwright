import React from 'react';
import { Link } from '@tanstack/react-router';
import type { TestRequest } from '@fliwright/cloud-protocol';
import { Icon, ResultIcon } from './ui.js';
import { Card } from './components/ui/card.js';
import { Badge } from './components/ui/badge.js';

export type BoardRequest = Omit<TestRequest, 'target'>;
export type TestColumn = 'pending' | 'running' | 'passed' | 'failed' | 'other';

// The execution lifecycle takes precedence over an early or partial verdict.
export function testColumn(request: Pick<TestRequest, 'state' | 'verdict'>): TestColumn {
  if (request.state === 'queued') return 'pending';
  if (['assigned', 'preparing', 'running', 'finalizing', 'cancel_requested'].includes(request.state)) return 'running';
  if (request.state === 'infrastructure_failed') return 'failed';
  if (request.state === 'completed' && request.verdict === 'passed') return 'passed';
  if (request.state === 'completed' && request.verdict === 'failed') return 'failed';
  return 'other';
}

const columns = [
  { id: 'pending', title: '待测试', icon: 'clock', empty: '暂无等待中的测试' },
  { id: 'running', title: '测试中', icon: 'play', empty: '暂无正在执行的测试' },
  { id: 'passed', title: '已成功', icon: 'check', empty: '暂无成功的测试' },
  { id: 'failed', title: '已失败', icon: 'x', empty: '暂无失败的测试' },
  { id: 'other', title: '其他结果', icon: 'pause', empty: '暂无其他结果' },
] as const;

const statuses: Record<string, string> = {
  queued: '等待设备', assigned: '已分配设备', preparing: '准备测试环境',
  running: '执行测试', finalizing: '收集报告', cancel_requested: '正在取消',
  infrastructure_failed: '执行异常', cancelled: '已取消',
  passed: '测试通过', failed: '测试失败', skipped: '已跳过',
  interrupted: '已中断', unknown: '结果待定',
};

export function TestBoard({ items, queue, targets, loading = false, filtered = false }: {
  items: BoardRequest[];
  queue: string[];
  targets: Array<{ id: string; name: string }>;
  loading?: boolean;
  filtered?: boolean;
}) {
  const grouped = new Map<TestColumn, BoardRequest[]>(columns.map((column) => [column.id, []]));
  for (const item of items) grouped.get(testColumn(item))!.push(item);
  // Queue cards follow scheduling order; history keeps the API's newest-first order.
  const positions = new Map(queue.map((id, index) => [id, index + 1]));
  grouped.get('pending')!.sort((a, b) =>
    (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
  const visible = columns.filter((column) => column.id !== 'other' || grouped.get('other')!.length);

  return (
    <div className="min-h-0 flex-1 overflow-x-auto px-3 pb-3 [scrollbar-width:thin]" role="region" aria-label="测试状态看板" tabIndex={0} aria-busy={loading} data-ui="test-board-scroll">
      <div className="grid min-h-0 grid-cols-[repeat(var(--board-columns),minmax(220px,1fr))] items-stretch gap-2 max-sm:grid-cols-[repeat(var(--board-columns),minmax(260px,82vw))]" style={{ '--board-columns': visible.length } as React.CSSProperties} data-ui="test-board">
        {visible.map((column) => {
          const requests = grouped.get(column.id)!;
          const tone = column.id === 'passed' ? 'bg-pass-bg text-pass-ink' : column.id === 'failed' ? 'bg-destructive/10 text-destructive' : column.id === 'other' ? 'bg-warn-bg text-warn-ink' : 'bg-muted text-muted-foreground';
          return (
            <section className="flex min-h-80 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-muted p-1.5" key={column.id} aria-labelledby={`column-${column.id}`} data-ui={`test-column test-column-${column.id}`}>
              <div className="flex shrink-0 items-center gap-2 px-1.5 pt-1 pb-2 [&_h3]:text-xs [&_h3]:font-semibold" data-ui="test-column-heading">
                {column.id === 'passed' || column.id === 'failed' ? (
                  <ResultIcon status={column.id} />
                ) : (
                  <Icon name={column.icon} />
                )}
                <h3 id={`column-${column.id}`}>{column.title}</h3>
                <Badge variant="secondary" className="ml-auto bg-card tabular-nums" aria-label={`本页 ${requests.length} 条`} data-ui="test-column-count">{requests.length}</Badge>
              </div>
              <ul className="m-0 grid min-h-0 flex-1 auto-rows-max list-none content-start gap-2 overflow-y-auto overscroll-y-contain p-0.5 [scrollbar-width:thin]" tabIndex={0} aria-label={`${column.title}测试列表`} data-ui="test-column-cards">
                {requests.map((request) => {
                  const status = statuses[request.state === 'completed' ? request.verdict : request.state];
                  const position = positions.get(request.id);
                  const title = request.selection?.titlePath?.join(' › ') || request.input.suite;
                  return (
                    <li key={request.id}>
                      <Card asChild><Link data-ui="test-card" className="block min-w-0 break-words rounded-md p-2.5 text-foreground shadow-sm transition-shadow hover:border-input hover:text-foreground hover:no-underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 [&_h4]:mt-2 [&_h4]:text-xs [&_h4]:font-semibold [&_h4]:leading-snug" to="/requests/$id" params={{ id: request.id }} aria-label={`查看测试 ${title}，${request.id}，${status}`}>
                        <div className="flex items-start justify-between gap-2 text-[11px] text-muted-foreground [&_code]:shrink-0 [&_code]:text-[10px]" data-ui="test-card-top">
                          <span>{targets.find((target) => target.id === request.input.targetId)?.name ?? request.input.targetId}</span>
                          <code>#{request.id.slice(0, 8)}</code>
                        </div>
                        <h4>{title}</h4>
                        <p className="mt-0.5 text-xs text-muted-foreground" data-ui="test-card-suite">{request.input.suite}</p>
                        <div className="my-2 flex items-center gap-1.5 text-[11px] text-muted-foreground [&>svg]:ml-auto [&>svg]:size-3.5" data-ui="test-card-status">
                          <Badge variant="secondary" className={tone} data-ui="test-status-label">
                            {request.state === 'completed' &&
                            (request.verdict === 'passed' || request.verdict === 'failed') ? (
                              <ResultIcon status={request.verdict} className="size-4 [&_svg]:size-2.5" />
                            ) : (
                              <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" data-ui="test-status-dot" />
                            )}
                            {request.state === 'queued' && position ? `排队第 ${position} 位` : status}
                          </Badge>
                          <Icon name="chevron" />
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground [&>svg]:size-3 [&>code]:shrink-0 [&>span]:truncate" data-ui="test-card-source">
                          <Icon name="code" />
                          <code>{request.input.commit.slice(0, 8)}</code>
                          {request.input.source?.branch && <span title={request.input.source.branch}>{request.input.source.branch}</span>}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2 text-[10px] text-muted-foreground [&>span]:truncate [&>time]:shrink-0 [&>time]:tabular-nums" data-ui="test-card-footer">
                          <span title={request.actor}>{request.actor}</span>
                          <time dateTime={new Date(request.createdAt).toISOString()}>{new Date(request.createdAt).toLocaleString('zh-CN')}</time>
                        </div>
                      </Link></Card>
                    </li>
                  );
                })}
                {!requests.length && <li className="px-3 py-8 text-center text-xs text-muted-foreground" data-ui="test-column-empty">{loading ? '正在加载…' : filtered ? '本页无匹配测试' : column.empty}</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
