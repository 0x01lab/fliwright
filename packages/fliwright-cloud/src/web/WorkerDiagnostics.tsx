import React, { useState } from 'react';
import type { WorkerDiagnosticsView } from '@fliwright/cloud-protocol';
import { useData } from './data.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';

const labels = { healthy: '服务运行中', degraded: '部分组件异常', failed: '服务异常退出', stopped: '服务已停止', unreachable: '无法联系服务' };

/** Operator-only service sessions and diagnostics, independent of reports or test leases. */
export function WorkerDiagnosticsPanel({ workerId }: { workerId: string }) {
  const [open, setOpen] = useState(false), [level, setLevel] = useState(''), [session, setSession] = useState('');
  const [draft, setDraft] = useState(''), [search, setSearch] = useState(''), [before, setBefore] = useState(0);
  const query = new URLSearchParams();
  if (level) query.set('level', level);
  if (session) query.set('sessionId', session);
  if (search) query.set('search', search);
  if (before) query.set('before', String(before));
  const path = `/api/workers/${encodeURIComponent(workerId)}/diagnostics${query.size ? `?${query}` : ''}`;
  const { data, error, reload } = useData<WorkerDiagnosticsView>(path, before ? 0 : 10000, open);
  return <div className="space-y-3">
    <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>服务诊断与日志</Button>
    {open && <section className="space-y-3" aria-label={`${workerId} 服务诊断`}>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p className="text-xs text-muted-foreground">正在读取服务诊断…</p>}
      {data?.sessions.length === 0 && <p className="text-xs text-muted-foreground">尚未收到服务监控。请升级并重启 Worker；也可在主机运行 fliwright-worker logs worker.json 查看本地日志。</p>}
      {data?.sessions.map(item => <div key={item.sessionId} className="space-y-1 rounded-md bg-muted p-3 text-xs">
        <p className="font-medium">{labels[item.status]} · PID {item.pid} · {item.nodeVersion}</p>
        <p>启动 {new Date(item.startedAt).toLocaleString()} · 最近上报 {new Date(item.receivedAt).toLocaleString()}</p>
        <p>运行 {Math.floor(item.uptimeMs / 1000)} 秒 · 内存 {(item.rssBytes / 1024 ** 2).toFixed(1)} MB · 事件循环延迟 {Math.round(item.eventLoopLagMs)} ms</p>
        <p>组件：{Object.entries(item.components).map(([name, state]) => `${name}: ${state}`).join(' · ') || '尚未登记'}</p>
        <p className="break-all text-muted-foreground">会话 {item.sessionId}</p>
        {item.status === 'unreachable' && <p>超过 35 秒未收到监控心跳。进程退出、网络中断或主机休眠均可能导致，请结合本机日志确认。</p>}
      </div>)}
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setBefore(0); setSearch(draft); reload(); }}>
        <select className="h-8 rounded-md bg-muted px-2 text-xs" aria-label="日志级别" value={level} onChange={event => { setBefore(0); setLevel(event.target.value); }}>
          <option value="">全部级别</option>{['info', 'warn', 'error', 'fatal'].map(value => <option key={value}>{value}</option>)}
        </select>
        <select className="h-8 max-w-64 rounded-md bg-muted px-2 text-xs" aria-label="服务会话" value={session} onChange={event => { setBefore(0); setSession(event.target.value); }}>
          <option value="">全部会话</option>{data?.sessions.map(item => <option key={item.sessionId} value={item.sessionId}>{new Date(item.startedAt).toLocaleString()} · PID {item.pid}</option>)}
        </select>
        <Input className="max-w-64" aria-label="搜索服务日志" placeholder="搜索错误、槽位或任务 ID" value={draft} onChange={event => setDraft(event.target.value)} maxLength={200} />
        <Button size="sm" type="submit">搜索</Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => { setBefore(0); reload(); }}>最新日志</Button>
        {data && <Button size="sm" variant="ghost" type="button" onClick={() => {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob), link = document.createElement('a');
          link.href = url; link.download = `worker-${workerId}-diagnostics.json`; link.click(); URL.revokeObjectURL(url);
        }}>下载当前诊断</Button>}
      </form>
      <div className="max-h-96 space-y-2 overflow-auto rounded-md bg-muted p-3 text-xs">
        {data?.logs.map(log => <details key={log.id} className="space-y-2">
          <summary className="cursor-pointer break-words font-mono">{new Date(log.at).toLocaleString()} [{log.level}] {log.event} · {log.message}</summary>
          <p className="break-all">会话 {log.sessionId}{log.slotId && ` · 槽位 ${log.slotId}`}{log.requestId && ` · 请求 ${log.requestId}`}{log.attemptId && ` · 执行 ${log.attemptId}`}</p>
          {log.stack && <pre className="whitespace-pre-wrap break-words">{log.stack}</pre>}
        </details>)}
        {data?.logs.length === 0 && <p>当前条件下没有服务日志。</p>}
      </div>
      {data?.logs.length === 100 && <Button size="sm" variant="secondary" onClick={() => setBefore(data.nextCursor)}>更早日志</Button>}
    </section>}
  </div>;
}
