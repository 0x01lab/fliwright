import React from 'react';
import { Link } from '@tanstack/react-router';
import type { TestRequest } from '@fliwright/cloud-protocol';
import { Icon, ResultIcon } from './ui.js';

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
    <div className="test-board-scroll" role="region" aria-label="测试状态看板" tabIndex={0} aria-busy={loading}>
      <div className="test-board" style={{ '--board-columns': visible.length } as React.CSSProperties}>
        {visible.map((column) => {
          const requests = grouped.get(column.id)!;
          return (
            <section className={`test-column test-column-${column.id}`} key={column.id} aria-labelledby={`column-${column.id}`}>
              <div className="test-column-heading">
                {column.id === 'passed' || column.id === 'failed' ? (
                  <ResultIcon status={column.id} />
                ) : (
                  <Icon name={column.icon} />
                )}
                <h3 id={`column-${column.id}`}>{column.title}</h3>
                <span className="test-column-count" aria-label={`本页 ${requests.length} 条`}>{requests.length}</span>
              </div>
              <ul className="test-column-cards" tabIndex={0} aria-label={`${column.title}测试列表`}>
                {requests.map((request) => {
                  const status = statuses[request.state === 'completed' ? request.verdict : request.state];
                  const position = positions.get(request.id);
                  return (
                    <li key={request.id}>
                      <Link className="test-card" to="/requests/$id" params={{ id: request.id }} aria-label={`查看测试 ${request.input.scenario}，${request.id}，${status}`}>
                        <div className="test-card-top">
                          <span>{targets.find((target) => target.id === request.input.targetId)?.name ?? request.input.targetId}</span>
                          <code>#{request.id.slice(0, 8)}</code>
                        </div>
                        <h4>{request.input.scenario}</h4>
                        <p className="test-card-suite">{request.input.suite}</p>
                        <div className="test-card-status">
                          <span className="test-status-label">
                            {request.state === 'completed' &&
                            (request.verdict === 'passed' || request.verdict === 'failed') ? (
                              <ResultIcon status={request.verdict} className="small" />
                            ) : (
                              <span className="test-status-dot" aria-hidden="true" />
                            )}
                            {request.state === 'queued' && position ? `排队第 ${position} 位` : status}
                          </span>
                          <Icon name="chevron" />
                        </div>
                        <div className="test-card-source">
                          <Icon name="code" />
                          <code>{request.input.commit.slice(0, 8)}</code>
                          {request.input.source?.branch && <span title={request.input.source.branch}>{request.input.source.branch}</span>}
                        </div>
                        <div className="test-card-footer">
                          <span title={request.actor}>{request.actor}</span>
                          <time dateTime={new Date(request.createdAt).toISOString()}>{new Date(request.createdAt).toLocaleString('zh-CN')}</time>
                        </div>
                      </Link>
                    </li>
                  );
                })}
                {!requests.length && <li className="test-column-empty">{loading ? '正在加载…' : filtered ? '本页无匹配测试' : column.empty}</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
