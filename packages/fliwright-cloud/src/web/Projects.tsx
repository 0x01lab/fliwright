import React, { useState, type ReactNode } from 'react';
import { FolderGit2, GitBranch, GitCommitHorizontal, Search, Plus, Play, ScanLine, History, Settings2, ChevronRight, ArrowUpRight, Check, X, Clock3, LoaderCircle, CircleHelp, ListChecks, Trash2 } from 'lucide-react';
import type { CatalogScan, Project, TestCatalog, TestRequest } from '@fliwright/cloud-protocol';
import { Link } from '@tanstack/react-router';
import { projectRepositoryDetails, projectSetupDefaults } from '../project-setup.js';
import { api, useData } from './data.js';
import { Input } from './components/ui/input.js';
import { Button } from './components/ui/button.js';
import { NativeSelect } from './components/ui/native-select.js';
import { Checkbox } from './components/ui/checkbox.js';
import { Textarea } from './components/ui/textarea.js';
import { Dialog } from './components/ui/dialog.js';
import { Badge } from './components/ui/badge.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs.js';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table.js';

const emptyProject = (): Project => ({ ...projectSetupDefaults, id: '', name: '', repository: '', configRevision: 1, webhookSecretDigest: null, webhookStatus: 'disabled', autoRun: { enabled: false, branch: 'main', selections: [], revision: 1 } });
type ProjectStatus = { ready: boolean; blockers: string[]; head?: { commit: string }; latestScan: CatalogScan | null };
function Field({ label, value, change, type = 'text' }: { label: string; value: string; change: (value: string) => void; type?: string }) {
  return <label className="grid gap-1 text-sm"><span>{label}</span><Input aria-label={label} type={type} value={value} onChange={event => change(event.target.value)} /></label>;
}
function ProjectEditor({ project, creating, saved, notify, cancel, busyChanged }: { project: Project; creating: boolean; saved: () => void; notify: (message: string) => void; cancel?: () => void; busyChanged?: (busy: boolean) => void }) {
  const [draft, setDraft] = useState(project);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const repositoryDetails = projectRepositoryDetails(draft.repository);
  const field = (key: keyof Project, label: string) => <Field label={label} value={String(draft[key] ?? '')} change={value => setDraft({ ...draft, [key]: value })} />;
  return <form className="project-editor" onSubmit={async event => {
    event.preventDefault(); if (busy || (creating && !repositoryDetails)) return; setBusy(true); busyChanged?.(true); setSaveError('');
    try {
      const { id: _id, configRevision: _revision, webhookSecretDigest: _digest, webhookStatus: _status, autoRun: _autoRun, ...settings } = draft;
      const body = creating ? { ...settings, repository: repositoryDetails?.repository ?? draft.repository } : { ...draft, webhookSecretDigest: undefined };
      await api(creating ? '/api/projects' : `/api/projects/${project.id}`, creating ? 'POST' : 'PUT', body);
      notify('项目配置已保存。'); saved();
    } catch (error) { setSaveError((error as Error).message); } finally { setBusy(false); busyChanged?.(false); }
  }}>
    <div className="cloud-dialog-body grid gap-4 md:grid-cols-2">
    {saveError && <p role="alert" className="project-alert md:col-span-2">{saveError}</p>}
    <fieldset disabled={busy} className="contents">
    {creating ? <>
      <label className="grid gap-2 md:col-span-2"><span>GitLab 仓库 URL</span>
        <Input required autoFocus aria-label="GitLab 仓库 URL" placeholder="https://gitlab.example.com/team/my-app" value={draft.repository} onChange={event => {
          const repository = event.target.value, details = projectRepositoryDetails(repository);
          setDraft({ ...draft, repository, ...(!nameEdited ? { name: details?.name ?? '' } : {}) });
        }} />
        <span className="hint">粘贴项目主页或 HTTPS / SSH 克隆地址，自动填写项目名称。</span>
      </label>
      {draft.repository && !repositoryDetails && <p role="alert" className="md:col-span-2">请输入完整的 GitLab 项目地址，例如 https://gitlab.example.com/team/my-app。</p>}
      {repositoryDetails && <div className="rounded-lg bg-muted/40 p-4 md:col-span-2 space-y-1"><p>项目名称：{draft.name || repositoryDetails.name}</p><p className="hint">默认使用 main 分支、仓库根目录和 lib/main.dart 入口，可在下方调整。</p></div>}
    </> : <>{field('name', '项目名称')}{field('repository', '仓库 HTTPS / SSH URL')}</>}
    <details open={creating ? undefined : true} className="md:col-span-2"><summary className="cursor-pointer">{creating ? '调整名称和项目配置（可选）' : '项目配置'}</summary>
    <div className="grid gap-4 pt-4 md:grid-cols-2">
    {creating && <Field label="项目名称" value={draft.name} change={name => { setNameEdited(Boolean(name)); setDraft({ ...draft, name: name || repositoryDetails?.name || '' }); }} />}
    {field('defaultBranch', '默认分支')}{field('projectPath', 'Flutter 项目目录')}{field('entry', 'Flutter 入口')}
    <Field label="只读仓库凭据引用" value={draft.repositoryCredentialRef ?? ''} change={value => setDraft({ ...draft, repositoryCredentialRef: value || null })} />
    <Field label="超时（毫秒）" type="number" value={String(draft.timeoutMs)} change={value => setDraft({ ...draft, timeoutMs: Number(value) })} />
    <label className="grid gap-1 text-sm"><span>场景名称（每行一个）</span><Textarea aria-label="场景名称" value={draft.scenarios.join('\n')} onChange={event => setDraft({ ...draft, scenarios: event.target.value.split('\n') })} /><span className="hint">用于配置自动运行组合；扫描会自动发现仓库声明的场景，手动运行使用所选目录中的场景。</span></label>
    <label className="grid gap-1 text-sm"><span>Flutter 参数（每行一个）</span><Textarea aria-label="Flutter 参数" value={draft.flutterArgs.join('\n')} onChange={event => setDraft({ ...draft, flutterArgs: event.target.value.split('\n').filter(Boolean) })} /></label>
    <Field label="需要的能力（逗号分隔）" value={draft.requiredCapabilities.join(',')} change={value => setDraft({ ...draft, requiredCapabilities: value.split(',').map(item => item.trim()).filter(Boolean) })} />
    <div className="space-y-3 md:col-span-2"><h3>测试套件</h3>
      {Object.entries(draft.suites).map(([id, pattern], index) => <div className="flex gap-2" key={index}>
        <Input aria-label={`Suite ID ${index + 1}`} value={id} onChange={event => { const entries = Object.entries(draft.suites); entries[index] = [event.target.value, pattern]; setDraft({ ...draft, suites: Object.fromEntries(entries) }); }} />
        <Input aria-label={`Suite glob ${index + 1}`} value={pattern} onChange={event => setDraft({ ...draft, suites: { ...draft.suites, [id]: event.target.value } })} />
        <Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, suites: Object.fromEntries(Object.entries(draft.suites).filter(([key]) => key !== id)) })}>移除</Button>
      </div>)}
      <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, suites: { ...draft.suites, [`suite${Object.keys(draft.suites).length + 1}`]: '.fliwright/tests/**/*.test.ts' } })}>添加套件</Button>
    </div>
    <details className="space-y-3 md:col-span-2"><summary>高级配置：安装命令（仅管理员）</summary><p className="hint">这些命令在 Worker 导入仓库前执行。参数每行一个；不经过 shell。</p>
      {draft.install.map((command, index) => <div className="grid gap-2 py-3" key={index}>
        <Field label={`程序 ${index + 1}`} value={command.program} change={value => setDraft({ ...draft, install: draft.install.map((item, i) => i === index ? { ...item, program: value } : item) })} />
        <Textarea aria-label={`参数 ${index + 1}`} value={command.args.join('\n')} onChange={event => setDraft({ ...draft, install: draft.install.map((item, i) => i === index ? { ...item, args: event.target.value.split('\n').filter(Boolean) } : item) })} />
        <Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, install: draft.install.filter((_, i) => i !== index) })}>移除命令</Button>
      </div>)}
      <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, install: [...draft.install, { program: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts'] }] })}>添加命令</Button>
    </details>
    </div></details>
    </fieldset></div>
    <footer className="cloud-dialog-footer"><Button variant="ghost" disabled={busy} onClick={cancel}>取消</Button><Button disabled={busy || (creating && !repositoryDetails)} type="submit">{busy ? '保存中…' : creating ? '创建项目' : '保存项目配置'}</Button></footer>
  </form>;
}
function AutoRunSettings({ project, changed, notify, busyChanged }: { project: Project; changed: () => void; notify: (message: string) => void; busyChanged: (busy: boolean) => void }) {
  const [policy, setPolicy] = useState(project.autoRun);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const action = async (work: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true); busyChanged(true); setError(''); setMessage('');
    try { await work(); changed(); setMessage(success); notify(success); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); busyChanged(false); }
  };
  return <section className="space-y-4">
    {error && <p role="alert" className="project-alert">{error}</p>}
    {message && <p role="status" className="project-inline-note m-0">{message}</p>}
    <fieldset disabled={busy} className="space-y-4">
      <label className="flex items-center gap-2"><Checkbox checked={policy.enabled} onCheckedChange={value => setPolicy({ ...policy, enabled: value === true })} />启用自动运行</label>
      <Field label="自动运行分支" value={policy.branch} change={branch => setPolicy({ ...policy, branch })} />
      <div><h3 className="mb-2">运行组合</h3><div className="grid gap-2 rounded-md bg-muted/40 p-3">{Object.keys(project.suites).flatMap(suite => project.scenarios.map(scenario => {
        const checked = policy.selections.some(item => item.suite === suite && item.scenario === scenario);
        return <label key={`${suite}:${scenario}`} className="flex items-center gap-2"><Checkbox checked={checked} onCheckedChange={value => setPolicy({ ...policy, selections: value === true ? [...policy.selections, { suite, scenario }] : policy.selections.filter(item => item.suite !== suite || item.scenario !== scenario) })} />{suite} / {scenario}</label>;
      }))}{(!Object.keys(project.suites).length || !project.scenarios.length) && <p className="hint">请先在项目配置中添加套件与场景。</p>}</div></div>
      <Button onClick={() => void action(async () => { const { revision: _revision, ...body } = policy; await api(`/api/projects/${project.id}/auto-run`, 'PUT', body); }, '自动运行策略已保存。')}>保存策略</Button>
      <div className="space-y-3 border-t pt-4"><h3>Webhook 连接</h3><p className="hint">策略版本 {project.autoRun.revision} · {project.webhookStatus === 'configured' ? '已配置' : '未启用'}</p>
        <label className="grid gap-2"><span>Webhook URL</span><Input readOnly value={`${window.location.origin}/api/webhooks/gitlab/${project.id}`} aria-label="Webhook URL" /></label>
        <p className="hint">在 GitLab 中选择 Push events，并配置上面的分支。Secret Token 仅显示一次。</p>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void action(async () => { const result = await api<{ token: string }>(`/api/projects/${project.id}/webhook-secret`, 'POST', {}); setSecret(result.token); }, 'Secret Token 已生成，请立即复制。')}>生成 / 轮换 Secret Token</Button><Button variant="ghost" onClick={() => void action(async () => { await api(`/api/projects/${project.id}/webhook-secret`, 'DELETE'); setSecret(''); }, 'Webhook 已停用。')}>停用 Webhook</Button></div>
        {secret && <label className="grid gap-2 rounded-md bg-muted p-3"><span>请立即复制 Secret Token；关闭对话框后不可回读。</span><Input readOnly aria-label="一次性 Webhook Secret Token" value={secret} /><Button variant="ghost" onClick={() => setSecret('')}>隐藏 Token</Button></label>}
      </div>
    </fieldset>
  </section>;
}

