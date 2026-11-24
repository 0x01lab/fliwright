import React from 'react';
import { Link } from '@tanstack/react-router';
import type { TestRequest } from '@fliwright/cloud-protocol';
import { CircleDashed, Clock3, GitBranch, GitCommitHorizontal, LoaderCircle, UserRound } from 'lucide-react';
import { ResultIcon } from './ui.js';
import type { BoardDepth, BoardItem, TestColumn } from '../request-board.js';
import { repoPath } from './project-identity.js';

export type BoardRequest = BoardItem;
export type { TestColumn } from '../request-board.js';

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
  { id: 'pending', title: '待测试' }, { id: 'running', title: '测试中' },
  { id: 'passed', title: '已成功' }, { id: 'failed', title: '已失败' },
  { id: 'other', title: '其他结果' },
] as const;

const statuses: Record<string, string> = {
  queued: '等待设备', assigned: '已分配设备', preparing: '准备测试环境',
  running: '执行测试', finalizing: '收集报告', cancel_requested: '正在取消',
  infrastructure_failed: '执行异常', cancelled: '已取消',
  passed: '测试通过', failed: '测试失败', skipped: '已跳过',
  interrupted: '已中断', unknown: '结果待定', superseded: '已被替代',
};

const cardDate = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function ExecutionCard({ request, projectName, position, lane }: { request: BoardRequest; projectName: string; position?: number; lane: TestColumn }) {
  const title = request.selection?.titlePath?.join(' › ') || request.input.suite;
  const status = statuses[request.state === 'completed' ? request.verdict : request.state];
  const branch = request.input.source?.branch ?? request.source?.branch;
  const showStage = request.state !== 'completed' || lane === 'other';
  const StageIcon = lane === 'pending' ? Clock3 : lane === 'running' ? LoaderCircle : CircleDashed;
  return <Link className="execution-card" data-ui="test-card" to="/requests/$id" params={{ id: request.id }} aria-label={`查看测试 ${title}，${request.id}，${status}`}>
    <div className="ticket-heading">
      <h4 title={title}>{title}</h4>
      {lane === 'passed' || lane === 'failed' ? <ResultIcon status={lane} className="size-4 [&_svg]:size-2.5" /> : <StageIcon className="ticket-stage-icon" aria-hidden="true" />}
    </div>
    <div className="ticket-context">
      <div className="ticket-tags">
        <span className="project-tag" title={request.repository ? `${projectName} · ${repoPath(request.repository)}` : projectName}>{projectName}</span>
        {title !== request.input.suite && <span title={request.input.suite}>{request.input.suite}</span>}
        {showStage && <span className="stage-tag">{lane === 'pending' && position ? `排队第 ${position} 位` : status}</span>}
      </div>
      <code className="ticket-id" title={request.id}>#{request.id.slice(0, 8)}</code>
    </div>
    <div className="ticket-footer" data-ui="test-card-footer">
      <div className="ticket-source" data-ui="test-card-source">
        {branch && <span title={branch}><GitBranch aria-hidden="true" /><code>{branch}</code></span>}
        <span title={request.input.commit}><GitCommitHorizontal aria-hidden="true" /><code>{request.input.commit.slice(0, 8)}</code></span>
      </div>
      <div className="ticket-byline">
        <span className="ticket-actor" title={request.actor}><UserRound aria-hidden="true" /><span>{request.actor}</span></span>
        <time dateTime={new Date(request.createdAt).toISOString()} title={new Date(request.createdAt).toLocaleString('zh-CN')}>{cardDate.format(request.createdAt)}</time>
      </div>
    </div>
  </Link>;
}

export function TestBoard({ items, queue, targets, totals, loading = false, unavailable = false, filtered = false }: {
  totals?: BoardDepth;
  items: BoardRequest[];
  queue: string[];
  targets: Array<{ id: string; name: string }>;
  loading?: boolean;
  unavailable?: boolean;
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
    <div className="board-scroll" role="region" aria-label="测试状态看板" tabIndex={0} aria-busy={loading} data-ui="test-board-scroll">
      <div className="board-deck" style={{ '--board-columns': visible.length } as React.CSSProperties} data-ui="test-board">
        {visible.map((column) => {
          const requests = grouped.get(column.id)!;
          const count = totals?.[column.id] ?? requests.length;
          return (
            <section className="board-lane" key={column.id} data-column={column.id} aria-labelledby={`column-${column.id}`} data-ui={`test-column test-column-${column.id}`}>
              <div className="lane-heading" data-ui="test-column-heading">
                <i className="lane-dot" aria-hidden="true" />
                <h3 id={`column-${column.id}`}>{column.title}</h3>
                <span className="lane-count" data-ui="test-column-count">{loading || unavailable ? '—' : count}</span>
              </div>
              <ul data-lane={column.id} className="lane-cards" tabIndex={0} aria-label={`${column.title}测试列表`} data-ui="test-column-cards">
                {requests.map(request => <li key={request.id}><ExecutionCard request={request} lane={column.id} position={positions.get(request.id)} projectName={request.projectName ?? targets.find(target => target.id === request.input.targetId)?.name ?? request.input.targetId} /></li>)}
                {!requests.length && !unavailable && <li className="lane-empty" data-ui="test-column-empty">{loading ? '正在加载…' : filtered ? '无匹配任务' : '暂无任务'}</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
