import { Alert } from './components/ui/alert.js';
import React, { useEffect, useRef, useState } from 'react';
import type { ExecutionAttempt, WorkerTimelineSpan, WorkerTimelineView } from '@fliwright/cloud-protocol';
import { api } from './data.js';
import { Icon } from './ui.js';
import { Button } from './components/ui/button.js';
import { NativeSelect } from './components/ui/native-select.js';

const phases: Record<WorkerTimelineSpan['phase'], string> = {
  'execution.prepare': '准备执行进程', 'repository.checkout': '获取测试代码', 'dependencies.install': '安装项目依赖',
  'device.reset.before': '准备测试设备', 'app.launch': '启动 Flutter App', 'app.verify': '验证测试连接',
  'tests.run': '运行测试', 'artifacts.export': '导出测试报告', 'processes.stop': '停止执行进程',
  'report.publish': '发布测试报告', 'device.reset.after': '清理测试设备',
  'native.acquire': '获取原生设备租约', 'native.build': '构建 Android App', 'native.install': '安装 Android App',
  'native.stop': '停止 Android App', 'native.prepare': '准备原生设备状态', 'native.launch': '启动已安装 App',
  'native.verify': '验证原生启动与 VM', 'native.cleanup': '恢复原生设备状态', 'native.release': '释放原生设备租约',
  'native.attempt': '原生 App attempt',
};
const operations: Record<string, string> = { clone: '克隆仓库', fetch: '获取提交', checkout: '检出代码', verify_sha: '校验提交', command: '命令', 'publication.prepare': '准备发布', 'publication.commit': '提交报告' };
const statuses = { running: '进行中', succeeded: '成功', failed: '失败', interrupted: '已中断', unknown: '结束时间未知' };
const qualities = { recording: '记录中', complete: '记录完整', partial: '记录不完整', not_recorded: '无记录' };
const verdicts = { passed: '测试通过', failed: '测试失败', skipped: '测试跳过', interrupted: '测试已中断', unknown: '测试结果待定' };
const reasons = { cancelled: '任务取消', timeout: '执行超时', shutdown: 'Worker 停止', process_exit: '执行进程退出', lease_lost: '租约失效' };
const issues: Record<string, string> = { storage_error: '本机记录写入失败', ipc_timeout: '进程间确认超时', capacity: '记录达到容量上限', delivery_error: '部分事件未获服务端确认', missing_events: '存在未收到的事件', open_spans: '部分阶段没有结束记录', truncated: '本机记录尾部截断' };
const milestones = { 'app.process_started': '已观测 App 进程', 'app.started': 'App 已启动', 'vm.endpoint_observed': '已观测 VM Service' };
const elapsed = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const title = (span: WorkerTimelineSpan) => span.operation ? `${operations[span.operation] ?? span.operation}${span.commandIndex === undefined ? '' : ` #${span.commandIndex + 1}`}`
  : span.phase === 'native.attempt' ? `${phases[span.phase]} #${span.attemptOrdinal ?? '?'}` : phases[span.phase];