const statusNames: Record<string, string> = {
  ready: '扫描完成', queued: '排队中', running: '运行中', failed: '失败', cancelled: '已取消',
  passed: '通过', unknown: '待定', skipped: '已跳过', interrupted: '已中断', completed: '已完成',
  assigned: '已分配', preparing: '准备中', finalizing: '收集报告', cancel_requested: '取消中',
  superseded: '已被替代', infrastructure_failed: '执行异常',
};
const dateTime = (value: number) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function StatusBadge({ value }: { value: string }) {
  const good = value === 'passed' || value === 'ready';
  const bad = value === 'failed' || value === 'infrastructure_failed';
  const active = ['queued', 'running', 'preparing', 'assigned', 'finalizing', 'cancel_requested'].includes(value);
  const Symbol = good ? Check : bad ? X : active ? Clock3 : CircleHelp;
  return <Badge variant="secondary" className={good ? 'bg-pass-bg text-pass-ink' : bad ? 'bg-fail-bg text-fail-ink' : ''}><Symbol className="size-3" />{statusNames[value] ?? value}</Badge>;
}
function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="project-empty"><span className="project-empty-icon"><FolderGit2 className="size-6" /></span><h3>{title}</h3><p className="hint max-w-sm">{children}</p>{action}</div>;
}
function Summary({ label, value, detail, icon }: { label: string; value: ReactNode; detail: ReactNode; icon: ReactNode }) {
  return <div className="project-summary"><div className="flex items-center justify-between gap-2 text-muted-foreground"><span>{label}</span>{icon}</div><div className="project-summary-value">{value}</div><div className="hint truncate">{detail}</div></div>;
}
export function Projects() {
  const { data: projects, error, reload, update } = useData<Project[]>('/api/projects', 10000);
  const { data: me } = useData<{ role: string }>('/api/me');
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [autoOnly, setAutoOnly] = useState(false);
  const refreshProjects = async () => { try { update(await api<Project[]>('/api/projects')); } catch (error) { setNotice((error as Error).message); } };
  const selected = projects?.find(item => item.id === selectedId) ?? projects?.[0];
  const filtered = projects?.filter(project => (!autoOnly || project.autoRun.enabled) && `${project.name} ${project.repository}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <div className="projects-page">
    <header className="project-page-heading"><div><h1>项目</h1><p className="hint mt-1">管理仓库、浏览测试用例，追踪每一次运行。</p></div>{me?.role === 'admin' && <Button onClick={() => setCreating(true)}><Plus className="size-3.5" />创建项目</Button>}</header>
    {error && <p role="alert" className="project-alert">{error}<Button variant="ghost" onClick={reload}>重试</Button></p>}
    {notice && <div role="status" className="project-notice"><Check className="size-4 shrink-0" /><span>{notice}</span><Button variant="ghost" size="icon" aria-label="关闭提示" onClick={() => setNotice('')}><X className="size-3.5" /></Button></div>}
    {!projects && !error && <p role="status" className="p-6 text-muted-foreground">正在加载项目…</p>}
    {projects && !projects.length && <div className="project-panel"><EmptyState title="连接你的第一个项目" action={me?.role === 'admin' && <Button onClick={() => setCreating(true)}><Plus className="size-3.5" />创建项目</Button>}>添加 GitLab 仓库，扫描并发现测试用例。{me?.role !== 'admin' && '请联系管理员创建项目。'}</EmptyState></div>}
    {!!projects?.length && <div className="project-workspace">
      <aside className="project-sidebar"><div className="flex items-center justify-between"><h2>所有项目</h2><Badge variant="secondary">{projects.length}</Badge></div>
        <div className="project-search"><Search className="size-3.5" /><Input className="pl-7" aria-label="搜索项目" placeholder="搜索项目或仓库…" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <label className="flex items-center gap-2 text-muted-foreground"><Checkbox checked={autoOnly} onCheckedChange={value => setAutoOnly(value === true)} />仅自动运行</label>
        <nav aria-label="项目列表" className="project-list">{filtered.map(project => <button type="button" key={project.id} className="project-list-item" aria-current={selected?.id === project.id ? 'true' : undefined} onClick={() => { setSelectedId(project.id); setNotice(''); }}>
          <FolderGit2 className="size-4 mt-0.5 shrink-0" /><span className="min-w-0 flex-1"><strong className="block truncate font-medium">{project.name}</strong><span className="project-list-meta"><GitBranch className="size-3" /><span className="truncate">{project.defaultBranch}</span></span><small className="text-muted-foreground">自动运行{project.autoRun.enabled ? '已启用' : '关闭'}</small></span><ChevronRight className="size-3.5 self-center text-muted-foreground" />
        </button>)}</nav>{!filtered.length && <p className="hint py-6 text-center">没有匹配的项目</p>}
      </aside>
      {selected && <ProjectDetail key={selected.id} project={selected} role={me?.role ?? 'member'} changed={() => void refreshProjects()} notify={setNotice} />}
    </div>}
    {creating && <Dialog title="创建项目" description="连接 GitLab 仓库，自动发现测试套件与运行场景。" wide busy={saving} onClose={() => setCreating(false)}><ProjectEditor project={emptyProject()} creating saved={() => { reload(); setCreating(false); }} notify={setNotice} cancel={() => setCreating(false)} busyChanged={setSaving} /></Dialog>}
  </div>;
}

type RunSelection = { suite: string; caseId?: string; title: string };
type ProjectDialog = 'scan' | 'scans' | 'edit' | 'auto' | 'delete' | null;
function ProjectDetail({ project, role, changed, notify }: { project: Project; role: string; changed: () => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState('tests');
  const [catalogId, setCatalogId] = useState('');
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<ProjectDialog>(null);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<RunSelection | null>(null);
  const { data: status, error: statusError, reload: reloadStatus } = useData<ProjectStatus>(`/api/projects/${project.id}/status`, 5000);
  const { data: scans, error: scansError, reload: reloadScans } = useData<CatalogScan[]>(`/api/projects/${project.id}/scans`, 5000);
  const { data: catalogs, error: catalogsError, reload: reloadCatalogs } = useData<TestCatalog[]>(`/api/projects/${project.id}/catalogs`, 5000);
  const { data: requests, error: historyError, reload: reloadRequests } = useData<{ items: TestRequest[] }>(`/api/requests?projectId=${encodeURIComponent(project.id)}&limit=100`, 5000);
  const history = [...(requests?.items.filter(request => request.projectId === project.id) ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const readyCatalogs = [...(catalogs?.filter(item => item.configRevision === project.configRevision && item.status === 'ready') ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const current = readyCatalogs.find(item => item.catalogId === catalogId) ?? readyCatalogs[0];
  const latestScan = [...(scans ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0] ?? status?.latestScan;
  const activeScans = scans?.filter(scan => ['queued', 'running'].includes(scan.status)).length ?? 0;
  const count = current?.suites.reduce((total, suite) => total + suite.cases.length, 0) ?? 0;
  const visibleSuites = current?.suites.map(suite => ({ ...suite, cases: suite.cases.filter(item => `${suite.id} ${item.file} ${item.titlePath.join(' ')}`.toLowerCase().includes(filter.toLowerCase())) })).filter(suite => suite.cases.length > 0) ?? [];
  const canScan = role === 'admin' || role === 'operator';
  const canRun = Boolean(status?.ready && current?.scenarios.length);
  const refresh = () => { reloadStatus(); reloadScans(); reloadCatalogs(); reloadRequests(); };
  const runReason = !status?.ready ? '项目尚未就绪，请检查项目设置' : !current?.scenarios.length ? '仓库尚未声明运行场景' : undefined;
  return <section className="project-detail">
    <header className="project-detail-heading"><div className="project-avatar"><FolderGit2 className="size-5" /></div><div className="min-w-0 flex-1"><h2>{project.name}</h2><p className="hint break-all mt-1">{project.repository}</p><div className="project-meta"><span><GitBranch className="size-3" />{project.defaultBranch}</span><span>配置版本 {project.configRevision}</span><span>{status ? status.ready ? '项目已就绪' : '待完成配置' : '正在检查配置'}</span></div></div>{role === 'admin' && <Button variant="outline" onClick={() => setDialog('edit')}><Settings2 className="size-3.5" />编辑项目</Button>}</header>
    <div className="project-summaries">
      <Summary label="测试用例" value={catalogs ? count : '—'} detail={current ? `${current.suites.length} 个套件 · ${current.scenarios.length} 个场景` : '扫描仓库后自动发现'} icon={<ListChecks className="size-4" />} />
      <Summary label="最近扫描" value={latestScan ? <StatusBadge value={latestScan.status} /> : '尚未扫描'} detail={latestScan ? `${latestScan.branch ?? latestScan.commit.slice(0, 10)} · ${dateTime(latestScan.createdAt)}` : '连接仓库并生成测试目录'} icon={<ScanLine className="size-4" />} />
      <Summary label="最近运行" value={history[0] ? <StatusBadge value={history[0].state === 'completed' ? history[0].verdict : history[0].state} /> : '暂无运行'} detail={history[0] ? `${history[0].input.suite} · ${dateTime(history[0].createdAt)}` : '选择套件或用例开始运行'} icon={<Play className="size-4" />} />
      <Summary label="自动运行" value={project.autoRun.enabled ? '已启用' : '未启用'} detail={project.autoRun.enabled ? `Push → ${project.autoRun.branch}` : '手动触发测试任务'} icon={<GitBranch className="size-4" />} />
    </div>
    {statusError && <p role="alert" className="project-alert">项目状态加载失败：{statusError}<Button variant="ghost" onClick={reloadStatus}>重试</Button></p>}
    <Tabs value={tab} onValueChange={setTab}>
      <div className="project-content-heading"><TabsList aria-label="项目详情"><TabsTrigger value="tests">测试用例</TabsTrigger><TabsTrigger value="runs">运行记录</TabsTrigger><TabsTrigger value="settings">项目设置</TabsTrigger></TabsList><Button variant="ghost" size="sm" onClick={refresh} aria-label="刷新项目数据"><History className="size-3.5" />刷新</Button></div>
      <TabsContent value="tests">
        <div className="project-panel">
          <div className="project-toolbar"><div className="project-search"><Search className="size-3.5" /><Input className="pl-7" aria-label="筛选文件或用例名称" placeholder="搜索用例、文件或套件…" value={filter} onChange={event => setFilter(event.target.value)} /></div>
            <NativeSelect aria-label="已扫描版本" value={current?.catalogId ?? ''} disabled={!readyCatalogs.length} onChange={event => { setCatalogId(event.target.value); setFilter(''); }}><option value="" disabled>暂无可用版本</option>{readyCatalogs.map(catalog => <option key={catalog.catalogId} value={catalog.catalogId}>{catalog.commit.slice(0, 10)} · {dateTime(catalog.createdAt)}</option>)}</NativeSelect>
            <Button variant="outline" onClick={() => setDialog('scans')}><History className="size-3.5" />扫描记录{activeScans > 0 && <Badge variant="secondary">{activeScans}</Badge>}</Button>
            {canScan && <Button onClick={() => setDialog('scan')}><ScanLine className="size-3.5" />扫描仓库</Button>}
          </div>
          {catalogsError ? <p role="alert" className="project-alert m-3">{catalogsError}<Button variant="ghost" onClick={reloadCatalogs}>重试</Button></p> : !catalogs ? <p role="status" className="p-6 text-muted-foreground">正在加载测试目录…</p> : !current ? <EmptyState title={activeScans ? '正在发现测试用例' : '还没有可用的测试目录'} action={canScan && <Button variant="outline" onClick={() => setDialog(activeScans ? 'scans' : 'scan')}>{activeScans ? '查看扫描进度' : '扫描默认分支'}</Button>}>{activeScans ? '扫描完成后，测试套件与用例会自动显示在这里。' : `扫描 ${project.defaultBranch} 分支或指定提交，发现此配置版本的测试套件与场景。`}</EmptyState> : <>
            <div className="project-catalog-meta"><span className="flex items-center gap-1.5"><GitCommitHorizontal className="size-3.5" /><code title={current.commit}>{current.commit.slice(0, 12)}</code><span>·</span>{count} 个用例</span><span>扫描于 {dateTime(current.createdAt)}</span></div>
            {!current.scenarios.length && <div role="status" className="project-inline-note">仓库尚未声明运行场景，可浏览用例；运行前请在 fliwright.config.ts 中声明场景。</div>}
            {!status?.ready && status && <div className="project-inline-note">项目尚未就绪。<Button variant="link" size="sm" onClick={() => setTab('settings')}>检查项目设置<ChevronRight className="size-3" /></Button></div>}
            {!visibleSuites.length && <EmptyState title={filter ? '没有匹配的测试用例' : '这个版本还没有测试用例'} action={filter && <Button variant="ghost" onClick={() => setFilter('')}>清除搜索</Button>}>{filter ? '试试其他名称、文件路径或套件名称。' : '检查套件路径，或扫描其他提交。'}</EmptyState>}
            {visibleSuites.map(suite => <section key={suite.id} className="project-suite"><header><div className="flex items-center gap-2"><ListChecks className="size-4 text-muted-foreground" /><h3>{suite.id}</h3><Badge variant="secondary">{suite.cases.length}</Badge></div><Button size="sm" variant="outline" disabled={!canRun} title={runReason} onClick={() => { setCatalogId(current.catalogId); setSelection({ suite: suite.id, title: suite.id }); }}><Play className="size-3" />运行套件</Button></header>
              <ul className="project-cases">{suite.cases.map(item => {
                const recent = history.find(request => request.selection?.caseId === item.caseId && request.input.commit === current.commit);
                return <li key={item.caseId}><ListChecks className="size-4 text-muted-foreground shrink-0" /><div className="min-w-0 flex-1"><p className="font-medium break-words">{item.titlePath.join(' › ')}{item.duplicateIndex > 0 ? `（同名 #${item.duplicateIndex + 1}）` : ''}</p><code className="hint break-all">{item.file}</code></div><span className="project-case-status">{recent ? <StatusBadge value={recent.state === 'completed' ? recent.verdict : recent.state} /> : <span className="hint">未运行</span>}</span><Button size="sm" variant="ghost" disabled={!canRun} title={runReason} aria-label={`运行此用例：${item.titlePath.join(' › ')}`} onClick={() => { setCatalogId(current.catalogId); setSelection({ suite: suite.id, caseId: item.caseId, title: item.titlePath.join(' › ') }); }}><Play className="size-3.5" /><span className="hidden sm:inline">运行</span></Button></li>;
              })}</ul>
            </section>)}
          </>}
        </div>
      </TabsContent>
      <TabsContent value="runs"><RunHistory history={history} error={historyError} loading={!requests} retry={reloadRequests} /></TabsContent>
      <TabsContent value="settings"><div className="project-settings-grid">
        <section className="project-panel p-4"><div className="project-section-heading"><h3>仓库与运行配置</h3>{role === 'admin' && <Button variant="outline" size="sm" onClick={() => setDialog('edit')}>编辑配置</Button>}</div><dl className="project-definition"><dt>默认分支</dt><dd>{project.defaultBranch}</dd><dt>Flutter 目录</dt><dd><code>{project.projectPath}</code></dd><dt>入口文件</dt><dd><code>{project.entry}</code></dd><dt>测试套件</dt><dd>{Object.keys(project.suites).join('、') || '未配置'}</dd><dt>运行超时</dt><dd>{project.timeoutMs / 60000} 分钟</dd></dl></section>
        <section className="project-panel p-4"><div className="project-section-heading"><h3>Push 自动运行</h3>{role === 'admin' && <Button variant="outline" size="sm" onClick={() => setDialog('auto')}>配置自动运行</Button>}</div><dl className="project-definition"><dt>当前策略</dt><dd>{project.autoRun.enabled ? '已启用' : '未启用'}</dd><dt>触发分支</dt><dd>{project.autoRun.branch}</dd><dt>运行组合</dt><dd>{project.autoRun.selections.length} 个</dd><dt>Webhook</dt><dd>{project.webhookStatus === 'configured' ? '已配置' : project.webhookStatus === 'disabled' ? '未启用' : project.webhookStatus}</dd></dl></section>
        <section className="project-panel p-4"><div className="project-section-heading"><h3>项目就绪检查</h3><Badge variant="secondary">{status ? status.ready ? '已就绪' : '待处理' : '加载中'}</Badge></div>{status?.blockers.length ? <ul className="list-disc pl-4 space-y-2 text-muted-foreground">{status.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul> : <p className="hint">{status?.ready ? '项目配置完整，可以提交测试任务。' : '扫描仓库并检查项目配置。'}</p>}{role === 'admin' && status && !status.ready && <Button className="mt-3" variant="outline" onClick={async () => { try { await api(`/api/projects/${project.id}/ready`, 'POST', {}); reloadStatus(); notify('项目已确认就绪。'); } catch (error) { notify((error as Error).message); } }}>重新检查并确认就绪</Button>}</section>
        {role === 'admin' && <section className="project-panel p-4"><h3>删除项目</h3><p className="hint mt-2 mb-3">移除项目配置。此操作无法撤销。</p><Button variant="outline" className="text-destructive" onClick={() => setDialog('delete')}><Trash2 className="size-3.5" />删除项目</Button></section>}
      </div></TabsContent>
    </Tabs>
    {dialog === 'edit' && <Dialog title="编辑项目" description={`${project.name} · 保存后将更新配置版本，请重新扫描测试目录。`} wide busy={editing} onClose={() => setDialog(null)}><ProjectEditor project={project} creating={false} saved={() => { changed(); refresh(); setDialog(null); }} notify={notify} cancel={() => setDialog(null)} busyChanged={setEditing} /></Dialog>}
    {dialog === 'auto' && <Dialog title="配置自动运行" description="GitLab Push 后，按分支与测试组合自动创建任务。" busy={editing} onClose={() => setDialog(null)}><div className="cloud-dialog-body"><AutoRunSettings project={project} changed={changed} notify={notify} busyChanged={setEditing} /></div><footer className="cloud-dialog-footer"><Button variant="outline" disabled={editing} onClick={() => setDialog(null)}>完成</Button></footer></Dialog>}
    {dialog === 'scan' && <ScanDialog project={project} close={() => setDialog(null)} submitted={() => { refresh(); setDialog('scans'); notify('仓库扫描已排队。'); }} />}
    {dialog === 'scans' && <Dialog title="扫描记录" description="扫描完成后可切换目录版本；失败详情可在记录中展开。" wide onClose={() => setDialog(null)}><div className="cloud-dialog-body"><ScanHistory scans={scans} error={scansError} canCancel={canScan} projectId={project.id} changed={refresh} retry={reloadScans} /></div><footer className="cloud-dialog-footer"><Button variant="outline" onClick={() => setDialog(null)}>关闭</Button>{canScan && <Button onClick={() => setDialog('scan')}><Plus className="size-3.5" />新建扫描</Button>}</footer></Dialog>}
    {dialog === 'delete' && <DeleteProjectDialog project={project} close={() => setDialog(null)} deleted={() => { setDialog(null); changed(); notify('项目已删除。'); }} />}
    {selection && current && <RunDialog key={`${current.catalogId}:${selection.caseId ?? selection.suite}`} project={project} catalog={current} selection={selection} ready={Boolean(status?.ready)} close={() => setSelection(null)} submitted={id => { setSelection(null); reloadRequests(); notify(`任务已提交：${id}`); setTab('runs'); }} />}
  </section>;
}

