import { Alert } from './components/ui/alert.js';
import { ArrowLeft, ArrowUpRight, ChevronDown, Monitor, Pause, Play, TriangleAlert } from 'lucide-react';
import { WorkerPairing } from './WorkerPairing.js';
import type { WorkerStatusResponse } from '../catalog-scan-status.js';
import { serviceStatusLabels } from './WorkerDiagnostics.js';
import { WorkerHostDetails } from './WorkerHostDetails.js';
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  retainSearchParams,
  stripSearchParams,
  RouterProvider,
  useLocation,
  useMatches,
  useNavigate,
  useSearch,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { Badge as UiBadge } from './components/ui/badge.js';
import { Card } from './components/ui/card.js';
import { Label } from './components/ui/label.js';
import { Input } from './components/ui/input.js';
import { Button } from './components/ui/button.js';
import { NativeSelect } from './components/ui/native-select.js';
import { Checkbox } from './components/ui/checkbox.js';
import { Textarea } from './components/ui/textarea.js';
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import type { ReportView } from '../ReportStore.js';
import type {
  ExecutionAttempt,
  ExecutionWorker,
  Project,
  TestRequest,
} from '@fliwright/cloud-protocol';
import { Icon, stageLabel } from './ui.js';
import { Replay } from './Replay.js';
import { api, useData } from './data.js';
import { Devices, DeviceDetail, deviceFilters } from './Devices.js';
import { Projects } from './Projects.js';
import { TestBoard, type BoardRequest } from './TestBoard.js';
import { QueueBoard } from './QueueBoard.js';
import { WorkspaceHeader, type CloudUser, type ProjectDirectory } from './WorkspaceHeader.js';
import { activeProjectView, boardDestination, reportsDestination, useWorkspaceProjectId, type ProjectView, type WorkspacePage } from './ProjectNavigation.js';
import { WorkerExecutionTimeline } from './WorkerExecutionTimeline.js';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs.js';
import { Toaster } from './components/ui/sonner.js';

const TeamContext = createContext<{
  user?: CloudUser;
  directory: ProjectDirectory;
  workers: ReturnType<typeof useData<WorkerStatusResponse[]>>;
} | null>(null);
type Detail = Omit<TestRequest, 'target' | 'attempts'> & {
  attempts: ExecutionAttempt[];
  reports: Array<{
    id: string;
    attemptId: string;
    state: string;
    expiresAt: number;
  }>;
  queuePosition: number;
};
const labels: Record<string, string> = {
  queued: '排队中',
  assigned: '已分配',
  preparing: '准备中',
  running: '运行中',
  finalizing: '收集报告',
  cancel_requested: '正在取消',
  completed: '已完成',
  cancelled: '已取消',
  superseded: '已被新提交替代',
  infrastructure_failed: '执行异常',
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
  interrupted: '已中断',
  unknown: '待定',
  published: '已发布',
  staging: '上传中',
  publish_failed: '发布失败',
  unavailable: '暂无报告',
  clean: '清理完成',
  idle: '空闲',
  busy: '执行中',
  quarantined: '已隔离',
  expired: '已过期',
  healthy: '在线',
  offline: '已离线',
  unseen: '尚未连接',
  complete: '完整',
  partial: '部分缺失',
  disabled: '未采集',
};
const text = (v: unknown): string =>
  v === undefined || v === null
    ? '—'
    : typeof v === 'string'
      ? v
      : typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : JSON.stringify(v);
const time = (v: number) => new Date(v).toLocaleString('zh-CN');
const terminal = (state: string) =>
  ['completed', 'cancelled', 'superseded', 'infrastructure_failed'].includes(state);
function Badge({ value }: { value: string }) {
  const tone = ['passed', 'healthy', 'idle', 'clean', 'published'].includes(
    value,
  )
    ? 'bg-pass-bg text-pass-ink'
    : ['failed', 'infrastructure_failed', 'publish_failed'].includes(value)
      ? 'bg-fail-bg text-fail-ink'
      : [
            'running',
            'preparing',
            'assigned',
            'busy',
            'finalizing',
            'staging',
          ].includes(value)
        ? 'bg-run-bg text-run-ink'
        : ['quarantined', 'cancel_requested'].includes(value)
          ? 'bg-warn-bg text-warn-ink'
          : value === 'completed'
            ? 'bg-done-bg text-done-ink'
            : 'bg-idle-bg text-idle-ink';
  return (
    <UiBadge
      variant="secondary"
      className={`gap-1.5 whitespace-nowrap border-transparent ${tone}`}
    >
      <span
        className="size-1.5 shrink-0 rounded-full bg-current"
        aria-hidden="true"
      />
      {labels[value] ?? value}
    </UiBadge>
  );
}
function ErrorBox({ error }: { error: string }) {
  return error ? (
    <Alert asChild variant="destructive"><div role="alert" data-ui="error">
      {error}
    </div></Alert>
  ) : null;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs" data-ui="empty">{children}</div>;
}
function PageTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  const descriptions: Record<string, string> = {
    'TEAM OVERVIEW': '统一查看测试运行、任务队列与设备状态。',
    'TEST REPORTS': '按测试结果浏览已完成的运行，点击卡片查看步骤回放与归档证据。',
    'EXECUTION QUEUE': '从待测试到测试结果，状态自动更新。点击卡片查看详情。',
    'APPLICATION TARGETS': '管理已注册应用及其测试套件与场景。',
  };
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {descriptions[eyebrow] && (
          <p className="text-xs text-muted-foreground" data-ui="lede">{descriptions[eyebrow]}</p>
        )}
      </div>
      <div className="ml-auto flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
