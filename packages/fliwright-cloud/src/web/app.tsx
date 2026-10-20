import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useSearch,
  type RouterHistory,
} from '@tanstack/react-router';
import { Badge as UiBadge } from './components/ui/badge.js';
import { Card } from './components/ui/card.js';
import { Label } from './components/ui/label.js';
import { Input } from './components/ui/input.js';
import { Button } from './components/ui/button.js';
import { NativeSelect } from './components/ui/native-select.js';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuTrigger,
  NavigationMenuContent,
  navigationMenuTriggerStyle,
} from './components/ui/navigation-menu.js';
import { Checkbox } from './components/ui/checkbox.js';
import { Textarea } from './components/ui/textarea.js';
import React, {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { ReportView } from '../ReportStore.js';
import type {
  ExecutionAttempt,
  ExecutionWorker,
  TestRequest,
} from '@fliwright/cloud-protocol';
import { Icon, stageLabel } from './ui.js';
import { Replay } from './Replay.js';
import { api, useData } from './data.js';
import { Devices, DeviceDetail, deviceFilters } from './Devices.js';
import { TestBoard } from './TestBoard.js';

type Target = {
  id: string;
  name: string;
  suites: string[];
  scenarios: string[];
};
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
  ['completed', 'cancelled', 'infrastructure_failed'].includes(state);
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
    <div role="alert" className="error">
      {error}
    </div>
  ) : null;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
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
    'NEW EXECUTION': '选择应用、固定的 Git 提交、测试套件与场景。',
    'EXECUTION WORKERS': '查看执行主机心跳、检测工具诊断与槽位容量。',
    'APPLICATION TARGETS': '管理已注册应用及其测试套件与场景。',
  };
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {descriptions[eyebrow] && (
          <p className="lede">{descriptions[eyebrow]}</p>
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
  const { data: me } = useData<{ name: string; role: string }>(
    '/api/me',
    0,
    !shared,
  );
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('cloud-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const path = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const [navigation, setNavigation] = useState('');
  const mainLinks = [
    ['/queue', '测试任务'],
  ] as const;
  const configurationLinks = [
    ['/devices', '设备管理', 'device', '管理测试设备与调度策略'],
    ['/workers', 'Worker 主机', 'cpu', '查看执行主机与槽位状态'],
    ['/targets', '应用配置', 'settings', '管理应用、测试套件与场景'],
    ['/reports', '测试报告', 'doc', '查看已归档的测试结果与证据'],
  ] as const;
  const current = path.startsWith('/requests/') || path === '/runs'
    ? '/queue'
    : path.startsWith('/devices/')
      ? '/devices'
      : path.startsWith('/reports/')
        ? '/reports'
        : path;
  const title = shared
    ? '分享报告'
    : ([...mainLinks, ...configurationLinks].find(([url]) => url === current)?.[1] ??
      '运行详情');
  const configurationActive = configurationLinks.some(([url]) => url === current);
  useEffect(() => setNavigation(''), [path]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('cloud-theme', theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)
      ) {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className={`cloud-shell${['/runs', '/queue', '/reports'].includes(path) ? ' cloud-shell-board' : ''}`}>
      <a className="skip" href="#content">
        跳至内容
      </a>
      <header className="app-header">
        <div className="topbar">
          <Link className="brand" to="/" aria-label="Fliwright Cloud 首页" disabled={shared}>
            <span className="brand-mark" aria-hidden="true">Fw</span>
            <span className="brand-name">Fliwright <span>Cloud</span></span>
          </Link>
          {shared ? (
            <span className="share-label">只读报告分享</span>
          ) : (
            <NavigationMenu
              aria-label="主导航"
              value={navigation}
              onValueChange={setNavigation}
              className="main-navigation shrink-0 flex-none"
            >
              <NavigationMenuList>
                {mainLinks.map(([url, label]) => (
                  <NavigationMenuItem key={url}>
                    <NavigationMenuLink
                      asChild
                      active={current === url}
                      className={navigationMenuTriggerStyle()}
                    >
                      <Link to={url}>{label}</Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                ))}
                <NavigationMenuItem value="configuration">
                  <NavigationMenuTrigger
                    className={configurationActive ? 'configuration-active bg-primary/10 text-primary' : undefined}
                  >
                    配置
                  </NavigationMenuTrigger>
                  <NavigationMenuContent className="w-[260px] md:w-[260px]">
                    <ul className="grid gap-1 p-2">
                      {configurationLinks.map(([url, label, icon, description]) => (
                        <li key={url}>
                          <NavigationMenuLink
                            asChild
                            active={current === url}
                            onSelect={() => setNavigation('')}
                          >
                            <Link
                              to={url}
                              className="configuration-link"
                              onClick={() => setNavigation('')}
                            >
                              <Icon name={icon} />
                              <span>
                                <b>{label}</b>
                                <small>{description}</small>
                              </span>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                      ))}
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          )}
          {!shared && (
            <form
              className="search"
              onSubmit={(event) => {
                event.preventDefault();
                const search = String(
                  new FormData(event.currentTarget).get('search') ?? '',
                ).slice(0, 200);
                void navigate({
                  to: '/queue',
                  search: { search: search || undefined },
                });
              }}
            >
              <Icon name="search" />
              <Label className="sr-only" htmlFor="global-search">
                搜索任务或报告
              </Label>
              <Input
                className="pl-9 pr-10"
                id="global-search"
                type="search"
                name="search"
                placeholder="搜索任务 / 报告"
                maxLength={200}
              />
              <kbd>/</kbd>
            </form>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
            title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </Button>
          {!shared && (
            <>
              <Button asChild variant="default" className="submit-test">
                <Link
                  to="/new"
                  aria-current={current === '/new' ? 'page' : undefined}
                >
                  <Icon name="plus" />
                  <span>提交测试</span>
                </Link>
              </Button>
              <span
                className="current-user"
                title={me ? `${me.name} · ${me.role}` : '未登录'}
              >
                <Icon name="user" />
                <span>{me?.name}</span>
              </span>
            </>
          )}
        </div>
      </header>
      <main className="cloud-content" id="content" tabIndex={-1}>
        {/\/(requests|reports)\//.test(path) && (
          <div className="crumb">
            {shared ? (
              <b>{title}</b>
            ) : (
              <Link to={current === '/reports' ? '/reports' : '/queue'}>
                {title}
              </Link>
            )}
            <span className="sep">/</span>
            <code title={path.split('/').pop()}>
              {path.split('/').pop()?.slice(0, 12)}
            </code>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function Requests({
  overview = false,
  reportsOnly = false,
  history = false,
}: {
  overview?: boolean;
  reportsOnly?: boolean;
  history?: boolean;
}) {
  const urlSearch = useSearch({
    strict: false,
    select: (search) => search.search ?? '',
  });
  const state = reportsOnly ? 'completed' : '';
  const [search, setSearch] = useState(urlSearch),
    [offset, setOffset] = useState(0),
    [target, setTarget] = useState('');
  useEffect(() => {
    setSearch(urlSearch);
    setOffset(0);
  }, [urlSearch]);
  const params = new URLSearchParams({
    limit: overview ? '8' : '25',
    offset: String(offset),
    ...(state ? { state } : {}),
    ...(search ? { search } : {}),
    ...(target ? { targetId: target } : {}),
  });
  const { data, error } = useData<{
    items: Array<Omit<TestRequest, 'target'>>;
    total: number;
    queue: string[];
  }>(`/api/requests?${params}`, 3000);
  const { data: targets } = useData<Target[]>('/api/targets');
  const { data: workers } = useData<ExecutionWorker[]>('/api/workers', 5000);
  return (
    <>
      {!history && (
        <PageTitle
          eyebrow={overview ? 'TEAM OVERVIEW' : reportsOnly ? 'TEST REPORTS' : 'EXECUTION QUEUE'}
          title={overview ? '概览' : reportsOnly ? '测试报告' : '测试任务'}
        >
          <Button asChild variant="default">
            <Link to="/new">
              <Icon name="plus" />
              提交测试
            </Link>
          </Button>
        </PageTitle>
      )}
      {overview && (
        <div className="stats [&>div>span]:text-xs [&>div>span]:text-muted-foreground [&_strong]:text-2xl [&_strong]:font-semibold [&_strong]:tabular-nums">
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
      )}
      {overview && <OverviewActivity />}
      <section className="request-board">
        <div className="panel-heading">
          <h2>
            {overview ? '最近运行' : '测试看板'}
          </h2>
          {!overview && (
            <div className="filters">
              <Input
                className="w-full sm:w-[240px]"
                aria-label="搜索任务"
                placeholder="搜索提交、分支或任务 ID"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
              />
              <NativeSelect
                aria-label="筛选应用"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">所有应用</option>
                {targets?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
        <ErrorBox error={error} />
        <div className="board-caption">
          <span>状态自动流转 · 点击卡片查看详情</span>
          <span>{data ? `本页 ${data.items.length} 条 · 共 ${data.total} 条` : error ? '加载失败，稍后自动重试' : '正在加载…'}</span>
        </div>
        {(data || !error) && <TestBoard
          items={data?.items ?? []}
          queue={data?.queue ?? []}
          targets={targets ?? []}
          loading={!data && !error}
          filtered={Boolean(search || target || offset)}
        />}
        {data?.total === 0 && !error && (
          <Empty>{search || target ? '没有匹配的测试，请调整筛选条件。' : '暂无测试任务，提交一次测试开始记录。'}</Empty>
        )}
        {!overview && data && (
          <div className="pagination">
            <span>第 {Math.floor(offset / 25) + 1} / {Math.max(1, Math.ceil(data.total / 25))} 页 · 列内数量为本页统计</span>
            <Button
              variant="secondary"
              size="default"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              上一页
            </Button>
            <Button
              variant="secondary"
              size="default"
              disabled={offset + 25 >= data.total}
              onClick={() => setOffset(offset + 25)}
            >
              下一页
            </Button>
          </div>
        )}
      </section>
      {overview && (
        <div className="callout">
          测试任务由平台统一排队。报告发布后可独立查看，不依赖 CI 工作目录。
        </div>
      )}
    </>
  );
}
function OverviewActivity() {
  const { data: workers } = useData<ExecutionWorker[]>('/api/workers', 5000);
  return (
    <>
      <Card asChild>
        <section className="overflow-hidden">
          <div className="panel-head">
            <h2>设备与 Worker</h2>
            <span className="sub">{workers?.length ?? '—'} 台执行机</span>
            <div className="right">
              <Button asChild variant="secondary" size="sm">
                <Link to="/workers">全部设备</Link>
              </Button>
            </div>
          </div>
          <div className="panel-body grid-3">
            {workers?.map((w) => (
              <div className="device-overview" key={w.id}>
                <div className="rowline">
                  <Icon name="cpu" />
                  <b>{w.id}</b>
                  <Badge value={w.health} />
                </div>
                {w.slots.map((slot) => (
                  <div className="rowline" key={slot.id}>
                    <Icon name="device" />
                    <span>{slot.deviceId}</span>
                    <Badge value={slot.state} />
                  </div>
                ))}
              </div>
            ))}
            {!workers?.length && <p className="hint">尚无设备信息。</p>}
          </div>
        </section>
      </Card>
    </>
  );
}
function NewRequest() {
  const navigate = useNavigate();
  const { data: targets, error: loadError } = useData<Target[]>('/api/targets');
  const [targetId, setTarget] = useState(''),
    [suite, setSuite] = useState(''),
    [scenario, setScenario] = useState(''),
    [commit, setCommit] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const target = targets?.find((t) => t.id === targetId) ?? targets?.[0];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string }>(
        '/api/requests',
        'POST',
        {
          targetId: target.id,
          commit,
          suite: suite || target.suites[0],
          scenario: scenario || target.scenarios[0],
        },
        crypto.randomUUID(),
      );
      await navigate({ to: '/requests/$id', params: { id: r.id } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="NEW EXECUTION" title="提交测试任务" />
      <Card asChild>
        <section className="form-panel overflow-hidden">
          <h2>选择测试配置</h2>
          <p>提交后进入队列，等待专用设备执行。</p>
          <ErrorBox error={loadError || error} />
          <form onSubmit={submit}>
            <Label>
              应用
              <NativeSelect
                value={target?.id ?? ''}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setSuite('');
                  setScenario('');
                }}
              >
                {targets?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              Git commit SHA
              <Input
                required
                pattern="[0-9a-f]{40}"
                placeholder="完整的 40 位提交 SHA"
                value={commit}
                onChange={(e) => setCommit(e.target.value.trim())}
              />
              <small>固定提交用于准确复现测试。</small>
            </Label>
            <div className="form-row">
              <Label>
                测试套件
                <NativeSelect
                  value={suite || target?.suites[0] || ''}
                  onChange={(e) => setSuite(e.target.value)}
                >
                  {target?.suites.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </NativeSelect>
              </Label>
              <Label>
                测试场景
                <NativeSelect
                  value={scenario || target?.scenarios[0] || ''}
                  onChange={(e) => setScenario(e.target.value)}
                >
                  {target?.scenarios.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </NativeSelect>
              </Label>
            </div>
            <div className="form-actions">
              <Link to="/queue">返回测试任务</Link>
              <Button
                variant="default"
                size="default"
                type="submit"
                disabled={busy || !target}
              >
                {busy ? '正在提交…' : '提交并加入队列'}
              </Button>
            </div>
          </form>
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
        variant={finished ? 'default' : 'destructive'}
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
            <section className="sum">
              <div className="sum-top">
                <div className="sum-title">
                  <h1>
                    {r.input.scenario}
                    <span className="id" title={id}>
                      #{id.slice(0, 8)}
                    </span>
                  </h1>
                  <p className="sub">
                    {r.input.targetId} · {r.input.suite}
                  </p>
                </div>
                <div className="sum-acts">
                  <Badge value={r.state} />
                  <Badge value={r.verdict} />
                  <Button asChild variant="secondary">
                    <Link to="/queue">
                      <Icon name="list" />
                      返回测试任务
                    </Link>
                  </Button>
                  <RequestAction request={r} onChange={reload} />
                </div>
              </div>
              <div className="execution-status" role="status">
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
            <div className="note warn" role="alert">
              <Icon name="alert" />
              {latest.outcome.error}
            </div>
          )}
          <Card asChild>
            <section className="overflow-hidden">
              <div className="panel-head">
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
  embedded,
  open,
  children,
}: {
  title: string;
  className: string;
  embedded: boolean;
  open?: boolean;
  children: ReactNode;
}) {
  return embedded ? (
    <section className={`${className} diagnostic-section`}>
      <h3>{title}</h3>
      {children}
    </section>
  ) : (
    <details className={className} open={open}>
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
          className="run-info"
          title="运行信息"
          embedded={!!panel}
        >
          {published.length > 1 && (
            <div className="report-switch">
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
          <div className="meta-grid">
            {[
              ['场景', r.input.scenario],
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
              <div className="meta-cell" key={label}>
                <span className="k">{label}</span>
                <span className="v" title={value}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          {r.input.source?.pipelineUrl &&
            /^https?:/.test(r.input.source.pipelineUrl) && (
              <a
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
          className="execution-attempts overflow-hidden"
          title={`执行尝试 · ${r.attempts.length} 次`}
          embedded={!!panel}
          open={!published.length}
        >
          {r.attempts.length ? (
            r.attempts.map((a) => (
              <div className="attempt-row" key={a.attemptId}>
                <div>
                  <b>执行 #{a.number}</b>
                  <small>
                    {a.workerId} / {a.slotId}
                  </small>
                  <code>{a.attemptId}</code>
                </div>
                <div>
                  <span className="hint">执行阶段</span>
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
                  <span className="hint">清理 / 发布</span>
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
          className="runtime-events overflow-hidden"
          title={panel ? '运行动态' : `运行动态 · 最近 ${events.length} 条`}
          embedded={!!panel}
        >
          <div className="panel-head">
            <span className="sub">
              最近 {events.length} 条 · {streamState}
            </span>
            <div className="right">
              <Input
                aria-label="筛选运行动态"
                placeholder="筛选阶段 / 日志"
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="event-list">
            {events.length ? (
              events
                .filter((e) =>
                  `${e.kind} ${text(e.data)}`
                    .toLowerCase()
                    .includes(eventSearch.toLowerCase()),
                )
                .map((e) => (
                  <div className="event" key={e.seq}>
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
function ReportContent({
  id,
  shared = false,
}: {
  id: string;
  shared?: boolean;
}) {
  const prefix = shared ? '/api/shared/reports' : '/api/reports';
  const { data: r, error } = useData<ReportView>(`${prefix}/${id}`);
  const { data: request, error: requestError, reload } = useData<Detail>(
    `/api/requests/${r?.requestId}`,
    2000,
    !shared && !!r,
  );
  return (
    <>
      <header className="report-header">
        <div className="report-heading">
          <div className="report-identity">
            <h1 title={r?.manifest.runId}>{r?.manifest.runId ?? id}</h1>
            {r && (
              <span className="inline-flex items-center">
                <span className="sr-only">测试结果：</span>
                <Badge value={r.manifest.status} />
              </span>
            )}
          </div>
          {r && (
            <dl className="report-metadata">
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
          <div className="rowline">
            <Button asChild variant="secondary">
              <Link to="/queue">
                <Icon name="list" />
                返回测试任务
              </Link>
            </Button>
            {request && (
              <RequestAction request={request} onChange={reload} />
            )}
          </div>
        )}
      </header>
      <ErrorBox error={error} />
      {!r && !error && <Empty>正在加载报告…</Empty>}
      {r && (
        <>
          {r.issues.length > 0 && (
            <details className="evidence-issues">
              <summary>有 {r.issues.length} 项证据不可用</summary>
              {r.issues.map((issue, i) => (
                <p key={i}>{issue}</p>
              ))}
            </details>
          )}
          {r.manifest.runnerErrors?.map((e, i) => (
            <div className="error" key={i}>
              {e.phase}: {e.message}
            </div>
          ))}
          <Replay
            key={id}
            report={r}
            shared={shared}
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
    <Card asChild className="border-0 rounded-none bg-transparent">
      <section className="share-panel overflow-hidden">
        <div className="panel-heading">
          <h2>报告分享</h2>
          <span>只读 · 可撤销 · 内网访问</span>
        </div>
        <ErrorBox error={error || loadError} />
        <div className="share-controls">
          <NativeSelect
            aria-label="分享有效期"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>有效期 1 天</option>
            <option value={3}>有效期 3 天</option>
            <option value={7}>有效期 7 天</option>
          </NativeSelect>
          <Label>
            <Checkbox
              checked={sensitive}
              onCheckedChange={(checked) => setSensitive(checked === true)}
            />{' '}
            包含日志、源码及 Trace（可能含敏感数据）
          </Label>
          <Button variant="default" size="default" onClick={create}>
            生成分享链接
          </Button>
        </div>
        {url && (
          <Label className="share-url">
            分享链接
            <Input
              aria-label="分享链接"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <small>链接只显示一次；有效期不会超过报告保留时间。</small>
          </Label>
        )}
        {shares?.map((s) => (
          <div className="share-row" key={s.id}>
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
      </section>
    </Card>
  );
}
function Workers() {
  const { data, error, reload } = useData<ExecutionWorker[]>(
    '/api/workers',
    3000,
  );
  const [actionError, setError] = useState('');
  const { data: ops } = useData<{
    events?: unknown[];
    storage: { freeBytes: number; reservedBytes: number };
  }>('/api/operations', 10000);
  return (
    <>
      <PageTitle eyebrow="EXECUTION WORKERS" title="Worker 主机" />
      <ErrorBox error={error || actionError} />
      {ops && (
        <div className="callout">
          报告磁盘可用 {(ops.storage.freeBytes / 1024 ** 3).toFixed(1)} GB ·
          已登记产物 {(ops.storage.reservedBytes / 1024 ** 3).toFixed(2)} GB
        </div>
      )}
      {data?.map((w) => (
        <Card asChild>
          <section className="overflow-hidden" key={w.id}>
            <div className="panel-heading">
              <div>
                <h2>{w.id}</h2>
                <Badge value={w.health} />
                <small>
                  {w.seenAt ? `上次联系 ${time(w.seenAt)}` : '尚未连接'} ·{' '}
                  {w.paused ? '已暂停调度' : '允许领取任务'}
                </small>
              </div>
              {ops && (
                <Button
                  variant="secondary"
                  size="default"
                  onClick={async () => {
                    try {
                      await api(`/api/workers/${w.id}/pause`, 'POST', {
                        paused: !w.paused,
                      });
                      reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {w.paused ? '恢复调度' : '暂停调度'}
                </Button>
              )}
            </div>
            <div className="panel-body stack">
              <Link to="/devices" search={{ worker: w.id }} className="link">
                查看此主机的设备 →
              </Link>
              <small>
                {w.inventory
                  ? `最近检测 ${time(w.inventory.receivedAt)} · ${w.inventory.devices.length} 台设备${w.inventory.stale ? ' · 检测已过期' : ''}`
                  : '尚未收到设备检测结果'}
              </small>
              {w.inventory?.diagnostics.map((d, i) => (
                <p className="hint" key={i}>
                  {d.source}：{d.message}
                </p>
              ))}
            </div>
            {w.slots.map((s) => (
              <div className="attempt-row" key={s.id}>
                <div>
                  <b>{s.id}</b>
                  <small>{s.deviceId}</small>
                </div>
                <Badge value={s.state} />
                <span>应用：{s.targets.join(', ')}</span>
                <span>generation {s.generation}</span>
              </div>
            ))}
          </section>
        </Card>
      ))}
      <div className="callout">
        暂停只阻止领取新任务。隔离设备需要运维在 Mac mini
        上确认进程终止并重置设备后恢复。
      </div>
    </>
  );
}
function Targets() {
  const { data, error } = useData<Target[]>('/api/targets');
  const { data: me } = useData<{ role: string }>('/api/me');
  const [configuration, setConfiguration] = useState(''),
    [notice, setNotice] = useState('');
  const { data: raw } = useData<unknown[]>(
    me?.role === 'admin' ? '/api/admin/targets' : '/api/targets',
  );
  return (
    <>
      <PageTitle eyebrow="APPLICATION TARGETS" title="应用配置" />
      <ErrorBox error={error} />
      {data?.map((t) => (
        <Card asChild>
          <section className="target-card overflow-hidden" key={t.id}>
            <h2>{t.name}</h2>
            <p>{t.id}</p>
            <div>
              <span>测试套件</span>
              {t.suites.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </div>
            <div>
              <span>测试场景</span>
              {t.scenarios.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </div>
            {me?.role === 'admin' && (
              <Button
                variant="secondary"
                size="default"
                onClick={() =>
                  setConfiguration(
                    JSON.stringify(
                      raw?.find(
                        (item) => (item as { id?: string }).id === t.id,
                      ),
                      null,
                      2,
                    ),
                  )
                }
              >
                编辑配置
              </Button>
            )}
          </section>
        </Card>
      ))}
      {me?.role === 'admin' && (
        <Card asChild>
          <section className="target-editor overflow-hidden">
            <h2>注册或更新应用</h2>
            <p>
              应用执行配置由管理员维护，任务提交人只能选择已注册的套件与场景。
            </p>
            <Textarea
              aria-label="应用配置 JSON"
              rows={16}
              value={configuration}
              onChange={(e) => setConfiguration(e.target.value)}
              placeholder="ApplicationTarget JSON"
            />
            <Button
              variant="default"
              size="default"
              onClick={async () => {
                try {
                  const target = JSON.parse(configuration);
                  await api(
                    `/api/admin/targets/${encodeURIComponent(target.id)}`,
                    'PUT',
                    target,
                  );
                  setNotice('配置已保存；新任务使用更新后的配置。');
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
            >
              保存配置
            </Button>
            <p role="status">{notice}</p>
          </section>
        </Card>
      )}
    </>
  );
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
  validateSearch: (search: Record<string, unknown>): { search?: string } => ({
    search:
      typeof search.search === 'string'
        ? search.search.slice(0, 200)
        : undefined,
  }),
  notFoundComponent: () => (
    <Empty>
      页面不存在。<Link to="/">返回总览</Link>
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
  component: function ReportPage() {
    const { id } = reportRoute.useParams();
    return <ReportContent key={id} id={id} />;
  },
});
const sharedReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shared/reports/$id',
  component: function SharedReportPage() {
    const { id } = sharedReportRoute.useParams();
    return <ReportContent key={id} id={id} shared />;
  },
});
const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Requests overview />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs',
    component: () => <Requests history />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/queue',
    component: () => <Requests />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/reports',
    component: () => <Requests reportsOnly />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/new',
    component: NewRequest,
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
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/targets',
    component: Targets,
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
  interface Register {
    router: ReturnType<typeof createCloudRouter>;
  }
}

export function App() {
  const [router] = useState(createCloudRouter);
  return <RouterProvider router={router} />;
}