function ScanDialog({ project, close, submitted }: { project: Project; close: () => void; submitted: () => void }) {
  const [mode, setMode] = useState('branch');
  const [commit, setCommit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Dialog title="扫描仓库" description="发现测试套件、用例与场景。扫描不会执行测试。" busy={busy} onClose={close}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || (mode === 'commit' && !/^[0-9a-f]{40}$/.test(commit))) return;
      setBusy(true); setError('');
      try { await api(`/api/projects/${project.id}/scans`, 'POST', mode === 'commit' ? { commit } : {}); submitted(); }
      catch (error) { setError((error as Error).message); } finally { setBusy(false); }
    }}>
      <div className="cloud-dialog-body space-y-4">
        {error && <p role="alert" className="project-alert">{error}</p>}
        <fieldset disabled={busy} className="space-y-3"><legend className="font-medium mb-2">扫描来源</legend>
          <label className="project-radio"><input type="radio" name="scan-mode" value="branch" checked={mode === 'branch'} onChange={() => setMode('branch')} /><span><strong>默认分支</strong><small>检测仓库连接，扫描 {project.defaultBranch} 的最新提交</small></span><GitBranch className="size-4 text-muted-foreground" /></label>
          <label className="project-radio"><input type="radio" name="scan-mode" value="commit" checked={mode === 'commit'} onChange={() => setMode('commit')} /><span><strong>指定提交</strong><small>为一个确定的版本生成测试目录</small></span><GitCommitHorizontal className="size-4 text-muted-foreground" /></label>
          {mode === 'commit' && <label className="grid gap-2"><span>完整 Commit SHA</span><Input autoFocus required pattern="[0-9a-f]{40}" aria-label="完整 Commit SHA" placeholder="输入 40 位提交 SHA" value={commit} onChange={event => setCommit(event.target.value.trim())} /><span className="hint">从 GitLab 复制完整的 40 位提交 SHA。</span></label>}
        </fieldset>
      </div>
      <footer className="cloud-dialog-footer"><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button type="submit" disabled={busy || (mode === 'commit' && !/^[0-9a-f]{40}$/.test(commit))}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ScanLine className="size-3.5" />}{busy ? '提交中…' : '开始扫描'}</Button></footer>
    </form>
  </Dialog>;
}
function ScanHistory({ scans, error, canCancel, projectId, changed, retry }: { scans?: CatalogScan[]; error: string; canCancel: boolean; projectId: string; changed: () => void; retry: () => void }) {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(10);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const filtered = [...(scans ?? [])].sort((a, b) => b.createdAt - a.createdAt).filter(scan => filter === 'all' || (filter === 'active' ? ['queued', 'running'].includes(scan.status) : scan.status === filter));
  return <div className="space-y-3">
    <div className="w-36"><NativeSelect aria-label="筛选扫描状态" value={filter} onChange={event => { setFilter(event.target.value); setLimit(10); }}><option value="all">全部状态</option><option value="active">进行中</option><option value="ready">扫描完成</option><option value="failed">失败</option><option value="cancelled">已取消</option></NativeSelect></div>
    {(error || actionError) && <p role="alert" className="project-alert">{error || actionError}{error && <Button variant="ghost" onClick={retry}>重试</Button>}</p>}
    {!scans && !error ? <p role="status" className="hint py-6">正在加载扫描记录…</p> : !filtered.length ? <p className="hint py-8 text-center">暂无{filter === 'all' ? '' : '匹配的'}扫描记录。</p> : <Table aria-label="扫描记录列表"><TableHeader><TableRow><TableHead>分支 / 提交</TableHead><TableHead>状态</TableHead><TableHead>配置</TableHead><TableHead>发起时间</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{filtered.slice(0, limit).map(scan => <TableRow key={scan.scanId}>
      <TableCell><span className="block font-medium">{scan.branch ?? '指定提交'}</span><code className="hint" title={scan.commit}>{scan.commit.slice(0, 12)}</code>{scan.errorSummary && <details className="project-scan-error"><summary>查看失败原因</summary><p>{scan.errorSummary}</p></details>}</TableCell>
      <TableCell><StatusBadge value={scan.status} /></TableCell><TableCell>v{scan.configRevision}</TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(scan.createdAt)}</TableCell>
      <TableCell>{canCancel && ['queued', 'running'].includes(scan.status) && <Button size="sm" variant="ghost" disabled={Boolean(busyId)} onClick={async () => { setBusyId(scan.scanId); setActionError(''); try { await api(`/api/projects/${projectId}/scans/${scan.scanId}/cancel`, 'POST', {}); changed(); } catch (error) { setActionError((error as Error).message); } finally { setBusyId(''); } }}>{busyId === scan.scanId ? '取消中…' : '取消扫描'}</Button>}</TableCell>
    </TableRow>)}</TableBody></Table>}
    {filtered.length > limit && <Button variant="ghost" className="w-full" onClick={() => setLimit(limit + 10)}>显示更多（剩余 {filtered.length - limit} 条）</Button>}
  </div>;
}
function RunDialog({ project, catalog, selection, ready, close, submitted }: { project: Project; catalog: TestCatalog; selection: RunSelection; ready: boolean; close: () => void; submitted: (id: string) => void }) {
  const [scenario, setScenario] = useState(catalog.scenarios[0]?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Preserve the same key on retry when a successful response was lost.
  const [key] = useState(() => crypto.randomUUID());
  return <Dialog title={selection.caseId ? '运行测试用例' : '运行测试套件'} description="确认版本和运行场景后，将任务加入执行队列。" onClose={close} busy={busy}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || !ready || !catalog.scenarios.some(item => item.name === scenario)) return;
      setBusy(true); setError('');
      try {
        const result = await api<{ id: string }>(`/api/projects/${project.id}/requests`, 'POST', { projectId: project.id, commit: catalog.commit, catalogId: catalog.catalogId, mode: selection.caseId ? 'case' : 'suite', suite: selection.suite, scenario, ...(selection.caseId ? { caseId: selection.caseId } : {}) }, `${key}:${scenario}`);
        submitted(result.id);
      } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
    }}>
      <div className="cloud-dialog-body space-y-4">
        {error && <p role="alert" className="project-alert">{error}</p>}
        <div className="rounded-md bg-muted p-3"><p className="hint mb-1">{project.name} / {selection.suite}</p><p className="font-medium break-words">{selection.title}</p></div>
        <label className="grid gap-2"><span>运行版本</span><Input aria-label="运行 commit（完整 SHA）" readOnly value={catalog.commit} className="font-mono" /></label>
        <label className="grid gap-2"><span>运行场景</span><NativeSelect aria-label="运行场景" disabled={busy || !catalog.scenarios.length} value={scenario} onChange={event => setScenario(event.target.value)}>{catalog.scenarios.map(item => <option key={item.name}>{item.name}</option>)}</NativeSelect><span className="hint">仅显示该版本在仓库中声明的场景。</span></label>
        {!ready && <p role="alert" className="project-alert">项目尚未就绪，请先检查项目设置。</p>}
      </div>
      <footer className="cloud-dialog-footer"><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button type="submit" disabled={busy || !ready || !scenario}><Play className="size-3.5" />{busy ? '提交中…' : '确认运行'}</Button></footer>
    </form>
  </Dialog>;
}
function RunHistory({ history, error, loading, retry }: { history: TestRequest[]; error: string; loading: boolean; retry: () => void }) {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(15);
  const filtered = history.filter(request => filter === 'all' || (filter === 'active' ? ['queued', 'assigned', 'preparing', 'running', 'finalizing', 'cancel_requested'].includes(request.state) : filter === 'failed' ? request.state === 'infrastructure_failed' || (request.state === 'completed' && request.verdict === 'failed') : request.state === 'completed' && request.verdict === 'passed'));
  return <div className="project-panel"><div className="project-toolbar"><div><h3>运行记录</h3><p className="hint mt-1">最近 100 条任务，点击查看报告与执行详情。</p></div><div className="ml-auto w-36"><NativeSelect aria-label="筛选运行状态" value={filter} onChange={event => { setFilter(event.target.value); setLimit(15); }}><option value="all">全部状态</option><option value="active">进行中</option><option value="passed">通过</option><option value="failed">失败</option></NativeSelect></div></div>
    {error ? <p role="alert" className="project-alert m-3">{error}<Button variant="ghost" onClick={retry}>重试</Button></p> : loading ? <p className="hint p-6" role="status">正在加载运行记录…</p> : !filtered.length ? <EmptyState title={filter === 'all' ? '还没有运行记录' : '没有匹配的运行记录'}>在测试用例中选择一个套件或用例，确认场景后即可运行。</EmptyState> : <Table aria-label="运行记录列表"><TableHeader><TableRow><TableHead>测试任务</TableHead><TableHead>版本</TableHead><TableHead>状态</TableHead><TableHead>发起时间</TableHead><TableHead><span className="sr-only">查看详情</span></TableHead></TableRow></TableHeader><TableBody>{filtered.slice(0, limit).map(request => <TableRow key={request.id}><TableCell><Link className="font-medium" to="/requests/$id" params={{ id: request.id }}>{request.selection?.titlePath?.join(' › ') || request.input.suite}</Link><p className="hint">{request.input.scenario} · {request.source?.kind === 'push' ? 'GitLab Push' : '手动运行'}</p>{request.supersededBy && <Link className="text-xs" to="/requests/$id" params={{ id: request.supersededBy }}>查看替代任务</Link>}</TableCell><TableCell><code title={request.input.commit}>{request.input.commit.slice(0, 10)}</code></TableCell><TableCell><StatusBadge value={request.state === 'completed' ? request.verdict : request.state} /></TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(request.createdAt)}</TableCell><TableCell><Button asChild size="icon" variant="ghost"><Link to="/requests/$id" params={{ id: request.id }} aria-label={`查看任务 ${request.id}`}><ArrowUpRight className="size-4" /></Link></Button></TableCell></TableRow>)}</TableBody></Table>}
    {filtered.length > limit && <div className="p-2 text-center"><Button variant="ghost" onClick={() => setLimit(limit + 15)}>显示更多（剩余 {filtered.length - limit} 条）</Button></div>}
  </div>;
}
function DeleteProjectDialog({ project, close, deleted }: { project: Project; close: () => void; deleted: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Dialog title="删除项目" description="删除后无法恢复，请确认项目名称。" busy={busy} onClose={close}><form onSubmit={async event => {
    event.preventDefault(); if (busy || name !== project.name) return;
    setBusy(true); setError('');
    try { await api(`/api/projects/${project.id}`, 'DELETE'); deleted(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }}><div className="cloud-dialog-body space-y-4">{error && <p role="alert" className="project-alert">{error}</p>}<label className="grid gap-2"><span>输入 <strong>{project.name}</strong> 以确认删除</span><Input autoFocus aria-label="确认项目名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label></div><footer className="cloud-dialog-footer"><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button variant="destructive" type="submit" disabled={busy || name !== project.name}>{busy ? '删除中…' : '永久删除项目'}</Button></footer></form></Dialog>;
}