function Layout({
  children,
  shared = false,
}: {
  children: ReactNode;
  shared?: boolean;
}) {
  const { data: me } = useData<CloudUser>(
    '/api/me',
    0,
    !shared,
  );
  const directory = useData<Project[]>('/api/projects', 10000, !shared);
  const workers = useData<WorkerStatusResponse[]>('/api/workers', 3000, !shared);
  const targetId = useWorkspaceProjectId();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('cloud-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const path = useLocation({ select: (location) => location.pathname });
  const page = useMatches<AnyRouter, WorkspacePage>({ select: matches => matches.at(-1)?.staticData.workspacePage ?? 'other' });
  const isReportPage = path.startsWith('/reports/') || path.startsWith('/shared/reports/');
  const showWorkerAlert = !shared && path !== '/workers' && !workers.error &&
    workers.data?.some(worker => worker.health === 'healthy') === false;
  const workerAlertRef = useRef<HTMLDivElement>(null);
  const [workerAlertHeight, setWorkerAlertHeight] = useState(0);
  useLayoutEffect(() => {
    const alert = workerAlertRef.current;
    if (!showWorkerAlert || !alert) return;
    const measure = () => setWorkerAlertHeight(alert.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(alert);
    return () => observer.disconnect();
  }, [showWorkerAlert]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('cloud-theme', theme);
    } catch {}
  }, [theme]);
  return (
    <div className={page === 'board' || page === 'cases' || page === 'project' || page === 'directory' ? 'cloud-workspace' : 'min-h-screen min-w-0'} data-ui="cloud-shell">
      <a className="absolute -top-16 left-3 z-50 rounded-md bg-card px-4 py-2 shadow-lg transition-all focus:top-3" href="#content" data-ui="skip">
        跳至内容
      </a>
      <WorkspaceHeader directory={directory} user={me} shared={shared} page={page} theme={theme} toggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <main className={`grid w-full min-w-0 content-start px-4 pb-6 max-sm:px-3 max-sm:pb-4 ${isReportPage ? 'gap-2 pt-2' : 'gap-3 pt-4 max-sm:pt-3'}`} id="content" tabIndex={-1} data-ui="cloud-content">
        {path.startsWith('/requests/') && (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground [&_b]:font-medium [&_code]:truncate" data-ui="crumb">
            <Link {...boardDestination(targetId)}>执行看板</Link>
            <span className="mx-1.5 font-normal text-muted-foreground" data-ui="sep">/</span>
            <code title={path.split('/').pop()}>
              {path.split('/').pop()?.slice(0, 12)}
            </code>
          </div>
        )}
        <TeamContext.Provider value={{ user: me, directory, workers }}>
          {children}
        </TeamContext.Provider>
      </main>
      <Toaster theme={theme} bottomOffset={showWorkerAlert ? 24 + workerAlertHeight : 16} />
      {showWorkerAlert && (
        <Alert asChild className="fixed right-4 bottom-4 z-30 max-w-[calc(100%-2rem)] bg-warn-bg text-warn-ink shadow-md" data-ui="worker-connection-alert">
          <div ref={workerAlertRef}>
            <Icon name="alert" />
            <span className="font-medium">暂无正常连接的 Worker</span>
            <Button asChild size="sm" className="ml-auto pointer-coarse:min-h-9">
              <Link to="/workers" search={{ targetId }}>{me?.role === 'admin' ? '设置 Worker' : '查看 Worker 主机'}</Link>
            </Button>
          </div>
        </Alert>
      )}
    </div>
  );
}

function Overview() {
  const {data,error}=useData<{items: BoardRequest[];total:number;queue:string[]}>('/api/requests?limit=8',3000);
  const {data:targets}=useData<Array<Pick<Project, 'id' | 'name'>>>('/api/targets');
  const workers = useContext(TeamContext)!.workers.data;
  return <><PageTitle title="运行概览" eyebrow="TEAM OVERVIEW"/>
      <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-sm:gap-2.5 [&>div>span]:text-xs [&>div>span]:text-muted-foreground [&_strong]:text-2xl [&_strong]:font-semibold [&_strong]:tabular-nums" data-ui="stats">
          <Card className="grid gap-1 p-3">
            <span>等待执行</span>
            <strong>{data?.queue.length ?? '—'}</strong>
            <small>按提交顺序调度</small>
          </Card>
          <Card className="grid gap-1 p-3">
            <span>正在执行</span>
            <strong>
              {workers
                ?.flatMap((w) => w.slots)
                .filter((s) => s.state === 'busy').length ?? '—'}
            </strong>
            <small>设备独占，避免任务冲突</small>
          </Card>
          <Card className="grid gap-1 p-3">
            <span>可用槽位</span>
            <strong>
              {workers
                ?.filter((w) => !w.paused && w.health === 'healthy')
                .flatMap((w) => w.slots)
                .filter((s) => s.state === 'idle').length ?? '—'}
            </strong>
            <small>专用模拟器</small>
          </Card>
          <Card className="grid gap-1 p-3">
            <span>累计任务</span>
            <strong>{data?.total ?? '—'}</strong>
            <small>原始结果与证据留存</small>
          </Card>
        </div>
      <OverviewActivity workers={workers} /><h2>最近运行</h2><ErrorBox error={error}/><TestBoard items={data?.items ?? []} queue={data?.queue ?? []} targets={targets ?? []} loading={!data && !error}/></>;
}
function Reports() {
  const targetId = useWorkspaceProjectId();
  return <ReportList key={targetId ?? ''} targetId={targetId} />;
}

