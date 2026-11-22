import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from './components/ui/empty.js';
import { Alert } from './components/ui/alert.js';
import { Card } from './components/ui/card.js';
import React, { useEffect, useState, type ReactNode } from 'react';
import { activeProjectView, matchesProject, ProjectNavigation, ProjectRow, projectViews, type ProjectView } from './ProjectNavigation.js';
import type { ProjectDirectory } from './WorkspaceHeader.js';
import { repoPath } from './project-identity.js';
import { FolderGit2, GitBranch, GitCommitHorizontal, Plus, Play, ScanLine, ChevronRight, ArrowUpRight, Check, X, Clock3, LoaderCircle, CircleHelp, ListChecks, Trash2 } from 'lucide-react';
import type { CatalogScan, Project, TestCatalog, TestRequest } from '@fliwright/cloud-protocol';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { projectRepositoryDetails, projectSetupDefaults } from '../project-setup.js';
import { api, useData } from './data.js';
import { Input } from './components/ui/input.js';
import { Button } from './components/ui/button.js';
import { NativeSelect } from './components/ui/native-select.js';
import { Checkbox } from './components/ui/checkbox.js';
import { Textarea } from './components/ui/textarea.js';
import { CloudDialog as Dialog, DialogFooter } from './components/ui/dialog.js';
import { Badge } from './components/ui/badge.js';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table.js';
import { ScenarioBuilder } from './ScenarioBuilder.js';

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
  return <form className="[&_summary]:cursor-pointer [&_summary]:text-xs [&_summary]:font-medium [&_label]:min-w-0 [&_label]:text-xs [&_label>span:first-child]:font-medium" onSubmit={async event => {
    event.preventDefault(); if (busy || (creating && !repositoryDetails)) return; setBusy(true); busyChanged?.(true); setSaveError('');
    try {
      const { id: _id, configRevision: _revision, webhookSecretDigest: _digest, webhookStatus: _status, autoRun: _autoRun, ...settings } = draft;
      const body = creating ? { ...settings, repository: repositoryDetails?.repository ?? draft.repository } : { ...draft, webhookSecretDigest: undefined };
      await api(creating ? '/api/projects' : `/api/projects/${project.id}`, creating ? 'POST' : 'PUT', body);
      notify('项目配置已保存。'); saved();
    } catch (error) { setSaveError((error as Error).message); } finally { setBusy(false); busyChanged?.(false); }
  }}>
    <div className="p-4 grid gap-4 md:grid-cols-2">
    {saveError && <Alert asChild variant="destructive"><p role="alert" className="md:col-span-2">{saveError}</p></Alert>}
    <fieldset disabled={busy} className="contents">
    {creating ? <>
      <label className="grid gap-2 md:col-span-2"><span>GitLab 仓库 URL</span>
        <Input required autoFocus aria-label="GitLab 仓库 URL" placeholder="https://gitlab.example.com/team/my-app" value={draft.repository} onChange={event => {
          const repository = event.target.value, details = projectRepositoryDetails(repository);
          setDraft({ ...draft, repository, ...(!nameEdited ? { name: details?.name ?? '' } : {}) });
        }} />
      </label>
      {draft.repository && !repositoryDetails && <p role="alert" className="md:col-span-2">请输入完整的 GitLab 项目地址，例如 https://gitlab.example.com/team/my-app。</p>}
      {repositoryDetails && <div className="rounded-lg bg-muted/40 p-4 md:col-span-2 space-y-1"><p>项目名称：{draft.name || repositoryDetails.name}</p><p className="text-xs leading-[1.45] text-muted-foreground">默认使用 main 分支、仓库根目录和 lib/main.dart 入口，可在下方调整。</p></div>}
    </> : <>{field('name', '项目名称')}{field('repository', '仓库 HTTPS / SSH URL')}</>}
    <details open={creating ? undefined : true} className="md:col-span-2"><summary className="cursor-pointer">{creating ? '调整名称和项目配置（可选）' : '项目配置'}</summary>
    <div className="grid gap-4 pt-4 md:grid-cols-2">
    {creating && <Field label="项目名称" value={draft.name} change={name => { setNameEdited(Boolean(name)); setDraft({ ...draft, name: name || repositoryDetails?.name || '' }); }} />}
    {field('defaultBranch', '默认分支')}{field('projectPath', 'Flutter 项目目录')}{field('entry', 'Flutter 入口')}
    <Field label="只读仓库凭据引用" value={draft.repositoryCredentialRef ?? ''} change={value => setDraft({ ...draft, repositoryCredentialRef: value || null })} />
    <Field label="超时（毫秒）" type="number" value={String(draft.timeoutMs)} change={value => setDraft({ ...draft, timeoutMs: Number(value) })} />
    <label className="grid gap-1 text-sm"><span>场景名称（每行一个）</span><Textarea aria-label="场景名称" value={draft.scenarios.join('\n')} onChange={event => setDraft({ ...draft, scenarios: event.target.value.split('\n').map(name => name.trim()).filter(Boolean) })} /><span className="text-xs leading-[1.45] text-muted-foreground">可选。默认直接运行，不应用场景或加载 Mock 规则；命名场景用于额外的测试准备。</span></label>
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
    <details className="space-y-3 md:col-span-2"><summary>高级配置：安装命令（仅管理员）</summary><p className="text-xs leading-[1.45] text-muted-foreground">这些命令在 Worker 导入仓库前执行。参数每行一个；不经过 shell。</p>
      {draft.install.map((command, index) => <div className="grid gap-2 py-3" key={index}>
        <Field label={`程序 ${index + 1}`} value={command.program} change={value => setDraft({ ...draft, install: draft.install.map((item, i) => i === index ? { ...item, program: value } : item) })} />
        <Textarea aria-label={`参数 ${index + 1}`} value={command.args.join('\n')} onChange={event => setDraft({ ...draft, install: draft.install.map((item, i) => i === index ? { ...item, args: event.target.value.split('\n').filter(Boolean) } : item) })} />
        <Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, install: draft.install.filter((_, i) => i !== index) })}>移除命令</Button>
      </div>)}
      <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, install: [...draft.install, { program: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts'] }] })}>添加命令</Button>
    </details>
    </div></details>
    </fieldset></div>
    <DialogFooter className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3"><Button variant="ghost" disabled={busy} onClick={cancel}>取消</Button><Button disabled={busy || (creating && !repositoryDetails)} type="submit">{busy ? '保存中…' : creating ? '创建项目' : '保存项目配置'}</Button></DialogFooter>
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
    {error && <Alert asChild variant="destructive"><p role="alert">{error}</p></Alert>}
    {message && <p role="status" className="mx-3 mb-3 rounded-md bg-muted px-3 py-2 text-muted-foreground m-0">{message}</p>}
    <fieldset disabled={busy} className="space-y-4">
      <label className="flex items-center gap-2"><Checkbox checked={policy.enabled} onCheckedChange={value => setPolicy({ ...policy, enabled: value === true })} />启用自动运行</label>
      <Field label="自动运行分支" value={policy.branch} change={branch => setPolicy({ ...policy, branch })} />
      <div><h3 className="mb-2">运行组合</h3><div className="grid gap-2 rounded-md bg-muted/40 p-3">{Object.keys(project.suites).flatMap(suite => [undefined, ...project.scenarios].map(scenario => {
        const checked = policy.selections.some(item => item.suite === suite && item.scenario === scenario);
        return <label key={`${suite}:${scenario}`} className="flex items-center gap-2"><Checkbox checked={checked} onCheckedChange={value => setPolicy({ ...policy, selections: value === true ? [...policy.selections, { suite, ...(scenario ? { scenario } : {}) }] : policy.selections.filter(item => item.suite !== suite || item.scenario !== scenario) })} />{suite} / {scenario ?? '直接运行（无场景）'}</label>;
      }))}{!Object.keys(project.suites).length && <p className="text-xs leading-[1.45] text-muted-foreground">请先在项目配置中添加测试套件。</p>}</div></div>
      <Button onClick={() => void action(async () => { const { revision: _revision, ...body } = policy; await api(`/api/projects/${project.id}/auto-run`, 'PUT', body); }, '自动运行策略已保存。')}>保存策略</Button>
      <div className="space-y-3 border-t pt-4"><h3>Webhook 连接</h3><p className="text-xs leading-[1.45] text-muted-foreground">策略版本 {project.autoRun.revision} · {project.webhookStatus === 'configured' ? '已配置' : '未启用'}</p>
        <label className="grid gap-2"><span>Webhook URL</span><Input readOnly value={`${window.location.origin}/api/webhooks/gitlab/${project.id}`} aria-label="Webhook URL" /></label>
        <p className="text-xs leading-[1.45] text-muted-foreground">在 GitLab 中选择 Push events，并配置上面的分支。Secret Token 仅显示一次。</p>
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
function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <Empty><EmptyHeader><EmptyMedia><FolderGit2 /></EmptyMedia><EmptyTitle>{title}</EmptyTitle>{children && <EmptyDescription>{children}</EmptyDescription>}</EmptyHeader>{action && <EmptyContent>{action}</EmptyContent>}</Empty>;
}
function Summary({ label, value, detail, icon }: { label: string; value: ReactNode; detail: ReactNode; icon: ReactNode }) {
  return <section data-slot="project-summary" data-ui="project-summary" className="min-w-0 space-y-1"><div className="flex items-center justify-between gap-2 text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0"><span>{label}</span>{icon}</div><div className="flex min-h-6 items-center text-base font-semibold">{value}</div><div className="text-xs leading-[1.45] text-muted-foreground break-words">{detail}</div></section>;
}
export function Projects({ directory, role, createRequested = false, creationHandled }: { directory: ProjectDirectory; role?: string; createRequested?: boolean; creationHandled?: () => void }) {
  const { projectId } = useParams({ strict: false });
  const query = useSearch({strict: false}).q ?? '';
  const { data: projects, error, reload, update } = directory;
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!createRequested || !role) return;
    if (role === 'admin') setCreating(true);
    creationHandled?.();
  }, [createRequested, role, creationHandled]);
  const refreshProjects = async () => { try { update(await api<Project[]>('/api/projects')); } catch (error) { setNotice((error as Error).message); } };
  const selected = projects?.find(item => item.id === projectId);
  const matching = projects?.filter(project => matchesProject(project, query)) ?? [];
  return <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
    {error && <Alert asChild variant="destructive"><p role="alert">{error}<Button variant="ghost" onClick={reload}>重试</Button></p></Alert>}
    {notice && <div role="status" className="flex items-center gap-2 rounded-md bg-muted px-3 py-2"><Check className="size-4 shrink-0" /><span>{notice}</span><Button variant="ghost" size="icon" aria-label="关闭提示" onClick={() => setNotice('')}><X className="size-3.5" /></Button></div>}
    {!projects && !error && <p role="status" className="p-6 text-muted-foreground">正在加载项目…</p>}
    {projects && (selected ? <ProjectDetail key={selected.id} project={selected} role={role ?? 'member'} changed={() => void refreshProjects()} notify={setNotice} /> : <section className="project-directory"><header className="directory-heading" data-ui="project-page-heading"><h1>项目目录 <span className="lane-count">{matching.length}</span></h1>{role === 'admin' && <Button variant="outline" aria-label="创建项目" onClick={() => setCreating(true)}><Plus/>创建项目</Button>}</header>
      {projectId ? <EmptyState title="项目不存在" action={<Link to="/projects" search={{}}>所有项目</Link>} /> : !projects.length ? <EmptyState title="暂无项目">{role !== 'admin' && '请联系管理员创建项目。'}</EmptyState> : matching.length ? <nav className="project-listing" aria-label="项目目录">
        <div className="directory-columns" aria-hidden="true"><span>项目名称</span><span>仓库</span><span>默认分支</span><span>测试套件</span></div>
        {matching.map(project => <ProjectRow key={project.id} project={project} />)}
      </nav> : <EmptyState title="没有匹配的项目" action={<Link to="/projects" search={{}}>清除筛选</Link>} />}
    </section>)}
    {creating && <Dialog title="创建项目" wide busy={saving} onClose={() => setCreating(false)}><ProjectEditor project={emptyProject()} creating saved={() => { reload(); setCreating(false); }} notify={setNotice} cancel={() => setCreating(false)} busyChanged={setSaving} /></Dialog>}
  </div>;
}

