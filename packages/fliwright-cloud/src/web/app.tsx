import React, {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import type { ReportView } from '../ReportStore.js';
import type {
  ExecutionAttempt,
  ExecutionWorker,
  TestRequest,
} from '../contracts.js';
import { Icon, StageStrip } from './ui.js';
import { Replay } from './Replay.js';
import './style.css';

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
async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '请求失败');
  return data as T;
}
function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value}`}>
      <span className="status-dot" aria-hidden="true" />
      {labels[value] ?? value}
    </span>
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
function useData<T>(path: string, refresh = 0, enabled = true) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setData(undefined);
    setError('');
    const load = () =>
      api<T>(path)
        .then((value) => {
          if (active) {
            setData(value);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = refresh ? setInterval(load, refresh) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, refresh, version, enabled]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
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
    'RUN HISTORY': '每一次运行的状态、提交与测试结果。',
    'TEST REPORTS': '浏览已完成的运行，查看步骤回放与归档证据。',
    'EXECUTION QUEUE': '任务按提交顺序调度，同一设备同时只执行一个任务。',
    'NEW EXECUTION': '选择应用、固定的 Git 提交、测试套件与场景。',
    'EXECUTION WORKERS': '查看 Worker 心跳、设备占用与调度状态。',
    'APPLICATION TARGETS': '管理已注册应用及其测试套件与场景。',
  };
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {descriptions[eyebrow] && (
          <p className="lede">{descriptions[eyebrow]}</p>
        )}
      </div>
      <div className="actions">{children}</div>
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
  const { data: workers } = useData<ExecutionWorker[]>(
    '/api/workers',
    shared ? 0 : 5000,
    !shared,
  );
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('cloud-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const path = window.location.pathname;
  const groups = [
    {
      name: '运行',
      items: [
        ['/', '概览', 'gauge'],
        ['/runs', '运行记录', 'list'],
        ['/queue', '测试队列', 'clock'],
        ['/workers', '设备与 Worker', 'device'],
      ],
    },
    { name: '报告', items: [['/reports', '测试报告', 'doc']] },
    {
      name: '管理',
      items: [
        ['/new', '提交测试', 'send'],
        ['/targets', '应用配置', 'settings'],
      ],
    },
  ];
  const current = path.startsWith('/requests/')
    ? '/runs'
    : path.startsWith('/reports/')
      ? '/reports'
      : path;
  const title = shared
    ? '分享报告'
    : (groups.flatMap((g) => g.items).find(([url]) => url === current)?.[1] ??
      '运行详情');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
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
    <div className="app">
      <a className="skip" href="#content">
        跳至内容
      </a>
      <aside className="side">
        <a className="brand" href={shared ? undefined : '/'}>
          <span className="brand-mark">CT</span>
          <span>
            <span className="brand-name">云测平台</span>
            <span className="brand-sub">Flutter 自动化测试</span>
          </span>
        </a>
        <nav className="nav" aria-label="主导航">
          {shared ? (
            <div className="share-label">只读报告分享</div>
          ) : (
            groups.map((group) => (
              <div className="nav-group" key={group.name}>
                <div className="nav-label">{group.name}</div>
                {group.items.map(([url, label, icon]) => (
                  <a
                    className="nav-item"
                    href={url}
                    key={url}
                    aria-current={current === url ? 'page' : undefined}
                  >
                    <Icon name={icon} />
                    {label}
                  </a>
                ))}
              </div>
            ))
          )}
        </nav>
        <div className="side-foot">
          <div className="worker-card">
            {workers?.map((w) => (
              <div className="worker-line" key={w.id}>
                <span className={`connection-dot ${w.health}`} />
                <span className="nm">{w.id}</span>
                <span className="st">
                  {w.paused ? '已暂停' : labels[w.health]}
                </span>
              </div>
            ))}
            <p className="side-note">
              {shared
                ? '受限访问 · 只读证据'
                : me
                  ? `${me.name} · ${me.role}`
                  : '等待团队登录'}
            </p>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <b>{title}</b>
            {/\/(requests|reports)\//.test(path) && (
              <>
                <span className="sep">/</span>
                <code title={path.split('/').pop()}>
                  {path.split('/').pop()?.slice(0, 12)}
                </code>
              </>
            )}
          </div>
          <div className="spacer" />
          {!shared && (
            <form className="search" action="/runs">
              <Icon name="search" />
              <label className="sr" htmlFor="global-search">
                搜索任务或报告
              </label>
              <input
                id="global-search"
                type="search"
                name="search"
                placeholder="搜索任务 / 报告"
                maxLength={200}
              />
              <kbd>/</kbd>
            </form>
          )}
          <button
            className="btn btn-quiet btn-icon"
            aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
            title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          {!shared && (
            <>
              <a className="btn btn-accent" href="/new">
                <Icon name="plus" />
                提交测试
              </a>
              <span
                className="current-user"
                title={me ? `${me.name} · ${me.role}` : '未登录'}
              >
                <Icon name="user" />
                <span>{me?.name}</span>
              </span>
            </>
          )}
        </header>
        <main className="view" id="content">
          <div className="page">{children}</div>
        </main>
      </div>
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
  const [state, setState] = useState(
      reportsOnly ? 'completed' : !overview && !history ? 'queued' : '',
    ),
    [search, setSearch] = useState(
      new URLSearchParams(window.location.search)
        .get('search')
        ?.slice(0, 200) ?? '',
    ),
    [offset, setOffset] = useState(0),
    [target, setTarget] = useState('');
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
      <PageTitle
        eyebrow={
          overview
            ? 'TEAM OVERVIEW'
            : reportsOnly
              ? 'TEST REPORTS'
              : history
                ? 'RUN HISTORY'
                : 'EXECUTION QUEUE'
        }
        title={
          overview
            ? '概览'
            : reportsOnly
              ? '测试报告'
              : history
                ? '运行记录'
                : '测试队列'
        }
      >
        <a className="btn btn-accent" href="/new">
          <Icon name="plus" />
          提交测试
        </a>
      </PageTitle>
      {overview && (
        <div className="stats">
          <div>
            <span>等待执行</span>
            <strong>{data?.queue.length ?? '—'}</strong>
            <small>按提交顺序调度</small>
          </div>
          <div>
            <span>正在执行</span>
            <strong>
              {workers
                ?.flatMap((w) => w.slots)
                .filter((s) => s.state === 'busy').length ?? '—'}
            </strong>
            <small>设备独占，避免任务冲突</small>
          </div>
          <div>
            <span>可用槽位</span>
            <strong>
              {workers
                ?.filter((w) => !w.paused && w.health === 'healthy')
                .flatMap((w) => w.slots)
                .filter((s) => s.state === 'idle').length ?? '—'}
            </strong>
            <small>专用模拟器</small>
          </div>
          <div>
            <span>累计任务</span>
            <strong>{data?.total ?? '—'}</strong>
            <small>原始结果与证据留存</small>
          </div>
        </div>
      )}
      {overview && <OverviewActivity />}
      <section className="panel">
        <div className="panel-heading">
          <h2>
            {overview ? '最近运行' : reportsOnly ? '运行历史' : '全部任务'}
          </h2>
          {!overview && (
            <div className="filters">
              <input
                aria-label="搜索任务"
                placeholder="搜索提交、分支或任务 ID"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
              />
              <select
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
              </select>
              <select
                aria-label="筛选状态"
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">所有状态</option>
                {[
                  'queued',
                  'running',
                  'completed',
                  'cancelled',
                  'infrastructure_failed',
                ].map((s) => (
                  <option key={s} value={s}>
                    {labels[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <ErrorBox error={error} />
        {data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>运行 / 场景</th>
                  <th>提交</th>
                  <th>状态</th>
                  <th>结果</th>
                  <th>提交时间</th>
                  <th>发起人</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/requests/${r.id}`}>
                        <code className="request-id">#{r.id.slice(0, 8)}</code>
                        <b>
                          {targets?.find((t) => t.id === r.input.targetId)
                            ?.name ?? r.input.targetId}
                        </b>
                      </a>
                      <small>
                        {r.input.suite} · {r.input.scenario}
                      </small>
                    </td>
                    <td>
                      <code>{r.input.commit.slice(0, 8)}</code>
                      <small>
                        {r.input.source?.branch ?? r.id.slice(0, 8)}
                      </small>
                    </td>
                    <td>
                      <Badge value={r.state} />
                      {r.state === 'queued' && (
                        <small>排队第 {data.queue.indexOf(r.id) + 1} 位</small>
                      )}
                    </td>
                    <td>
                      <Badge value={r.verdict} />
                    </td>
                    <td className="num muted">{time(r.createdAt)}</td>
                    <td>{r.actor}</td>
                    <td>
                      <a href={`/requests/${r.id}`}>查看 →</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !error ? (
          <Empty>
            {data ? '暂无测试任务，提交一次测试开始记录。' : '正在加载…'}
          </Empty>
        ) : null}
        {!overview && data && (
          <div className="pagination">
            <span>共 {data.total} 条任务</span>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              上一页
            </button>
            <button
              disabled={offset + 25 >= data.total}
              onClick={() => setOffset(offset + 25)}
            >
              下一页
            </button>
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
  const { data } = useData<{ items: Array<Omit<TestRequest, 'target'>> }>(
    '/api/requests?state=running&limit=8',
    3000,
  );
  const { data: workers } = useData<ExecutionWorker[]>('/api/workers', 5000);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>正在运行</h2>
          <span className="sub">阶段与状态自动更新</span>
          <div className="right">
            <a className="btn btn-sm" href="/queue">
              查看队列
            </a>
          </div>
        </div>
        {data?.items.length ? (
          data.items.map((r) => <LiveRun key={r.id} id={r.id} />)
        ) : (
          <Empty>当前没有正在执行的测试。</Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>设备与 Worker</h2>
          <span className="sub">{workers?.length ?? '—'} 台执行机</span>
          <div className="right">
            <a className="btn btn-sm" href="/workers">
              全部设备
            </a>
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
    </>
  );
}
function LiveRun({ id }: { id: string }) {
  const { data } = useData<Detail>(`/api/requests/${id}`, 3000);
  return data ? (
    <div className="panel-body stack">
      <div className="rowline">
        <b>{data.input.scenario}</b>
        <code>#{id.slice(0, 8)}</code>
        <a className="btn btn-sm push-right" href={`/requests/${id}`}>
          观察运行 <Icon name="chevron" />
        </a>
      </div>
      <StageStrip stage={data.attempts[data.attempts.length - 1]?.stage} />
    </div>
  ) : null;
}
function NewRequest() {
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
      window.location.assign(`/requests/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="NEW EXECUTION" title="提交测试任务" />
      <section className="panel form-panel">
        <h2>选择测试配置</h2>
        <p>提交后进入队列，等待专用设备执行。</p>
        <ErrorBox error={loadError || error} />
        <form onSubmit={submit}>
          <label>
            应用
            <select
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
            </select>
          </label>
          <label>
            Git commit SHA
            <input
              required
              pattern="[0-9a-f]{40}"
              placeholder="完整的 40 位提交 SHA"
              value={commit}
              onChange={(e) => setCommit(e.target.value.trim())}
            />
            <small>固定提交用于准确复现测试。</small>
          </label>
          <div className="form-row">
            <label>
              测试套件
              <select
                value={suite || target?.suites[0] || ''}
                onChange={(e) => setSuite(e.target.value)}
              >
                {target?.suites.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              测试场景
              <select
                value={scenario || target?.scenarios[0] || ''}
                onChange={(e) => setScenario(e.target.value)}
              >
                {target?.scenarios.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <a href="/queue">返回队列</a>
            <button className="primary" disabled={busy || !target}>
              {busy ? '正在提交…' : '提交并加入队列'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
function RequestDetail({ id }: { id: string }) {
  const {
    data: r,
    error,
    reload,
  } = useData<Detail>(`/api/requests/${id}`, 2000);
  const [events, setEvents] = useState<
    Array<{
      seq: number;
      kind: string;
      at: number;
      data: Record<string, unknown>;
    }>
  >([]);
  const [actionError, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportId, setReportId] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [streamState, setStreamState] = useState('连接中');
  useEffect(() => {
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
  }, [id]);
  async function action(name: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string }>(
        `/api/requests/${id}/${name}`,
        'POST',
        undefined,
        name === 'rerun' ? crypto.randomUUID() : undefined,
      );
      if (name === 'rerun') window.location.assign(`/requests/${result.id}`);
      else reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const latest = r?.attempts[r.attempts.length - 1];
  const published = r?.reports.filter((p) => p.state === 'published') ?? [];
  const activeReport =
    published.find((p) => p.id === reportId) ?? published[published.length - 1];
  return (
    <>
      <ErrorBox error={error || actionError} />
      {!r && !error && <Empty>正在加载运行详情…</Empty>}
      {r && (
        <>
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
                <a className="btn" href="/runs">
                  <Icon name="list" />
                  返回列表
                </a>
                <button
                  className={`btn ${terminal(r.state) ? 'btn-accent' : 'btn-danger'}`}
                  disabled={busy || r.state === 'cancel_requested'}
                  onClick={() => action(terminal(r.state) ? 'rerun' : 'cancel')}
                >
                  <Icon name={terminal(r.state) ? 'refresh' : 'x'} />
                  {busy
                    ? '处理中…'
                    : terminal(r.state)
                      ? '重新运行'
                      : '取消任务'}
                </button>
              </div>
            </div>
            <div className="sum-digest">
              <div
                className={`fact ${r.verdict === 'failed' ? 'is-fail' : r.verdict === 'passed' ? 'is-pass' : ''}`}
              >
                <span className="k">测试结果</span>
                <span className="v">{labels[r.verdict]}</span>
              </div>
              <div className="fact">
                <span className="k">执行尝试</span>
                <span className="v">{r.attempts.length} 次</span>
              </div>
              <div className="fact">
                <span className="k">报告归档</span>
                <span className="v">{published.length} 份已发布</span>
              </div>
              <div className="fact">
                <span className="k">设备清理</span>
                <span className="v">
                  {latest?.outcome
                    ? labels[latest.outcome.cleanup]
                    : '等待完成'}
                </span>
              </div>
              {r.queuePosition > 0 && (
                <div className="fact">
                  <span className="k">队列位置</span>
                  <span className="v">第 {r.queuePosition} 位</span>
                </div>
              )}
            </div>
            <div className="run-info">
              <span className="info-label">运行信息</span>
              <div className="meta-grid">
                {[
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
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>执行阶段</h2>
              <span className="sub">
                {latest ? `执行 #${latest.number}` : '等待 Worker 领取任务'}
              </span>
              <div className="right">
                {!terminal(r.state) && <Badge value={r.state} />}
              </div>
            </div>
            <div className="panel-body">
              <StageStrip
                stage={
                  latest?.stage === 'finished'
                    ? ([...events].reverse().find((e) => e.kind === 'stage')
                        ?.data.stage as string | undefined)
                    : latest?.stage
                }
                completed={r.state === 'completed'}
                failed={r.verdict === 'failed'}
                stopped={terminal(r.state)}
              />
              {latest?.outcome?.error && (
                <div className="note warn">
                  <Icon name="alert" />
                  {latest.outcome.error}
                </div>
              )}
            </div>
          </section>
          {activeReport ? (
            <>
              <div className="report-switch">
                <label htmlFor="execution-report">执行报告</label>
                <select
                  id="execution-report"
                  value={activeReport.id}
                  onChange={(e) => setReportId(e.target.value)}
                >
                  {published.map((p) => (
                    <option key={p.id} value={p.id}>
                      执行 #
                      {r.attempts.find((a) => a.attemptId === p.attemptId)
                        ?.number ?? '—'}{' '}
                      · {p.id.slice(0, 12)}
                    </option>
                  ))}
                </select>
                <a className="btn btn-sm" href={`/reports/${activeReport.id}`}>
                  <Icon name="doc" />
                  独立打开报告
                </a>
              </div>
              <ReportContent
                key={activeReport.id}
                id={activeReport.id}
                embedded
              />
            </>
          ) : (
            <section className="panel">
              <div className="panel-head">
                <h2>步骤回放</h2>
              </div>
              <Empty>
                {terminal(r.state)
                  ? '此运行没有已发布的报告。可查看执行尝试与运行动态了解原因。'
                  : '任务执行中，报告发布后将在此展示步骤、截图与完整证据。'}
              </Empty>
            </section>
          )}
          <details
            className="panel execution-attempts"
            open={!published.length}
          >
            <summary>执行尝试 · {r.attempts.length} 次</summary>
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
                    <b>{a.stage}</b>
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
          </details>
          <section className="panel">
            <div className="panel-head">
              <h2>运行动态</h2>
              <span className="sub">
                最近 {events.length} 条 · {streamState}
              </span>
              <div className="right">
                <input
                  className="input"
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
                      <time>{new Date(e.at).toLocaleTimeString('zh-CN')}</time>
                      <b>{e.kind === 'stage' ? text(e.data.stage) : e.kind}</b>
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
          </section>
        </>
      )}
    </>
  );
}
function ReportContent({
  id,
  shared = false,
  embedded = false,
}: {
  id: string;
  shared?: boolean;
  embedded?: boolean;
}) {
  const prefix = shared ? '/api/shared/reports' : '/api/reports';
  const { data: r, error } = useData<ReportView>(`${prefix}/${id}`);
  return (
    <>
      {!embedded && (
        <PageTitle
          eyebrow={shared ? 'SHARED REPORT' : 'TEST REPORTS'}
          title="测试报告"
        >
          {r && !shared && (
            <a className="btn" href={`/requests/${r.requestId}`}>
              <Icon name="list" />
              运行详情
            </a>
          )}
        </PageTitle>
      )}
      <ErrorBox error={error} />
      {!r && !error && <Empty>正在加载报告…</Empty>}
      {r && (
        <>
          {!embedded && (
            <div className="run-summary">
              <div>
                <span>运行标识</span>
                <code>{r.manifest.runId}</code>
              </div>
              <div>
                <span>测试结果</span>
                <Badge value={r.manifest.status} />
              </div>
              <div>
                <span>证据完整性</span>
                <b>{r.manifest.evidenceStatus}</b>
              </div>
              <div>
                <span>保留至</span>
                <b>{time(r.expiresAt)}</b>
              </div>
            </div>
          )}
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
          <Replay key={id} report={r} shared={shared} />
          {!shared && <Shares id={id} />}
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
    <section className="panel share-panel">
      <div className="panel-heading">
        <h2>报告分享</h2>
        <span>只读 · 可撤销 · 内网访问</span>
      </div>
      <ErrorBox error={error || loadError} />
      <div className="share-controls">
        <select
          aria-label="分享有效期"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={1}>有效期 1 天</option>
          <option value={3}>有效期 3 天</option>
          <option value={7}>有效期 7 天</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={sensitive}
            onChange={(e) => setSensitive(e.target.checked)}
          />{' '}
          包含日志、源码及 Trace（可能含敏感数据）
        </label>
        <button className="primary" onClick={create}>
          生成分享链接
        </button>
      </div>
      {url && (
        <label className="share-url">
          分享链接
          <input
            aria-label="分享链接"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <small>链接只显示一次；有效期不会超过报告保留时间。</small>
        </label>
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
          <button
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
          </button>
        </div>
      ))}
    </section>
  );
}
function Workers() {
  const { data, error, reload } = useData<ExecutionWorker[]>(
    '/api/workers',
    3000,
  );
  const [actionError, setError] = useState('');
  const { data: ops } = useData<{
    storage: { freeBytes: number; reservedBytes: number };
  }>('/api/operations', 10000);
  return (
    <>
      <PageTitle eyebrow="EXECUTION WORKERS" title="执行设备" />
      <ErrorBox error={error || actionError} />
      {ops && (
        <div className="callout">
          报告磁盘可用 {(ops.storage.freeBytes / 1024 ** 3).toFixed(1)} GB ·
          已登记产物 {(ops.storage.reservedBytes / 1024 ** 3).toFixed(2)} GB
        </div>
      )}
      {data?.map((w) => (
        <section className="panel" key={w.id}>
          <div className="panel-heading">
            <div>
              <h2>{w.id}</h2>
              <Badge value={w.health} />
              <small>
                {w.seenAt ? `上次联系 ${time(w.seenAt)}` : '尚未连接'} ·{' '}
                {w.paused ? '已暂停调度' : '允许领取任务'}
              </small>
            </div>
            <button
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
            </button>
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
        <section className="panel target-card" key={t.id}>
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
            <button
              onClick={() =>
                setConfiguration(
                  JSON.stringify(
                    raw?.find((item) => (item as { id?: string }).id === t.id),
                    null,
                    2,
                  ),
                )
              }
            >
              编辑配置
            </button>
          )}
        </section>
      ))}
      {me?.role === 'admin' && (
        <section className="panel target-editor">
          <h2>注册或更新应用</h2>
          <p>
            应用执行配置由管理员维护，任务提交人只能选择已注册的套件与场景。
          </p>
          <textarea
            aria-label="应用配置 JSON"
            rows={16}
            value={configuration}
            onChange={(e) => setConfiguration(e.target.value)}
            placeholder="ApplicationTarget JSON"
          />
          <button
            className="primary"
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
          </button>
          <p role="status">{notice}</p>
        </section>
      )}
    </>
  );
}
function ShareExchange() {
  const [error, setError] = useState('');
  useEffect(() => {
    const token = window.location.hash.slice(1);
    history.replaceState(null, '', '/share');
    if (!token) {
      setError('分享链接缺少授权信息，请使用完整链接。');
      return;
    }
    void api<{ url: string }>('/api/share/exchange', 'POST', { token })
      .then((r) => window.location.replace(r.url))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageTitle eyebrow="REPORT SHARING" title="打开分享报告" />
      <ErrorBox error={error} />
      {!error && <Empty>正在验证分享授权…</Empty>}
    </>
  );
}
function App() {
  const path = window.location.pathname;
  const shared = path.startsWith('/shared/') || path === '/share';
  let page: ReactNode;
  if (path === '/') page = <Requests overview />;
  else if (path === '/runs') page = <Requests history />;
  else if (path === '/queue') page = <Requests />;
  else if (path === '/reports') page = <Requests reportsOnly />;
  else if (path === '/new') page = <NewRequest />;
  else if (path === '/workers') page = <Workers />;
  else if (path === '/targets') page = <Targets />;
  else if (/^\/requests\/[a-zA-Z0-9_-]+$/.test(path))
    page = <RequestDetail id={path.split('/')[2]} />;
  else if (/^\/reports\/[a-zA-Z0-9_-]+$/.test(path))
    page = <ReportContent id={path.split('/')[2]} />;
  else if (/^\/shared\/reports\/[a-zA-Z0-9_-]+$/.test(path))
    page = <ReportContent id={path.split('/')[3]} shared />;
  else if (path === '/share') page = <ShareExchange />;
  else
    page = (
      <Empty>
        页面不存在。<a href="/">返回总览</a>
      </Empty>
    );
  return <Layout shared={shared}>{page}</Layout>;
}
createRoot(document.getElementById('root')!).render(<App />);