/** Worker evidence remains separate from Replay and never becomes a test node. */
export function WorkerExecutionTimeline({ requestId, attempts = [], executionAttemptId }: {
  requestId: string; attempts?: ExecutionAttempt[]; executionAttemptId?: string;
}) {
  const [chosenAttempt, chooseAttempt] = useState<string>();
  const id = executionAttemptId ?? (attempts.some(a => a.attemptId === chosenAttempt) ? chosenAttempt : attempts.at(-1)?.attemptId);
  const [view, setView] = useState<WorkerTimelineView>();
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('连接中');
  const [selected, select] = useState<string>();
  const [expanded, expand] = useState<Set<string>>(new Set());
  const autoExpanded = useRef(new Set<string>());
  const [logs, setLogs] = useState<Array<{ seq: number; at: number; text: string; workerSpanId?: string }>>([]);
  const [logError, setLogError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const path = `/api/requests/${encodeURIComponent(requestId)}/attempts/${encodeURIComponent(id ?? '')}/worker-timeline`;
  useEffect(() => {
    setView(undefined); setError(''); select(undefined); expand(new Set()); autoExpanded.current.clear();
    if (!id) return;
    let active = true, loading = false, again = false, terminal = false;
    const stream = new EventSource(`/api/requests/${encodeURIComponent(requestId)}/events`);
    const load = async () => {
      if (!active || terminal) return;
      if (loading) { again = true; return; }
      loading = true;
      try {
        const value = await api<WorkerTimelineView>(path);
        if (!active) return;
        if (value.schemaVersion !== 1 || !Array.isArray(value.spans)) throw new Error('Worker 时间轴响应不可用');
        setView(value); setError('');
        if (value.executionStatus !== 'running') { terminal = true; stream.close(); clearInterval(timer); setConnection('已结束'); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '加载失败'); }
      finally { loading = false; if (again) { again = false; void load(); } }
    };
    const timer = setInterval(() => { void load(); }, 2000);
    stream.onopen = () => { setConnection('实时连接'); void load(); };
    stream.onerror = () => { if (active && !terminal) setConnection('重连中，定时刷新'); };
    stream.onmessage = event => {
      try {
        const update = JSON.parse(event.data);
        if ((update.kind === 'worker-timeline-updated' && update.data?.executionAttemptId === id) || update.kind === 'finished' || update.kind === 'lease-lost') void load();
      } catch { /* Malformed notifications are not timeline evidence. */ }
    };
    setConnection('连接中'); void load();
    return () => { active = false; stream.close(); clearInterval(timer); };
  }, [requestId, id, path, refresh]);
  useEffect(() => {
    const candidates = view?.spans.filter(s => !s.parentSpanId && (s.status === 'failed' || s.status === 'running') && !autoExpanded.current.has(s.id)) ?? [];
    if (!candidates.length) return;
    for (const span of candidates) autoExpanded.current.add(span.id);
    expand(previous => new Set([...previous, ...candidates.map(s => s.id)]));
  }, [view?.revision]);
  const selectedSpan = view?.spans.find(s => s.id === selected) ?? view?.spans.find(s => s.status === 'failed') ?? view?.spans.filter(s => !s.parentSpanId).at(-1);
  useEffect(() => {
    setLogs([]); setLogError('');
    if (!id || !selectedSpan || view?.expiredAt) return;
    let active = true;
    void api<{ logs: typeof logs }>(`${path}/logs?spanId=${encodeURIComponent(selectedSpan.id)}`).then(value => {
      if (active) setLogs(Array.isArray(value.logs) ? value.logs : []);
    }).catch(e => { if (active) setLogError(e.message); });
    return () => { active = false; };
  }, [id, path, selectedSpan?.id, view?.revision, view?.expiredAt]);
  const range = Math.max(1, view?.observedOffsetMs ?? 0, ...view?.spans.map(s => s.endMs ?? s.startMs) ?? []);
  const rows = view?.spans.filter(s => !s.parentSpanId).flatMap(parent => [parent, ...(expanded.has(parent.id) ? view.spans.filter(s => s.parentSpanId === parent.id) : [])]) ?? [];
  return <section className="min-w-0 bg-card py-3" aria-label="Worker 执行时间轴" data-ui="worker-timeline">
    <div className="flex items-center justify-between gap-2 px-3 pb-3 [&_h2]:flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-sm" data-ui="worker-timeline-heading">
      <h2><Icon name="cpu" />Worker 执行</h2>
      <div className="flex items-center gap-2 max-sm:max-w-[55%]" data-ui="worker-timeline-tools">
        {!executionAttemptId && attempts.length > 0 && <NativeSelect aria-label="Worker 执行尝试" value={id} onChange={e => chooseAttempt(e.target.value)}>
          {attempts.map(a => <option key={a.attemptId} value={a.attemptId}>执行 #{a.number}</option>)}
        </NativeSelect>}
        <Button size="icon" variant="ghost" aria-label="刷新 Worker 时间轴" title="刷新 Worker 时间轴" onClick={() => setRefresh(v => v + 1)}><Icon name="refresh" /></Button>
      </div>
    </div>
    {!id && <p className="p-3 text-muted-foreground" data-ui="worker-empty">等待 Worker 领取任务。</p>}
    {error && <Alert asChild variant="destructive"><p role="alert" data-ui="error">{error}</p></Alert>}
    {id && !view && !error && <p className="p-3 text-muted-foreground" data-ui="worker-empty">正在加载 Worker 时间轴…</p>}
    {view && <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2 font-medium" role="status" data-ui="worker-timeline-summary">
        <span>{view.executionStatus === 'running' ? 'Worker 执行中' : view.executionStatus === 'lost' ? 'Worker 已失联' : 'Worker 已结束'}</span>
        <span>{verdicts[view.testVerdict]}</span><span>{qualities[view.quality]}</span><span className="text-xs text-muted-foreground" data-ui="sub">{connection}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2 text-xs text-muted-foreground [&_code]:min-w-0 [&_code]:max-w-full [&_code]:break-words [&_a]:inline-flex [&_a]:items-center [&_a]:gap-1" data-ui="worker-timeline-meta"><span>Worker {view.workerId}</span><span>槽位 {view.slotId}</span><span>设备 {view.deviceId || '—'}</span>
        <code title={view.executionAttemptId}>{view.executionAttemptId}</code>
        {view.report && <a href={`/reports/${encodeURIComponent(view.report.bundleId)}`}>测试报告 <Icon name="link" /></a>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2 text-xs text-muted-foreground [&_code]:min-w-0 [&_code]:max-w-full [&_code]:break-words [&_a]:inline-flex [&_a]:items-center [&_a]:gap-1" data-ui="worker-timeline-meta">
        {view.assignedAt !== undefined && <span>分配：{new Date(view.assignedAt).toLocaleString('zh-CN')}</span>}
        {view.lastReceivedAt !== undefined && <span>最后接收：{new Date(view.lastReceivedAt).toLocaleString('zh-CN')}</span>}
        {view.finishedAt !== undefined && <span>{view.executionStatus === 'lost' ? '服务端确认失联' : '执行结束'}：{new Date(view.finishedAt).toLocaleString('zh-CN')}</span>}
        {view.assignedAt !== undefined && view.finishedAt !== undefined && <span>任务耗时：{elapsed(Math.max(0, view.finishedAt - view.assignedAt))}</span>}
        {view.outcome?.cleanup === 'failed' && <span>设备清理失败，槽位已隔离</span>}
        {view.outcome?.publication === 'publish_failed' && <span>报告发布失败</span>}
      </div>
      {view.issues.length > 0 && <p className="mx-3 mb-3 flex items-start gap-2 rounded-md bg-muted p-2 text-muted-foreground" data-ui="worker-notice"><Icon name="alert" />{view.issues.map(issue => issues[issue] ?? issue).join('；')}</p>}
      {view.expiredAt ? <p className="p-3 text-muted-foreground" data-ui="worker-empty">明细已过期。Worker 时间轴明细保留 30 天，执行摘要仍可查看。</p> : view.quality === 'not_recorded' ? <p className="p-3 text-muted-foreground" data-ui="worker-empty">此执行没有 Worker 时间轴记录。</p> : !view.spans.length ? <p className="p-3 text-muted-foreground" data-ui="worker-empty">等待 Worker 阶段记录。</p> : <>
        <div className="overflow-x-auto" data-ui="worker-timeline-scroll">
          <div className="grid min-w-[520px] grid-cols-[240px_minmax(280px,1fr)] bg-muted px-3 py-2 text-[10px] text-muted-foreground [&>span:last-child]:flex [&>span:last-child]:justify-between" data-ui="worker-axis"><span>阶段 / 采集时间</span><span><span>0</span><span>{elapsed(range / 2)}</span><span>{elapsed(range)}</span></span></div>
          {rows.map(span => {
            const children = view.spans.some(s => s.parentSpanId === span.id);
            const end = span.endMs ?? (span.status === 'running' ? view.observedOffsetMs : span.startMs);
            return <div className={`grid min-w-[520px] grid-cols-[240px_minmax(280px,1fr)] px-3 data-[selected=true]:bg-muted hover:bg-accent${span.parentSpanId ? " [&_[data-ui~=worker-span-label]]:pl-5 [&_[data-ui~=worker-span-label]]:text-muted-foreground" : ''}`} key={span.id} data-selected={selectedSpan?.id === span.id} data-ui={`worker-span-row${span.parentSpanId ? ' worker-span-child' : ''}`}>
              <div className="flex min-w-0 items-center pr-3 [&>button:last-child]:flex [&>button:last-child]:min-w-0 [&>button:last-child]:flex-1 [&>button:last-child]:flex-col [&>button:last-child]:items-start [&>button:last-child]:gap-0.5 [&>button:last-child]:py-2 [&>button:last-child]:text-left [&>button:last-child>span]:max-w-full [&>button:last-child>span]:truncate [&_small]:flex [&_small]:items-center [&_small]:gap-1 [&_small]:text-[10px] [&_small]:text-muted-foreground [&_small_svg]:size-3 [&_small[data-status=failed]]:text-destructive" data-ui="worker-span-label">
                {children ? <Button size="icon-sm" variant="ghost" aria-label={`${expanded.has(span.id) ? '收起' : '展开'}${title(span)}`} aria-expanded={expanded.has(span.id)} onClick={() => expand(previous => { const next = new Set(previous); next.has(span.id) ? next.delete(span.id) : next.add(span.id); return next; })}><Icon name="chevron" className={expanded.has(span.id) ? 'rotate-90' : ''} /></Button> : <span className="w-6 shrink-0" data-ui="worker-span-indent" />}
                <button type="button" onClick={() => select(span.id)} title={title(span)} aria-pressed={selectedSpan?.id === span.id}><span>{title(span)}</span><small data-status={span.status}><Icon name={span.status === 'succeeded' ? 'check' : span.status === 'failed' ? 'x' : span.status === 'running' ? 'clock' : 'alert'} />{statuses[span.status]}</small></button>
              </div>
              <button type="button" className="relative min-w-0" aria-label={`查看${title(span)}：${statuses[span.status]}`} onClick={() => select(span.id)} data-ui="worker-span-track">
                <span className="absolute top-2 h-2 min-w-0.5 max-w-full rounded-sm bg-muted-foreground data-[status=failed]:bg-destructive data-[status=running]:opacity-50 data-[status=unknown]:border-l-2 data-[status=unknown]:border-dotted data-[status=unknown]:border-muted-foreground data-[status=unknown]:bg-transparent" data-status={span.status} style={{ left: `${span.startMs / range * 100}%`, width: `${Math.max(0, end - span.startMs) / range * 100}%` }} data-ui="worker-span-bar" />
                <span className="absolute bottom-1 left-0 text-[10px] text-muted-foreground" data-ui="worker-span-duration">{span.durationMs !== undefined ? elapsed(span.durationMs) : span.status === 'running' ? `截至最近观测 ≥ ${elapsed(Math.max(0, end - span.startMs))}` : '结束时间未知'}</span>
              </button>
            </div>;
          })}
          {view.milestones.length > 0 && <div className="grid min-w-[520px] grid-cols-[240px_minmax(280px,1fr)] px-3 py-2 text-[10px] text-muted-foreground [&>div]:relative [&>div]:h-5 [&>div>span]:absolute" data-ui="worker-milestones"><span>里程碑</span><div>{view.milestones.map(m => <span key={m.seq} style={{ left: `${Math.min(99, m.offsetMs / range * 100)}%` }} title={`${milestones[m.name]} · ${elapsed(m.offsetMs)}`} aria-label={`${milestones[m.name]} ${elapsed(m.offsetMs)}`}>◆</span>)}</div></div>}
        </div>
        {selectedSpan && <div className="mt-3 border-t border-border px-3 pt-3 [&_h3]:flex [&_h3]:flex-wrap [&_h3]:items-center [&_h3]:gap-2 [&_h3]:text-xs [&_h3>span]:font-normal [&_h3>span]:text-muted-foreground [&_dl]:my-3 [&_dl]:grid [&_dl]:grid-cols-2 [&_dl]:gap-x-5 [&_dl]:gap-y-2 max-sm:[&_dl]:grid-cols-1 [&_dt]:text-[10px] [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:break-words [&_details]:py-2 [&_pre]:my-2 [&_pre]:max-h-48 [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-[10px]" aria-label="Worker 阶段详情" data-ui="worker-span-detail">
          <h3>{title(selectedSpan)} <span>{statuses[selectedSpan.status]}</span></h3>
          <dl>
            <div><dt>开始偏移</dt><dd>{elapsed(selectedSpan.startMs)}</dd></div>
            <div><dt>采集时间</dt><dd><time>{selectedSpan.startedAt}</time></dd></div>
            <div><dt>结束 / 耗时</dt><dd>{selectedSpan.endMs === undefined ? selectedSpan.status === 'running' ? '等待结束记录' : '结束时间未知' : `${elapsed(selectedSpan.endMs)} / ${elapsed(selectedSpan.durationMs!)}`}</dd></div>
            <div><dt>事件序号</dt><dd>#{selectedSpan.startSeq}{selectedSpan.endSeq !== undefined ? ` → #${selectedSpan.endSeq}` : ''}</dd></div>
            {selectedSpan.exitCode !== undefined && <div><dt>退出码</dt><dd>{selectedSpan.exitCode}</dd></div>}
            {selectedSpan.reason && <div><dt>停止原因</dt><dd>{reasons[selectedSpan.reason]}</dd></div>}
            {selectedSpan.testVerdict && <div><dt>测试结果</dt><dd>{verdicts[selectedSpan.testVerdict]}</dd></div>}
            {selectedSpan.runId && <div><dt>Run ID</dt><dd>{selectedSpan.runId}</dd></div>}
          </dl>
          {selectedSpan.error && <Alert asChild variant="destructive"><p role="alert" data-ui="error">{selectedSpan.error.code} · {selectedSpan.error.message}</p></Alert>}
          {view.milestones.filter(m => m.spanId === selectedSpan.id).map(m => <p key={m.seq}>{milestones[m.name]} · {elapsed(m.offsetMs)}</p>)}
          <details><summary>同期日志{logs.length ? `（${logs.length}）` : ''}</summary>
            <p className="text-xs text-muted-foreground" data-ui="sub">按 Worker 观测区间筛选，日志接收可能延迟。</p>
            {logError ? <p role="alert">{logError}</p> : logs.length ? logs.map(log => <pre key={log.seq}>{log.text}</pre>) : <p className="text-xs text-muted-foreground" data-ui="sub">此区间暂无日志。</p>}
          </details>
        </div>}
      </>}
    </>}
  </section>;
}