type RunSelection = { suite: string; caseId?: string; title: string };
type CaseRunSummary = { id: string; suite: string; caseId: string; status: string };
type ProjectDialog = 'scan' | 'edit' | 'auto' | 'delete' | 'scenario' | null;
function ProjectDetail({project, role, changed, notify}: {project:Project; role:string; changed:()=>void; notify:(message:string)=>void}) {
  const search = useSearch({strict:false});
  const navigate = useNavigate();
  const tab = activeProjectView(search.view);
  const catalogId = search.v, filter = search.q ?? '';
  const setTab = (view:ProjectView) => void navigate({to:'/projects/$projectId',params:{projectId:project.id},search:{view,v:catalogId}});
  const setCatalogId = (v:string) => void navigate({to:'.',search: { ...search,v},replace:true,resetScroll:false});
  const setFilter = (q:string) => void navigate({to:'.',search: { ...search,q:q || undefined},replace:true,resetScroll:false});
  const [caseDetail, setCaseDetail] = useState<{ catalog:TestCatalog; suite:string; item:TestCatalog['suites'][number]['cases'][number] }>();
  const [runCatalog, setRunCatalog] = useState<TestCatalog>();
  const [dialog, setDialog] = useState<ProjectDialog>(null);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<RunSelection | null>(null);
  const [scenarioCatalog, setScenarioCatalog] = useState<TestCatalog>();
  const { data: status, error: statusError, reload: reloadStatus } = useData<ProjectStatus>(`/api/projects/${project.id}/status`, 5000);
  const { data: scans, error: scansError, reload: reloadScans } = useData<CatalogScan[]>(`/api/projects/${project.id}/scans`, 5000);
  const { data: catalogs, error: catalogsError, reload: reloadCatalogs } = useData<TestCatalog[]>(`/api/projects/${project.id}/catalogs`, 5000);
  const { data: requests, error: historyError, reload: reloadRequests } = useData<{ items: TestRequest[] }>(`/api/requests?projectId=${encodeURIComponent(project.id)}&limit=100`, 5000);
  const history = [...(requests?.items.filter(request => request.projectId === project.id) ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const readyCatalogs = [...(catalogs?.filter(item => item.configRevision === project.configRevision && item.status === 'ready') ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const current = readyCatalogs.find(item => item.catalogId === catalogId) ?? readyCatalogs[0];
  const { data: caseRuns, error: caseRunError, reload: reloadCaseRuns } = useData<{ catalogId: string; items: CaseRunSummary[] }>(
    `/api/projects/${project.id}/catalogs/${current?.catalogId}/case-runs`, 5000, tab === 'tests' && !!current,
  );
  const recentCases = new Map((caseRuns?.items ?? []).map(run => [JSON.stringify([run.suite, run.caseId]), run]));
  const detailRun = caseDetail && caseRuns?.catalogId === caseDetail.catalog.catalogId ? recentCases.get(JSON.stringify([caseDetail.suite, caseDetail.item.caseId])) : undefined;
  const latestScan = [...(scans ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0] ?? status?.latestScan;
  const activeScans = scans?.filter(scan => ['queued', 'running'].includes(scan.status)).length ?? 0;
  const count = current?.suites.reduce((total, suite) => total + suite.cases.length, 0) ?? 0;
  const visibleSuites = current?.suites.map(suite => ({ ...suite, cases: suite.cases.filter(item => `${suite.id} ${item.file} ${item.titlePath.join(' ')}`.toLowerCase().includes(filter.toLowerCase())) })).filter(suite => suite.cases.length > 0) ?? [];
  const canScan = role === 'admin' || role === 'operator';
  const canRun = Boolean(status?.ready && current);
  const openScenarioBuilder = () => { setScenarioCatalog(current); setDialog('scenario'); };
  const refresh = () => { reloadStatus(); reloadScans(); reloadCatalogs(); reloadRequests(); };
  const runReason = !status?.ready ? '项目尚未就绪，请检查项目设置' : undefined;
  return <section aria-label={`${project.name} 项目详情`} data-project-id={project.id} data-ui="project-detail" className="project-workspace">
    <header className="project-page-heading" data-ui="project-page-heading">
      <h1 className="sr-only">{project.name} · {projectViews[tab]}</h1>
      <ProjectNavigation view={tab} version={catalogId} selected={project} />
      {tab === 'tests' && readyCatalogs.length > 0 && <label className="catalog-version"><GitCommitHorizontal /><NativeSelect aria-label="已扫描版本" value={current?.catalogId ?? ''} onChange={event => setCatalogId(event.target.value)}>{readyCatalogs.map(catalog => <option key={catalog.catalogId} value={catalog.catalogId}>{catalog.commit.slice(0, 10)} · {dateTime(catalog.createdAt)}</option>)}</NativeSelect></label>}
      {tab === 'scans' && canScan && <Button onClick={() => setDialog('scan')}><Plus />新建扫描</Button>}
    </header>
    <div className={tab==='tests'?'case-workbody':'project-workbody'} data-scroll-restoration-id={`project-${project.id}-${tab}`}>
        {statusError && <Alert asChild variant="destructive"><p role="alert">项目状态加载失败：{statusError}<Button variant="ghost" onClick={reloadStatus}>重试</Button></p></Alert>}
      {tab === 'tests' && <>
          {catalogsError ? <Alert asChild variant="destructive"><p role="alert" className="m-3">{catalogsError}<Button variant="ghost" onClick={reloadCatalogs}>重试</Button></p></Alert> : !catalogs ? <p role="status" className="p-6 text-muted-foreground">正在加载测试目录…</p> : !current ? <EmptyState title={activeScans ? '正在发现测试用例' : '暂无测试目录'} action={canScan && <Button variant="outline" onClick={() => activeScans ? setTab('scans') : setDialog('scan')}>{activeScans ? '查看扫描进度' : '扫描默认分支'}</Button>} /> : <>
            {caseRunError && <Alert role="alert">用例运行状态加载失败。<Button variant="ghost" onClick={reloadCaseRuns}>重试</Button></Alert>}
            {!status?.ready && status && <div className="mx-3 mb-3 rounded-md bg-muted px-3 py-2 text-muted-foreground">项目尚未就绪。<Button variant="link" size="sm" onClick={() => setTab('settings')}>检查项目设置<ChevronRight className="size-3" /></Button></div>}
            {!visibleSuites.length && <EmptyState title={filter ? '没有匹配的测试用例' : '这个版本还没有测试用例'} action={filter && <Button variant="ghost" onClick={() => setFilter('')}>清除搜索</Button>} />}
            {visibleSuites.length>0 && <div className="case-deck" aria-label="测试用例套件" tabIndex={0} data-scroll-restoration-id={`suites-${project.id}-${current.catalogId}`}>{visibleSuites.map(suite=><section className="case-lane" key={suite.id}><header><FolderGit2/><h2>{suite.id}</h2><Badge variant="secondary">{suite.cases.length}</Badge><Button size="sm" variant="ghost" disabled={!canRun} title={runReason} aria-label={`运行套件 ${suite.id}`} onClick={()=>{setRunCatalog(current);setSelection({suite:suite.id,title:suite.id});}}><Play/>运行套件</Button></header><div className="case-list" tabIndex={0} aria-label={`${suite.id} 用例`} data-scroll-restoration-id={`cases-${current.catalogId}-${suite.id}`}>{suite.cases.map(item=>{
              const loaded = caseRuns?.catalogId === current.catalogId;
              const recent = loaded && recentCases.get(JSON.stringify([suite.id, item.caseId]));
              return <button type="button" className="case-ticket" key={item.caseId} onClick={()=>setCaseDetail({catalog:current,suite:suite.id,item})}><strong title={item.titlePath.join(' › ')}>{item.titlePath.join(' › ')}{item.duplicateIndex>0 && `（同名 #${item.duplicateIndex+1}）`}</strong><code title={item.file}>{item.file}</code><span>{recent ? <StatusBadge value={recent.status}/> : loaded ? '未运行' : caseRunError ? '状态未知' : '读取状态中…'}</span></button>;
            })}</div></section>)}</div>}
          </>}
      </>}
      {tab === 'scans' && <ScanHistory scans={scans} error={scansError} canCancel={canScan} projectId={project.id} changed={refresh} retry={reloadScans}/>}
      {tab === 'scenarios' && <div><Card asChild><section className="overflow-hidden p-4 space-y-4">
        <div className="flex items-center justify-between gap-2"><h3>运行场景{current && `（${current.scenarios.length}）`}</h3><Button onClick={openScenarioBuilder}><Plus className="size-3.5" />新建运行场景</Button></div>
        {catalogsError && <Alert asChild variant="destructive"><p role="alert">{catalogsError}<Button variant="ghost" onClick={reloadCatalogs}>重试</Button></p></Alert>}
        {current ? <><div className="flex flex-wrap items-center gap-3"><span className="text-xs leading-[1.45] text-muted-foreground">已扫描版本</span><NativeSelect aria-label="场景扫描版本" value={current.catalogId} onChange={event => setCatalogId(event.target.value)}>{readyCatalogs.map(catalog => <option key={catalog.catalogId} value={catalog.catalogId}>{catalog.commit.slice(0, 10)} · {dateTime(catalog.createdAt)}</option>)}</NativeSelect></div>
          {current.scenarios.length ? <ul className="divide-y">{current.scenarios.map(scenario => <li key={scenario.name} className="py-2 font-medium break-all">{scenario.name}</li>)}</ul> : <p className="text-muted-foreground">该版本暂无场景</p>}
        </> : <p className="text-muted-foreground">暂无扫描版本</p>}
      </section></Card></div>}
      {tab === 'runs' && <div><RunHistory history={history} error={historyError} loading={!requests} retry={reloadRequests} /></div>}
      {tab === 'settings' && <div className="space-y-3">
    <section aria-label="项目状态" className="settings-summary">
      <Summary label="测试用例" value={catalogs ? count : '—'} detail={current && `${current.suites.length} 个套件 · ${current.scenarios.length} 个场景`} icon={<ListChecks />} />
      <Summary label="最近扫描" value={latestScan ? <StatusBadge value={latestScan.status} /> : '尚未扫描'} detail={latestScan && `${latestScan.branch ?? latestScan.commit.slice(0, 10)} · ${dateTime(latestScan.createdAt)}`} icon={<ScanLine />} />
      <Summary label="最近运行" value={history[0] ? <StatusBadge value={history[0].state === 'completed' ? history[0].verdict : history[0].state} /> : '暂无运行'} detail={history[0] && `${history[0].input.suite} · ${dateTime(history[0].createdAt)}`} icon={<Play />} />
      <Summary label="自动运行" value={project.autoRun.enabled ? '已启用' : '未启用'} detail={project.autoRun.enabled && project.autoRun.branch} icon={<GitBranch />} />
    </section>
<div className="grid gap-3 md:grid-cols-2">
        <Card asChild><section className="overflow-hidden p-4"><div className="mb-4 flex items-center justify-between gap-2"><h3>仓库与运行配置</h3>{role === 'admin' && <Button variant="outline" size="sm" onClick={() => setDialog('edit')}>编辑配置</Button>}</div><dl className="grid gap-x-3 gap-y-3 grid-cols-[88px_minmax(0,1fr)] [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:break-words"><dt>仓库</dt><dd><code>{repoPath(project.repository)}</code></dd><dt>默认分支</dt><dd>{project.defaultBranch}</dd><dt>配置版本</dt><dd>{project.configRevision}</dd><dt>Flutter 目录</dt><dd><code>{project.projectPath}</code></dd><dt>入口文件</dt><dd><code>{project.entry}</code></dd><dt>测试套件</dt><dd>{Object.keys(project.suites).join('、') || '未配置'}</dd><dt>运行超时</dt><dd>{project.timeoutMs / 60000} 分钟</dd></dl></section></Card>
        <Card asChild><section className="overflow-hidden p-4"><div className="mb-4 flex items-center justify-between gap-2"><h3>Push 自动运行</h3>{role === 'admin' && <Button variant="outline" size="sm" onClick={() => setDialog('auto')}>配置自动运行</Button>}</div><dl className="grid gap-x-3 gap-y-3 grid-cols-[88px_minmax(0,1fr)] [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:break-words"><dt>当前策略</dt><dd>{project.autoRun.enabled ? '已启用' : '未启用'}</dd><dt>触发分支</dt><dd>{project.autoRun.branch}</dd><dt>运行组合</dt><dd>{project.autoRun.selections.length} 个</dd><dt>Webhook</dt><dd>{project.webhookStatus === 'configured' ? '已配置' : project.webhookStatus === 'disabled' ? '未启用' : project.webhookStatus}</dd></dl></section></Card>
        <Card asChild><section className="overflow-hidden p-4"><div className="mb-4 flex items-center justify-between gap-2"><h3>项目就绪检查</h3><Badge variant="secondary">{status ? status.ready ? '已就绪' : '待处理' : '加载中'}</Badge></div>{status?.blockers.length ? <ul className="list-disc pl-4 space-y-2 text-muted-foreground">{status.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul> : null}{role === 'admin' && status && !status.ready && <Button className="mt-3" variant="outline" onClick={async () => { try { await api(`/api/projects/${project.id}/ready`, 'POST', {}); reloadStatus(); notify('项目已确认就绪。'); } catch (error) { notify((error as Error).message); } }}>重新检查并确认就绪</Button>}</section></Card>
        {role === 'admin' && <Card asChild><section className="overflow-hidden p-4"><h3>删除项目</h3><p className="text-xs leading-[1.45] text-muted-foreground mt-2 mb-3">移除项目配置。此操作无法撤销。</p><Button variant="outline" className="text-destructive" onClick={() => setDialog('delete')}><Trash2 className="size-3.5" />删除项目</Button></section></Card>}
      </div></div>}
    </div>
    {dialog === 'edit' && <Dialog title="编辑项目" description={`${project.name} · 保存后将更新配置版本，请重新扫描测试目录。`} wide busy={editing} onClose={() => setDialog(null)}><ProjectEditor project={project} creating={false} saved={() => { changed(); refresh(); setDialog(null); }} notify={notify} cancel={() => setDialog(null)} busyChanged={setEditing} /></Dialog>}
    {dialog === 'auto' && <Dialog title="配置自动运行" busy={editing} onClose={() => setDialog(null)}><div className="p-4"><AutoRunSettings project={project} changed={changed} notify={notify} busyChanged={setEditing} /></div><DialogFooter className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3"><Button variant="outline" disabled={editing} onClick={() => setDialog(null)}>完成</Button></DialogFooter></Dialog>}
    {caseDetail && <Dialog title={caseDetail.item.titlePath.join(' › ')} description={`${project.name} · ${repoPath(project.repository)}`} onClose={()=>setCaseDetail(undefined)}><dl className="case-facts"><dt>套件</dt><dd>{caseDetail.suite}</dd><dt>测试文件</dt><dd>{caseDetail.item.file}</dd><dt>扫描版本</dt><dd>{caseDetail.catalog.commit}</dd></dl><DialogFooter className="p-3">{detailRun && <Button variant="outline" asChild><Link to="/requests/$id" params={{id:detailRun.id}}>最近运行</Link></Button>}<Button disabled={!status?.ready} onClick={()=>{setRunCatalog(caseDetail.catalog);setSelection({suite:caseDetail.suite,caseId:caseDetail.item.caseId,title:caseDetail.item.titlePath.join(' › ')});setCaseDetail(undefined);}}><Play/>运行用例</Button></DialogFooter></Dialog>}
    {dialog === 'scan' && <ScanDialog project={project} close={() => setDialog(null)} submitted={() => { refresh(); setDialog(null); setTab('scans'); notify('仓库扫描已排队。'); }} />}
    {dialog === 'delete' && <DeleteProjectDialog project={project} close={() => setDialog(null)} deleted={() => { setDialog(null); changed(); notify('项目已删除。'); }} />}
    {dialog === 'scenario' && <ScenarioBuilder catalog={scenarioCatalog} close={() => setDialog(null)} />}
    {selection && runCatalog && <RunDialog key={`${runCatalog.catalogId}:${selection.caseId ?? selection.suite}`} project={project} catalog={runCatalog} selection={selection} ready={Boolean(status?.ready)} close={() => setSelection(null)} submitted={id => { setSelection(null); reloadRequests(); notify(`任务已提交：${id}`); setTab('runs'); }} />}
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
      <div className="p-4 space-y-4">
        {error && <Alert asChild variant="destructive"><p role="alert">{error}</p></Alert>}
        <fieldset disabled={busy} className="space-y-3"><legend className="font-medium mb-2">扫描来源</legend>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-muted/30 p-3 has-[:checked]:bg-muted [&_input]:accent-primary [&>span]:min-w-0 [&>span]:flex-1 [&_strong]:block [&_strong]:font-medium [&_small]:mt-1 [&_small]:block [&_small]:text-muted-foreground"><input type="radio" name="scan-mode" value="branch" checked={mode === 'branch'} onChange={() => setMode('branch')} /><span><strong>默认分支</strong><small>检测仓库连接，扫描 {project.defaultBranch} 的最新提交</small></span><GitBranch className="size-4 text-muted-foreground" /></label>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-muted/30 p-3 has-[:checked]:bg-muted [&_input]:accent-primary [&>span]:min-w-0 [&>span]:flex-1 [&_strong]:block [&_strong]:font-medium [&_small]:mt-1 [&_small]:block [&_small]:text-muted-foreground"><input type="radio" name="scan-mode" value="commit" checked={mode === 'commit'} onChange={() => setMode('commit')} /><span><strong>指定提交</strong><small>为一个确定的版本生成测试目录</small></span><GitCommitHorizontal className="size-4 text-muted-foreground" /></label>
          {mode === 'commit' && <label className="grid gap-2"><span>完整 Commit SHA</span><Input autoFocus required pattern="[0-9a-f]{40}" aria-label="完整 Commit SHA" placeholder="输入 40 位提交 SHA" value={commit} onChange={event => setCommit(event.target.value.trim())} /></label>}
        </fieldset>
      </div>
      <DialogFooter className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3"><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button type="submit" disabled={busy || (mode === 'commit' && !/^[0-9a-f]{40}$/.test(commit))}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ScanLine className="size-3.5" />}{busy ? '提交中…' : '开始扫描'}</Button></DialogFooter>
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
    {(error || actionError) && <Alert asChild variant="destructive"><p role="alert">{error || actionError}{error && <Button variant="ghost" onClick={retry}>重试</Button>}</p></Alert>}
    {!scans && !error ? <p role="status" className="text-xs leading-[1.45] text-muted-foreground py-6">正在加载扫描记录…</p> : !filtered.length ? <p className="text-xs leading-[1.45] text-muted-foreground py-8 text-center">暂无{filter === 'all' ? '' : '匹配的'}扫描记录。</p> : <Table aria-label="扫描记录列表"><TableHeader><TableRow><TableHead>分支 / 提交</TableHead><TableHead>状态</TableHead><TableHead>配置</TableHead><TableHead>发起时间</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{filtered.slice(0, limit).map(scan => <TableRow key={scan.scanId}>
      <TableCell><span className="block font-medium">{scan.branch ?? '指定提交'}</span><code className="text-xs leading-[1.45] text-muted-foreground" title={scan.commit}>{scan.commit.slice(0, 12)}</code>{scan.errorSummary && <details className="mt-2 max-w-xs text-[10px] [&_summary]:cursor-pointer [&_summary]:text-destructive [&_p]:mt-2 [&_p]:whitespace-pre-wrap [&_p]:break-words [&_p]:rounded-md [&_p]:bg-muted [&_p]:p-2 [&_p]:text-muted-foreground"><summary>查看失败原因</summary><p>{scan.errorSummary}</p></details>}</TableCell>
      <TableCell><StatusBadge value={scan.status} /></TableCell><TableCell>v{scan.configRevision}</TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(scan.createdAt)}</TableCell>
      <TableCell>{canCancel && ['queued', 'running'].includes(scan.status) && <Button size="sm" variant="ghost" disabled={Boolean(busyId)} onClick={async () => { setBusyId(scan.scanId); setActionError(''); try { await api(`/api/projects/${projectId}/scans/${scan.scanId}/cancel`, 'POST', {}); changed(); } catch (error) { setActionError((error as Error).message); } finally { setBusyId(''); } }}>{busyId === scan.scanId ? '取消中…' : '取消扫描'}</Button>}</TableCell>
    </TableRow>)}</TableBody></Table>}
    {filtered.length > limit && <Button variant="ghost" className="w-full" onClick={() => setLimit(limit + 10)}>显示更多（剩余 {filtered.length - limit} 条）</Button>}
  </div>;
}
function RunDialog({ project, catalog, selection, ready, close, submitted }: { project: Project; catalog: TestCatalog; selection: RunSelection; ready: boolean; close: () => void; submitted: (id: string) => void }) {
  const [scenario, setScenario] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Preserve the same key on retry when a successful response was lost.
  const [key] = useState(() => crypto.randomUUID());
  return <Dialog title={selection.caseId ? '运行测试用例' : '运行测试套件'} onClose={close} busy={busy}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || !ready || (scenario && !catalog.scenarios.some(item => item.name === scenario))) return;
      setBusy(true); setError('');
      try {
        const result = await api<{ id: string }>(`/api/projects/${project.id}/requests`, 'POST', { projectId: project.id, commit: catalog.commit, catalogId: catalog.catalogId, mode: selection.caseId ? 'case' : 'suite', suite: selection.suite, ...(scenario ? { scenario } : {}), ...(selection.caseId ? { caseId: selection.caseId } : {}) }, `${key}:${scenario}`);
        submitted(result.id);
      } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
    }}>
      <div className="p-4 space-y-4">
        {error && <Alert asChild variant="destructive"><p role="alert">{error}</p></Alert>}
        <div className="rounded-md bg-muted p-3"><p className="text-xs leading-[1.45] text-muted-foreground mb-1">{project.name} / {selection.suite}</p><p className="font-medium break-words">{selection.title}</p></div>
        <label className="grid gap-2"><span>运行版本</span><Input aria-label="运行 commit（完整 SHA）" readOnly value={catalog.commit} className="font-mono" /></label>
        <label className="grid gap-2"><span>运行场景</span><NativeSelect aria-label="运行场景" disabled={busy} value={scenario} onChange={event => setScenario(event.target.value)}><option value="">直接运行（无场景）</option>{catalog.scenarios.map(item => <option key={item.name}>{item.name}</option>)}</NativeSelect></label>
        {!ready && <Alert asChild variant="destructive"><p role="alert">项目尚未就绪，请先检查项目设置。</p></Alert>}
      </div>
      <DialogFooter className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3"><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button type="submit" disabled={busy || !ready}><Play className="size-3.5" />{busy ? '提交中…' : '确认运行'}</Button></DialogFooter>
    </form>
  </Dialog>;
}
function RunHistory({ history, error, loading, retry }: { history: TestRequest[]; error: string; loading: boolean; retry: () => void }) {
  const search = useSearch({strict:false});
  const navigate = useNavigate();
  const filter = search.state ?? 'all';
  const setFilter = (state:string) => void navigate({to:'.',search:{...search,state:state==='all'?undefined:state},replace:true,resetScroll:false});
  const [limit, setLimit] = useState(15);
  const filtered = history.filter(request => filter === 'all' || (filter === 'active' ? ['queued', 'assigned', 'preparing', 'running', 'finalizing', 'cancel_requested'].includes(request.state) : filter === 'failed' ? request.state === 'infrastructure_failed' || (request.state === 'completed' && request.verdict === 'failed') : request.state === 'completed' && request.verdict === 'passed'));
  return <Card asChild><div className="overflow-hidden"><div className="flex flex-wrap items-center gap-2 border-b border-border p-3"><h3>运行记录 <span className="lane-count" title="最近 100 条任务中的匹配数">{filtered.length}</span></h3><div className="ml-auto w-36"><NativeSelect aria-label="筛选运行状态" value={filter} onChange={event => { setFilter(event.target.value); setLimit(15); }}><option value="all">全部状态</option><option value="active">进行中</option><option value="passed">通过</option><option value="failed">失败</option></NativeSelect></div></div>
    {error ? <Alert asChild variant="destructive"><p role="alert" className="m-3">{error}<Button variant="ghost" onClick={retry}>重试</Button></p></Alert> : loading ? <p className="text-xs leading-[1.45] text-muted-foreground p-6" role="status">正在加载运行记录…</p> : !filtered.length ? <EmptyState title={filter === 'all' ? '还没有运行记录' : '没有匹配的运行记录'} /> : <Table aria-label="运行记录列表"><TableHeader><TableRow><TableHead>测试任务</TableHead><TableHead>版本</TableHead><TableHead>状态</TableHead><TableHead>发起时间</TableHead><TableHead><span className="sr-only">查看详情</span></TableHead></TableRow></TableHeader><TableBody>{filtered.slice(0, limit).map(request => <TableRow key={request.id}><TableCell><Link className="font-medium" to="/requests/$id" params={{ id: request.id }}>{request.selection?.titlePath?.join(' › ') || request.input.suite}</Link><p className="text-xs leading-[1.45] text-muted-foreground">{request.input.scenario ?? '直接运行'} · {request.source?.kind === 'push' ? 'GitLab Push' : '手动运行'}</p>{request.supersededBy && <Link className="text-xs" to="/requests/$id" params={{ id: request.supersededBy }}>查看替代任务</Link>}</TableCell><TableCell><code title={request.input.commit}>{request.input.commit.slice(0, 10)}</code></TableCell><TableCell><StatusBadge value={request.state === 'completed' ? request.verdict : request.state} /></TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(request.createdAt)}</TableCell><TableCell><Button asChild size="icon" variant="ghost"><Link to="/requests/$id" params={{ id: request.id }} aria-label={`查看任务 ${request.id}`}><ArrowUpRight className="size-4" /></Link></Button></TableCell></TableRow>)}</TableBody></Table>}
    {filtered.length > limit && <div className="p-2 text-center"><Button variant="ghost" onClick={() => setLimit(limit + 15)}>显示更多（剩余 {filtered.length - limit} 条）</Button></div>}
  </div></Card>;
}
function DeleteProjectDialog({ project, close, deleted }: { project: Project; close: () => void; deleted: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Dialog title="删除项目" description="删除后无法恢复，请确认项目名称。" busy={busy} onClose={close}><form onSubmit={async event => {
    event.preventDefault(); if (busy || name !== project.name) return;
    setBusy(true); setError('');
    try { await api(`/api/projects/${project.id}`, 'DELETE'); deleted(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }}><div className="p-4 space-y-4">{error && <Alert asChild variant="destructive"><p role="alert">{error}</p></Alert>}<label className="grid gap-2"><span>输入 <strong>{project.name}</strong> 以确认删除</span><Input autoFocus aria-label="确认项目名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label></div><DialogFooter className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3"><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button variant="destructive" type="submit" disabled={busy || name !== project.name}>{busy ? '删除中…' : '永久删除项目'}</Button></DialogFooter></form></Dialog>;
}