function ReportList({ targetId }: { targetId?: string }) {
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ offset: String(offset), ...(targetId && { targetId }) });
  const { data, error, reload } = useData<{
    items: Array<{ id: string; title: string; sha: string; projectName: string; createdAt: number }>;
    hasMore: boolean;
  }>(`/api/reports?${params}`, 5000);
  return <section className="project-directory">
    <h1>测试报告</h1>
    {error && <div role="alert">{error} <Button onClick={reload}>重试</Button></div>}
    {!data && !error && <p role="status">正在加载报告…</p>}
    {data && <>
      {!data.items.length && <Empty>暂无已发布的报告</Empty>}
      <div>{data.items.map(report => <Link className="report-entry" key={report.id} to="/reports/$id" params={{ id: report.id }} search={{ targetId }}>
        <Icon name="doc" />
        <span><strong>{report.title}</strong><small>{report.projectName} · {report.sha.slice(0, 8)}</small></span>
        <time>{time(report.createdAt)}</time>
      </Link>)}</div>
      {(offset > 0 || data.hasMore) && <div className="flex gap-2">
        <Button variant="outline" disabled={!offset} onClick={() => setOffset(offset - 25)}>上一页</Button>
        <Button variant="outline" disabled={!data.hasMore} onClick={() => setOffset(offset + 25)}>下一页</Button>
      </div>}
    </>}
  </section>;
}
function OverviewActivity({ workers }: { workers?: ExecutionWorker[] }) {
  return (
    <>
      <Card asChild>
        <section className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 [&_h2]:text-xs max-[900px]:flex-wrap" data-ui="panel-head">
            <h2>设备与 Worker</h2>
            <span className="text-xs text-muted-foreground" data-ui="sub">{workers?.length ?? '—'} 台执行机</span>
            <div className="ml-auto flex flex-wrap items-center gap-2" data-ui="right">
              <Button asChild variant="secondary" size="sm">
                <Link to="/workers">全部设备</Link>
              </Button>
            </div>
          </div>
          <div className="p-3 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3 max-sm:grid-cols-1" data-ui="panel-body grid-3">
            {workers?.map((w) => (
              <div className="grid gap-3 text-xs [&_[data-slot=badge]]:ml-auto [&_span]:break-words" key={w.id} data-ui="device-overview">
                <div className="flex min-w-0 items-center gap-2.5" data-ui="rowline">
                  <Icon name="cpu" />
                  <b>{w.id}</b>
                  <Badge value={w.health} />
                </div>
                {w.slots.map((slot) => (
                  <div className="flex min-w-0 items-center gap-2.5" key={slot.id} data-ui="rowline">
                    <Icon name="device" />
                    <span>{slot.deviceId}</span>
                    <Badge value={slot.state} />
                  </div>
                ))}
              </div>
            ))}
            {!workers?.length && <p className="text-xs leading-[1.45] text-muted-foreground">尚无设备信息。</p>}
          </div>
        </section>
      </Card>
    </>
  );
}
function RequestAction({
  request,
  onChange,
}: {
  request: Detail;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const finished = terminal(request.state);
  async function action() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string }>(
        `/api/requests/${request.id}/${finished ? 'rerun' : 'cancel'}`,
        'POST',
        undefined,
        finished ? crypto.randomUUID() : undefined,
      );
      if (finished)
        await navigate({ to: '/requests/$id', params: { id: result.id } });
      else onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant={finished ? 'secondary' : 'destructive'}
        size="default"
        disabled={busy || request.state === 'cancel_requested'}
        onClick={action}
      >
        <Icon name={finished ? 'refresh' : 'x'} />
        {busy ? '处理中…' : finished ? '重新运行' : '取消任务'}
      </Button>
      <ErrorBox error={error} />
    </>
  );
}
function RequestDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const targetId = useWorkspaceProjectId();
  const { data: r, error, reload } = useData<Detail>(`/api/requests/${id}`, 2000);
  const latest = r?.attempts[r.attempts.length - 1];
  const report = r?.reports.filter((p) => p.state === 'published').at(-1);
  const reportId =
    r && report && (terminal(r.state) || report.attemptId === latest?.attemptId)
      ? report.id
      : undefined;
  useEffect(() => {
    if (reportId)
      void navigate({
        to: '/reports/$id',
        params: { id: reportId },
        replace: true,
      });
  }, [navigate, reportId]);
  if (reportId) return <Empty>正在打开测试报告…</Empty>;
  return (
    <>
      <ErrorBox error={error} />
      {!r && !error && <Empty>正在加载任务状态…</Empty>}
      {r && (
        <>
          <Card asChild>
            <section className="grid gap-2.5 p-3" data-ui="sum">
              <div className="flex flex-wrap items-start gap-4" data-ui="sum-top">
                <div className="grid min-w-0 gap-1 [&_h1]:flex [&_h1]:flex-wrap [&_h1]:items-center [&_h1]:gap-2 [&_h1]:text-lg" data-ui="sum-title">
                  <h1>
                    {r.selection?.titlePath?.join(' › ') || r.input.suite}
                    <span className="font-mono text-xs font-medium text-muted-foreground" title={id} data-ui="id">
                      #{id.slice(0, 8)}
                    </span>
                  </h1>
                  <p className="text-xs text-muted-foreground" data-ui="sub">
                    {r.input.targetId} · {r.input.suite}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2 max-[900px]:ml-0 max-[900px]:w-full" data-ui="sum-acts">
                  <Badge value={r.state} />
                  <Badge value={r.verdict} />
                  <Button asChild variant="secondary">
                    <Link {...boardDestination(targetId)}>
                      <Icon name="list" />
                      返回测试任务
                    </Link>
                  </Button>
                  <RequestAction request={r} onChange={reload} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" role="status" data-ui="execution-status">
                <span>
                  {terminal(r.state)
                    ? labels[r.state]
                    : stageLabel(latest?.stage)}
                </span>
                {latest && <span>执行 #{latest.number}</span>}
                {r.queuePosition > 0 && <span>队列第 {r.queuePosition} 位</span>}
                <code title={r.input.commit}>{r.input.commit.slice(0, 8)}</code>
                <span>{time(r.createdAt)}</span>
              </div>
            </section>
          </Card>
          {latest?.outcome?.error && (
            <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2.5 text-xs text-secondary-foreground [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_b]:text-foreground [&_code]:rounded-sm [&_code]:bg-card [&_code]:px-1.5 bg-warn-bg text-warn-ink" role="alert" data-ui="note warn">
              <Icon name="alert" />
              {latest.outcome.error}
            </div>
          )}
          <WorkerExecutionTimeline requestId={id} attempts={r.attempts} />
          <Card asChild>
            <section className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 [&_h2]:text-xs max-[900px]:flex-wrap" data-ui="panel-head">
                <h2>测试报告</h2>
              </div>
              <Empty>
                {terminal(r.state)
                  ? '此运行没有已发布的报告。可查看执行尝试与运行动态了解原因。'
                  : '任务执行中，报告发布后将自动打开测试报告。'}
              </Empty>
            </section>
          </Card>
          <RequestDiagnostics request={r} />
        </>
      )}
    </>
  );
}
function DiagnosticSection({
  title,
  className,
  'data-ui': dataUi,
  embedded,
  open,
  children,
}: {
  title: string;
  className: string;
  'data-ui'?: string;
  embedded: boolean;
  open?: boolean;
  children: ReactNode;
}) {
  return embedded ? (
    <section data-ui={`${dataUi} diagnostic-section`} className={`${className} [&>h3]:mb-3 [&>h3]:text-xs [&>h3]:font-semibold`}>
      <h3>{title}</h3>
      {children}
    </section>
  ) : (
    <details data-ui={dataUi} className={className} open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
function RequestDiagnostics({
  request: r,
  currentReportId,
  panel,
}: {
  request: Detail;
  currentReportId?: string;
  panel?: 'run' | 'attempts' | 'events';
}) {
  const id = r.id;
  const latest = r.attempts[r.attempts.length - 1];
  const published = r.reports.filter((p) => p.state === 'published');
  const [events, setEvents] = useState<
    Array<{
      seq: number;
      kind: string;
      at: number;
      data: Record<string, unknown>;
    }>
  >([]);
  const [eventSearch, setEventSearch] = useState('');
  const [streamState, setStreamState] = useState('连接中');
  useEffect(() => {
    if (panel && panel !== 'events') return;
    const stream = new EventSource(`/api/requests/${id}/events`);
    stream.onopen = () => setStreamState('已连接');
    stream.onerror = () => setStreamState('连接中断，正在重连');
    stream.onmessage = (e) => {
      try {
        const value = JSON.parse(e.data);
        setEvents((old) =>
          old.some((v) => v.seq === value.seq)
            ? old
            : [...old, value].slice(-500),
        );
      } catch {}
    };
    return () => stream.close();
  }, [id, panel]);
  return (
    <>
      {(!panel || panel === 'run') && (
        <DiagnosticSection
          className={panel ? '' : 'rounded-lg bg-card px-3 py-2.5 shadow-sm'}
          title="运行信息"
          embedded={!!panel} data-ui="run-info"
        >
          {published.length > 1 && (
            <div className={`flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground [&>[data-slot=native-select-wrapper]]:max-w-80 ${panel ? 'mb-3' : ''}`} data-ui="report-switch">
              <span>执行报告</span>
              {published.map((report) => (
                <Link
                  key={report.id}
                  to="/reports/$id"
                  params={{ id: report.id }}
                  aria-current={
                    report.id === currentReportId ? 'page' : undefined
                  }
                >
                  执行 #
                  {r.attempts.find((a) => a.attemptId === report.attemptId)
                    ?.number ?? '—'}
                </Link>
              ))}
            </div>
          )}
          <div className={`grid gap-3 ${panel ? 'grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))]' : 'grid-cols-3 max-[900px]:grid-cols-2'}`} data-ui="meta-grid">
            {[
              ['来源', r.source?.kind ?? 'manual'],
              ['配置 / 目录版本', `${r.configRevision ?? '—'} / ${r.catalogId ?? '—'}`],
              ['测试选择', r.selection?.mode === 'case' ? r.selection.titlePath?.join(' › ') ?? r.selection.caseId ?? '—' : 'suite'],
              ['自动策略版本', String(r.autoPolicyRevision ?? '—')],
              ['替代任务', r.supersededBy ?? '—'],
              ['场景', r.input.scenario ?? '直接运行'],
              ['应用 / 套件', `${r.input.targetId} / ${r.input.suite}`],
              ['分支', r.input.source?.branch ?? '—'],
              ['Commit', r.input.commit],
              ['发起人', r.actor],
              ['提交时间', time(r.createdAt)],
              [
                'Worker / 槽位',
                latest
                  ? `${latest.workerId} / ${latest.slotId}`
                  : '等待分配',
              ],
            ].map(([label, value]) => (
              <div className="grid min-w-0 gap-1" key={label} data-ui="meta-cell">
                <span className="text-[11px] text-muted-foreground" data-ui="k">{label}</span>
                <span className={`text-xs font-medium ${panel ? 'wrap-anywhere' : 'truncate'}`} title={value} data-ui="v">
                  {value}
                </span>
              </div>
            ))}
          </div>
          {r.input.source?.pipelineUrl &&
            /^https?:/.test(r.input.source.pipelineUrl) && (
              <a
                className="mt-3 inline-block text-xs"
                href={r.input.source.pipelineUrl}
                target="_blank"
                rel="noreferrer"
              >
                GitLab Pipeline ↗
              </a>
            )}
        </DiagnosticSection>
      )}
      {(!panel || panel === 'attempts') && (
        <DiagnosticSection
          className={panel ? '' : 'overflow-hidden [&>summary]:px-3 [&>summary]:py-2.5 open:[&>summary]:mb-0'}
          title={`执行尝试 · ${r.attempts.length} 次`}
          embedded={!!panel}
          open={!published.length} data-ui="execution-attempts"
        >
          {r.attempts.length ? (
            r.attempts.map((a) => (
              <div
                className={`grid gap-3 border-t border-border py-2.5 text-xs [&>div]:grid [&>div]:min-w-0 [&>div]:justify-items-start [&>div]:gap-1 [&_code]:text-[10px] [&_code]:text-muted-foreground ${panel
                  ? 'grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] items-start wrap-anywhere'
                  : 'grid-cols-[1.2fr_1fr_1fr_1fr] items-center px-3 max-[900px]:grid-cols-2'}`}
                key={a.attemptId}
                data-ui="attempt-row"
              >
                <div>
                  <b>执行 #{a.number}</b>
                  <small>
                    {a.workerId} / {a.slotId}
                  </small>
                  <code>{a.attemptId}</code>
                </div>
                <div>
                  <span className="text-xs leading-[1.45] text-muted-foreground">执行阶段</span>
                  <b>{stageLabel(a.stage)}</b>
                  <small>generation {a.generation}</small>
                </div>
                <div>
                  <Badge
                    value={
                      a.outcome?.verdict ?? a.result?.verdict ?? 'unknown'
                    }
                  />
                  <small>{a.outcome?.error ?? a.result?.error}</small>
                </div>
                <div>
                  <span className="text-xs leading-[1.45] text-muted-foreground">清理 / 发布</span>
                  <small>
                    {a.outcome
                      ? `${labels[a.outcome.cleanup]} · ${labels[a.outcome.publication]}`
                      : '等待完成'}
                  </small>
                  <small>
                    {a.finishedAt
                      ? `完成于 ${time(a.finishedAt)}`
                      : `租约至 ${time(a.expiresAt)}`}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <Empty>任务尚未分配。</Empty>
          )}
        </DiagnosticSection>
      )}
      {(!panel || panel === 'events') && (
        <DiagnosticSection
          className={panel ? '' : 'overflow-hidden rounded-lg bg-card px-3 py-2.5 shadow-sm'}
          title={panel ? '运行动态' : `运行动态 · 最近 ${events.length} 条`}
          embedded={!!panel} data-ui="runtime-events"
        >
          <div className={`flex items-center gap-2 border-b border-border pb-2.5 ${panel ? 'flex-wrap' : 'max-[900px]:flex-wrap'}`} data-ui="panel-head">
            <span className="text-xs text-muted-foreground" data-ui="sub">
              最近 {events.length} 条 · {streamState}
            </span>
            <div className="ml-auto min-w-0" data-ui="right">
              <Input
                aria-label="筛选运行动态"
                placeholder="筛选阶段 / 日志"
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
              />
            </div>
          </div>
          <div className={panel ? undefined : 'max-h-[380px] overflow-auto'} data-ui="event-list">
            {events.length ? (
              events
                .filter((e) =>
                  `${e.kind} ${text(e.data)}`
                    .toLowerCase()
                    .includes(eventSearch.toLowerCase()),
                )
                .map((e) => (
                  <div
                    className={`grid gap-3 border-b border-border py-2 text-xs [&_time]:font-mono [&_time]:text-[11px] [&_time]:text-muted-foreground [&_pre]:text-[11px] [&_b]:wrap-anywhere ${panel
                      ? 'grid-cols-[auto_minmax(0,1fr)] [&_pre]:col-span-full'
                      : 'grid-cols-[80px_120px_minmax(0,1fr)] px-3 max-sm:grid-cols-[70px_minmax(0,1fr)] max-sm:[&_pre]:col-span-full'}`}
                    key={e.seq}
                    data-ui="event"
                  >
                    <time>
                      {new Date(e.at).toLocaleTimeString('zh-CN')}
                    </time>
                    <b>
                      {e.kind === 'stage'
                        ? stageLabel(text(e.data.stage))
                        : e.kind}
                    </b>
                    <pre>
                      {e.kind === 'log'
                        ? text(e.data.text)
                        : JSON.stringify(e.data, null, 2)}
                    </pre>
                  </div>
                ))
            ) : (
              <Empty>暂无运行事件。</Empty>
            )}
          </div>
        </DiagnosticSection>
      )}
    </>
  );
}
function reportAttemptSearch(search: Record<string, unknown>): { testId?: string; attemptId?: string } {
  return {
    testId: typeof search.testId === 'string' ? search.testId : undefined,
    attemptId: typeof search.attemptId === 'string' ? search.attemptId : undefined,
  };
}

function ReportAttemptPicker({
  id,
  runId,
  shared,
  attempts,
  selected,
  onSelect,
}: {
  id: string;
  runId: string;
  shared: boolean;
  attempts: ReportView['tests'];
  selected: ReportView['tests'][number] | undefined;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selectedRef = useRef<HTMLAnchorElement>(null);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  useEffect(() => setOpen(false), [selected]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useLayoutEffect(() => {
    const list = listRef.current;
    const link = selectedRef.current;
    if (!list || !link) return;
    const bottom = link.offsetTop + link.offsetHeight;
    if (link.offsetTop < list.scrollTop) list.scrollTop = link.offsetTop;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [open, selected]);

  return (
    <div ref={pickerRef} className="relative min-w-0" data-ui="report-attempt-picker"
      onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}>
      <h1 className="min-w-0 font-mono text-sm font-semibold">
        <button type="button" ref={triggerRef} aria-expanded={open} aria-controls={open ? menuId : undefined}
          aria-label={`${runId}，选择用例执行记录`} title={runId}
          className="flex min-h-7 max-w-full items-center gap-1.5 rounded-md pr-1 text-left hover:bg-muted aria-expanded:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-9"
          onClick={() => setOpen(value => !value)}>
          <span className="min-w-0 truncate">{runId}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </h1>
      {open && (
        <nav id={menuId} aria-label="测试用例执行记录" data-ui="report-attempts"
          className="absolute top-full left-0 z-30 mt-1.5 w-[min(26rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
          <ul ref={listRef} className="relative m-0 grid max-h-[min(55dvh,22rem)] list-none gap-0.5 overflow-y-auto overscroll-contain p-0">
            {attempts.map((attempt) => {
              const { testId, attemptId, result } = attempt;
              const current = attempt === selected;
              const name = text(result.testName ?? testId);
              return (
                <li key={JSON.stringify([testId, attemptId])} className="min-w-0">
                  <Link
                    to={shared ? '/shared/reports/$id' : '/reports/$id'}
                    params={{ id }}
                    search={{ testId, attemptId }}
                    activeOptions={{ exact: true }}
                    aria-current={current ? 'page' : undefined}
                    ref={current ? selectedRef : undefined}
                    className="flex min-h-7 items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-accent pointer-coarse:min-h-9"
                    onClick={(event) => {
                      if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                        close();
                        onSelect();
                      }
                    }}
                  >
                    <span className="min-w-0 flex-1 font-medium wrap-anywhere">{name}</span>
                    <code className="shrink-0 whitespace-nowrap text-muted-foreground">{attemptId}</code>
                    <Badge value={text(result.status ?? 'unknown')} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}

function ReportContent({
  id,
  selection: { testId, attemptId },
  shared = false,
}: {
  id: string;
  selection: ReturnType<typeof reportAttemptSearch>;
  shared?: boolean;
}) {
  const targetId = useWorkspaceProjectId();
  const [reportView, setReportView] = useState('tests');
  useEffect(() => setReportView('tests'), [testId, attemptId]);
  const prefix = shared ? '/api/shared/reports' : '/api/reports';
  const { data: r, error } = useData<ReportView>(`${prefix}/${id}`);
  const { data: request, error: requestError, reload } = useData<Detail>(
    `/api/requests/${r?.requestId}`,
    2000,
    !shared && !!r,
  );
  const executionAttemptId = shared ? undefined : r?.executionAttemptId;
  const hasSelection = testId !== undefined || attemptId !== undefined;
  const attempt = hasSelection
    ? r?.tests.find((item) => item.testId === testId && item.attemptId === attemptId)
    : r?.tests[0];
  const missingAttempt = hasSelection && !attempt;
  return (
    <>
      <header className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5" data-ui="report-header">
        <div className="flex min-w-0 flex-auto flex-wrap items-center gap-x-3 gap-y-1" data-ui="report-heading">
          <div className="flex min-w-0 items-center gap-2" data-ui="report-identity">
            {r?.tests.length ? (
              <ReportAttemptPicker id={id} runId={r.manifest.runId} shared={shared} attempts={r.tests} selected={attempt} onSelect={() => setReportView('tests')} />
            ) : (
              <h1 className="min-w-0 font-mono text-sm font-semibold wrap-anywhere" title={r?.manifest.runId}>{r?.manifest.runId ?? id}</h1>
            )}
            {r && (
              <span className="inline-flex shrink-0 items-center">
                <span className="sr-only">测试结果：</span>
                <Badge value={r.manifest.status} />
              </span>
            )}
          </div>
          {r && (
            <dl className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs [&>div]:flex [&>div]:items-baseline [&>div]:gap-1 [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:tabular-nums" data-ui="report-metadata">
              <div>
                <dt>证据完整性</dt>
                <dd>{labels[r.manifest.evidenceStatus]}</dd>
              </div>
              <div>
                <dt>保留至</dt>
                <dd>
                  <time dateTime={new Date(r.expiresAt).toISOString()}>
                    {time(r.expiresAt)}
                  </time>
                </dd>
              </div>
            </dl>
          )}
        </div>
        {!shared && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            {executionAttemptId && (
              <Tabs value={reportView} onValueChange={setReportView} data-ui="report-view-tabs">
                <TabsList className="h-7 max-[420px]:[&_svg]:hidden pointer-coarse:h-9" aria-label="报告视图">
                  <TabsTrigger value="tests"><Icon name="play" />测试回放</TabsTrigger>
                  <TabsTrigger value="worker"><Icon name="cpu" />Worker 执行</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 [&>[role=alert]]:basis-full [&>[role=alert]]:wrap-anywhere pointer-coarse:[&_[data-slot=button]]:min-h-9" data-ui="rowline">
              <Button asChild variant="secondary" className="max-[420px]:w-7 max-[420px]:px-0 pointer-coarse:min-w-9">
                <Link {...boardDestination(targetId)} title="返回测试任务">
                  <ArrowLeft aria-hidden="true" />
                  <span className="max-[420px]:sr-only">返回测试任务</span>
                </Link>
              </Button>
              {request && <RequestAction request={request} onChange={reload} />}
            </div>
          </div>
        )}
      </header>
      <ErrorBox error={error} />
      {!r && !error && <Empty>正在加载报告…</Empty>}
      {r && (
        <>
          {r.issues.length > 0 && (
            <details className="break-words rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive" data-ui="evidence-issues">
              <summary>有 {r.issues.length} 项证据不可用</summary>
              {r.issues.map((issue, i) => (
                <p key={i}>{issue}</p>
              ))}
            </details>
          )}
          {r.manifest.runnerErrors?.map((e, i) => (
            <div className="break-words rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive" key={i} data-ui="error">
              {e.phase}: {e.message}
            </div>
          ))}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col [&[hidden]]:hidden" hidden={!!executionAttemptId && reportView === 'worker'} data-ui="report-view-pane">
            {missingAttempt ? (
              <ErrorBox error="该报告中找不到链接指定的用例执行记录。" />
            ) : (
              <Replay
                key={attempt && JSON.stringify([attempt.testId, attempt.attemptId])}
                report={r}
                attempt={attempt}
                shared={shared}
                active={shared || reportView === 'tests'}
                reportTabs={shared ? [] : [
                  ...([
                    ['run', '运行信息', 'doc'],
                    ['attempts', '执行尝试', 'refresh'],
                    ['events', '运行动态', 'clock'],
                  ] as const).map(([panel, label, icon]) => ({
                    id: `report-${panel}`,
                    label,
                    icon,
                    content: (
                      <>
                        <ErrorBox error={requestError} />
                        {request ? (
                          <RequestDiagnostics
                            request={request}
                            currentReportId={id}
                            panel={panel}
                          />
                        ) : !requestError && <Empty>正在加载运行信息…</Empty>}
                      </>
                    ),
                  })),
                  {
                    id: 'report-share',
                    label: '报告分享',
                    icon: 'link',
                    content: <Shares id={id} />,
                  },
                ]}
              />
            )}
          </div>
          {executionAttemptId && <div className="min-h-0 flex-1 overflow-y-auto [&[hidden]]:hidden" hidden={reportView !== 'worker'} data-ui="report-worker-pane">
            <WorkerExecutionTimeline requestId={r.requestId} executionAttemptId={executionAttemptId} />
          </div>}
        </>
      )}
    </>
  );
}
function Shares({ id }: { id: string }) {
  const {
    data: shares,
    error: loadError,
    reload,
  } = useData<
    Array<{ id: string; expiresAt: number; revoked: number; sensitive: number }>
  >(`/api/reports/${id}/shares`);
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [sensitive, setSensitive] = useState(false),
    [days, setDays] = useState(1);
  async function create() {
    try {
      const share = await api<{ url: string }>(
        `/api/reports/${id}/shares`,
        'POST',
        { ttlMs: days * 86400000, sensitive },
      );
      setUrl(share.url);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="grid min-w-0 gap-3" data-ui="share-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2.5" data-ui="panel-heading">
        <h2>报告分享</h2>
        <span className="text-muted-foreground">只读 · 可撤销 · 内网访问</span>
      </div>
      <ErrorBox error={error || loadError} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-ui="share-controls">
        <NativeSelect
          aria-label="分享有效期"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={1}>有效期 1 天</option>
          <option value={3}>有效期 3 天</option>
          <option value={7}>有效期 7 天</option>
        </NativeSelect>
        <Label className="flex min-w-0 max-w-full items-start gap-2 text-muted-foreground">
          <Checkbox
            className="mt-0.5"
            checked={sensitive}
            onCheckedChange={(checked) => setSensitive(checked === true)}
          />
          <span className="min-w-0 wrap-anywhere">包含日志、源码及 Trace（可能含敏感数据）</span>
        </Label>
        <Button variant="default" size="default" onClick={create}>
          生成分享链接
        </Button>
      </div>
      {url && (
        <Label className="grid min-w-0 gap-1.5" data-ui="share-url">
          分享链接
          <Input
            className="font-mono"
            aria-label="分享链接"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <small>链接只显示一次；有效期不会超过报告保留时间。</small>
        </Label>
      )}
      {!!shares?.length && (
        <div>
          {shares.map((s) => (
            <div className="flex items-center gap-3 border-t border-border py-2" key={s.id} data-ui="share-row">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <code>{s.id.slice(0, 8)}</code>
                <span>{time(s.expiresAt)}</span>
                <span>
                  {s.revoked
                    ? '已撤销'
                    : s.expiresAt < Date.now()
                      ? '已过期'
                      : s.sensitive
                        ? '完整范围'
                        : '步骤与截图'}
                </span>
              </div>
              <Button
                variant="secondary"
                size="default"
                disabled={!!s.revoked}
                onClick={async () => {
                  try {
                    await api(`/api/shares/${s.id}`, 'DELETE');
                    reload();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                撤销
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function WorkerRow({ worker, canOperate, onSchedulingChange, projects }: {
  worker: WorkerStatusResponse;
  canOperate: boolean;
  onSchedulingChange: (paused: boolean) => void;
  projects?: Project[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { id, health, paused, inventory, slots, service, catalogScannerConnected } = worker;
  const needsAttention = service && (service.status !== 'healthy' || service.activeSessions > 1 || (service.catalogWorkspace && service.catalogWorkspace.directoryCount !== 0));
  async function toggleScheduling() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ paused: boolean }>(`/api/workers/${encodeURIComponent(id)}/pause`, 'POST', { paused: !paused });
      onSchedulingChange(result.paused);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <li className="min-w-0">
    <div className="grid items-center gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-[minmax(11rem,1fr)_auto] lg:grid-cols-[minmax(12rem,1fr)_minmax(8rem,.5fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Monitor className="size-5" /></span>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all text-sm font-semibold">{id}</h3><Badge value={health} /></div>
          {worker.seenAt > 0 && <p className="mt-1 text-xs text-muted-foreground">最近联系 {time(worker.seenAt)}</p>}
        </div>
      </div>
      <div className="text-xs"><p className="font-medium">{paused ? '已暂停调度' : '允许领取任务'}</p><p className="mt-1 text-muted-foreground">{inventory ? `${inventory.devices.length} 台设备${inventory.stale ? '（检测已过期）' : ''}` : '等待设备上报'} · {slots.length} 个槽位</p><p className="mt-1 text-muted-foreground">{catalogScannerConnected === undefined ? '扫描服务状态未知' : catalogScannerConnected ? '扫描服务已连接' : '扫描服务未连接'}</p></div>
      <div className="flex flex-wrap items-center gap-1 sm:col-span-2 lg:col-span-1">
        <Button asChild variant="secondary"><Link to="/devices" search={{ worker: id }}>查看设备<ArrowUpRight /></Link></Button>
        {canOperate && <Button variant="ghost" disabled={busy} title="暂停后，正在执行的任务会继续运行" onClick={() => void toggleScheduling()}>{paused ? <Play /> : <Pause />}{paused ? '恢复调度' : '暂停调度'}</Button>}
        <Button variant="ghost" aria-expanded={expanded} aria-controls={`worker-detail-${id}`} onClick={() => setExpanded(!expanded)}>{expanded ? '收起详情' : '主机详情'}<ChevronDown className={expanded ? 'rotate-180' : ''} /></Button>
      </div>
    </div>
    {needsAttention && <p className="mx-4 mb-3 flex items-center gap-2 text-xs text-warn-ink"><TriangleAlert className="size-4" />{service.status !== 'healthy' ? serviceStatusLabels[service.status] : service.activeSessions > 1 ? '检测到多个服务实例' : '扫描目录需要检查'}</p>}
    {error && <div className="mx-4 mb-3"><ErrorBox error={error} /></div>}
    <div id={`worker-detail-${id}`} hidden={!expanded}>{expanded && <WorkerHostDetails worker={worker} canOperate={canOperate} projects={projects} />}</div>
  </li>;
}
function Workers() {
  const { user, directory, workers } = useContext(TeamContext)!;
  const role = user?.role;
  const canOperate = role === 'operator' || role === 'admin';
  const { data, error, update } = workers;
  return <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-5 py-2 sm:px-3">
    <PageTitle eyebrow="EXECUTION WORKERS" title="Worker 主机"><WorkerPairing role={role} workers={data} /></PageTitle>
    <ErrorBox error={error} />
    <Card asChild><section aria-label="主机列表" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"><h2 className="text-sm font-semibold">主机列表</h2>
        {data && <span className="text-xs text-muted-foreground">{data.filter(w => w.health === 'healthy').length} 台在线 / 共 {data.length} 台</span>}
      </header>
      {!data && !error && <p role="status" className="p-4 text-muted-foreground">正在读取主机…</p>}
      {data?.length === 0 && <Empty><Monitor /><h3>尚无 Worker 主机</h3>{role !== 'admin' && <p>请联系管理员添加主机。</p>}</Empty>}
      <ul className="divide-y">{data?.map(worker => <WorkerRow key={worker.id} worker={worker} canOperate={canOperate} projects={directory.data} onSchedulingChange={paused => update(rows => rows?.map(row => row.id === worker.id ? { ...row, paused } : row))} />)}</ul>
    </section></Card>
  </div>;
}
function ShareExchange() {
  const [error, setError] = useState('');
  const [token] = useState(() => window.location.hash.slice(1));
  const navigate = useNavigate();
  useEffect(() => {
    // Remove the one-time credential from the address bar before exchanging it.
    void (async () => {
      await navigate({ to: '/share', hash: '', replace: true });
      if (!token) {
        setError('分享链接缺少授权信息，请使用完整链接。');
        return;
      }
      const result = await api<{ url: string }>('/api/share/exchange', 'POST', {
        token,
      });
      await navigate({ to: result.url, replace: true });
    })().catch((e) => setError(e.message));
  }, [navigate, token]);
  return (
    <>
      <PageTitle eyebrow="REPORT SHARING" title="打开分享报告" />
      <ErrorBox error={error} />
      {!error && <Empty>正在验证分享授权…</Empty>}
    </>
  );
}

function Shell() {
  const path = useLocation({ select: (location) => location.pathname });
  const shared = path.startsWith('/shared/') || path === '/share';
  return (
    <Layout shared={shared}>
      <Outlet />
    </Layout>
  );
}

const rootRoute = createRootRoute({
  component: Shell,
  search: { middlewares: [retainSearchParams(['targetId'])] },
  validateSearch: (search: Record<string, unknown>): { search?: string; createProject?: boolean; view?: string; v?: string; q?: string; state?: string; targetId?: string } => ({
    view: typeof search.view === 'string' ? search.view : undefined,
    v: typeof search.v === 'string' ? search.v : undefined,
    q: typeof search.q === 'string' ? search.q.slice(0,200) : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
    targetId: typeof search.targetId === 'string' ? search.targetId : undefined,
    createProject: search.createProject === true ? true : undefined,
    search:
      typeof search.search === 'string'
        ? search.search.slice(0, 200)
        : undefined,
  }),
  notFoundComponent: () => (
    <Empty>
      页面不存在。<Link to="/">返回看板</Link>
    </Empty>
  ),
});
const requestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/requests/$id',
  component: function RequestPage() {
    const { id } = requestRoute.useParams();
    return <RequestDetail key={id} id={id} />;
  },
});
const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports/$id',
  staticData: { workspacePage: 'reports' },
  validateSearch: reportAttemptSearch,
  component: function ReportPage() {
    const { id } = reportRoute.useParams();
    const selection = reportRoute.useSearch();
    return <ReportContent key={id} id={id} selection={selection} />;
  },
});
const sharedReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shared/reports/$id',
  validateSearch: reportAttemptSearch,
  component: function SharedReportPage() {
    const { id } = sharedReportRoute.useParams();
    const selection = sharedReportRoute.useSearch();
    return <ReportContent key={id} id={id} selection={selection} shared />;
  },
});
function ProjectsPage({ view }: { view?: ProjectView } = {}) {
    const team = useContext(TeamContext)!;
    const search = useSearch({ strict: false });
    const navigate = useNavigate();
    return <Projects directory={team.directory} role={team.user?.role} view={view} createRequested={search.createProject === true} creationHandled={() => {
      void navigate({ to: '.', search: (previous: { search?: string; createProject?: boolean }) => ({ ...previous, createProject: undefined }), replace: true });
    }} />;
}
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
});
const projectRoute = createRoute({
  getParentRoute: () => projectsRoute,
  path: '$projectId',
  search: { middlewares: [stripSearchParams<{ targetId?: string }>(['targetId'])] },
});
function redirectScopedBoard({ search }: { search: { targetId?: string; search?: string } }) {
  if (search.targetId) throw redirect({ ...boardDestination(search.targetId, search.search), replace: true });
}
const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    staticData: { workspacePage: 'board' },
    beforeLoad: redirectScopedBoard,
    component: QueueBoard,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/overview',
    component: Overview,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs',
    staticData: { workspacePage: 'board' },
    beforeLoad: redirectScopedBoard,
    component: QueueBoard,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/queue',
    staticData: { workspacePage: 'board' },
    beforeLoad: redirectScopedBoard,
    component: QueueBoard,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/reports',
    staticData: { workspacePage: 'reports' },
    beforeLoad: ({ search }) => {
      if (search.targetId) throw redirect({ ...reportsDestination(search.targetId), replace: true });
    },
    component: Reports,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/devices',
    validateSearch: deviceFilters,
    component: Devices,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/devices/$id',
    component: DeviceDetail,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/workers',
    component: Workers,
  }),
  projectsRoute.addChildren([
    createRoute({ getParentRoute: () => projectsRoute, path: '/', staticData: { workspacePage: 'directory' }, component: ProjectsPage }),
    projectRoute.addChildren([
      createRoute({
        getParentRoute: () => projectRoute,
        path: '/',
        staticData: { workspacePage: 'project' },
        beforeLoad: ({ params, search }) => {
          if (activeProjectView(search.view) === 'tests') {
            const { v, q, createProject } = search;
            throw redirect({ to: '/projects/$projectId/testcases', params, search: { v, q, createProject }, replace: true });
          }
        },
        component: ProjectsPage,
      }),
      createRoute({ getParentRoute: () => projectRoute, path: 'kanban', staticData: { workspacePage: 'board' }, component: QueueBoard }),
      createRoute({ getParentRoute: () => projectRoute, path: 'reports', staticData: { workspacePage: 'reports' }, component: Reports }),
      createRoute({ getParentRoute: () => projectRoute, path: 'testcases', staticData: { workspacePage: 'cases' }, component: () => <ProjectsPage view="tests" /> }),
    ]),
  ]),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/targets',
    staticData: { workspacePage: 'directory' },
    component: ProjectsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/share',
    component: ShareExchange,
  }),
  requestRoute,
  reportRoute,
  sharedReportRoute,
]);

export function createCloudRouter(
  history: RouterHistory = createBrowserHistory(),
) {
  return createRouter({ routeTree, history, scrollRestoration: true });
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    workspacePage?: WorkspacePage;
  }
  interface Register {
    router: ReturnType<typeof createCloudRouter>;
  }
}

export function App() {
  const [router] = useState(createCloudRouter);
  return <RouterProvider router={router} />;
}
