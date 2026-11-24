import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Columns3, Cpu, Ellipsis, Files, Folders, Gauge, Moon, Search, Smartphone, Sun } from 'lucide-react';
import type { Project } from '@fliwright/cloud-protocol';
import type { BoardDepth } from '../request-board.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';
import { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger } from './components/ui/navigation-menu.js';
import { activeProjectView, ProjectSwitcher } from './ProjectNavigation.js';
import { RequestSubmission } from './RequestSubmission.js';
import type { useData } from './data.js';

const brandLogo = new URL('./assets/fliwright-logo.svg', import.meta.url).href;
const tools = [
  { to: '/overview', title: '运行概览', Icon: Gauge },
  { to: '/devices', title: '设备管理', Icon: Smartphone },
  { to: '/workers', title: 'Worker 主机', Icon: Cpu },
] as const;

export type ProjectDirectory = ReturnType<typeof useData<Project[]>>;
export type CloudUser = { name: string; role: string };

export const BoardFactsContext = createContext<HTMLDListElement | null>(null);

function WorkspaceFact({ label, value, title }: { label: string; value?: number | string; title?: string }) {
  return <div><dt>{label}</dt><dd title={title}>{value ?? '—'}</dd></div>;
}

export function BoardResultFacts({ totals, search }: { totals?: BoardDepth; search: string }) {
  const header = useContext(BoardFactsContext);
  if (!header) return null;
  const total = totals && Object.values(totals).reduce((sum, count) => sum + count, 0);
  const finished = totals ? totals.passed + totals.failed : 0;
  const passRate = totals && finished > 0 ? `${Math.round(totals.passed * 100 / finished)}%` : undefined;
  return createPortal(<>
    <WorkspaceFact label={search ? '匹配任务' : '任务总数'} value={total} />
    <WorkspaceFact label="通过率" value={passRate} title="已成功任务占已成功和已失败任务总数的比例" />
  </>, header);
}

function WorkspaceSearch({ scope, targetId }: { scope: 'board' | 'cases' | 'directory' | 'global'; targetId?: string }) {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const query = (scope === 'cases' || scope === 'directory' ? search.q : scope === 'board' ? search.search : '') ?? '';
  const [draft, setDraft] = useState(query);
  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))) return;
      event.preventDefault(); input.current?.focus();
    };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, []);
  const update = (value: string, submit: boolean) => {
    if (scope === 'global') {
      if (submit) void navigate({ to: '/queue', search: { search: value || undefined, targetId } });
    } else {
      const key = scope === 'board' ? 'search' : 'q';
      if (value !== query) void navigate({ to: '.', search: { ...search, [key]: value || undefined }, replace: editing.current, resetScroll: false });
      editing.current = !submit;
    }
  };
  const label = scope === 'cases' ? '筛选文件或用例名称' : scope === 'directory' ? '搜索项目名或仓库' : '搜索任务';
  const placeholder = scope === 'cases' ? '搜索用例、文件或套件…' : scope === 'directory' ? '搜索项目、仓库或分支…' : '搜索任务、分支或提交…';
  return <form className="workspace-search header-search" role="search" onSubmit={event => {
    event.preventDefault(); update(input.current?.value ?? '', true);
  }}>
    <Search /><Input ref={input} type="search" id="global-search" aria-label={label} placeholder={placeholder} maxLength={200} value={draft}
      onBlur={() => { editing.current = false; }}
      onChange={event => { setDraft(event.target.value); if (!(event.nativeEvent as InputEvent).isComposing) update(event.target.value, false); }}
      onCompositionEnd={event => update(event.currentTarget.value, false)} />
  </form>;
}

export function WorkspaceHeader({ directory, user, shared, board, factsRef, projectPage, theme, toggleTheme }: {
  directory: ProjectDirectory; user?: CloudUser; shared: boolean; board: boolean; factsRef: React.Ref<HTMLDListElement>; projectPage: boolean; theme: string; toggleTheme: () => void;
}) {
  const path = useLocation({ select: location => location.pathname });
  const { projectId } = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const [menu, setMenu] = useState('');
  useEffect(() => { setMenu(''); }, [path]);
  const selectedId = projectId ?? (board ? search.targetId : undefined);
  const project = directory.data?.find(item => item.id === selectedId);
  const scopeProjects = selectedId ? project && [project] : directory.data;
  const suiteCount = scopeProjects?.reduce((total, item) => total + Object.keys(item.suites).length, 0);
  const scope = board ? 'board' : projectPage && !projectId ? 'directory' : projectPage && activeProjectView(search.view) === 'tests' ? 'cases' : 'global';
  const active = board || path.startsWith('/requests/') ? '/queue' : projectPage ? '/projects' : path.startsWith('/reports/') ? '/reports' : path;
  const links = [
    { id: '/queue', title: '执行看板', Icon: Columns3, destination: { to: '/queue', search: { targetId: selectedId } } },
    { id: '/projects', title: '项目管理', Icon: Folders, destination: selectedId ? { to: '/projects/$projectId', params: { projectId: selectedId } } : { to: '/projects' } },
    { id: '/reports', title: '测试报告', Icon: Files, destination: { to: '/reports' } },
  ] as const;
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const themeLabel = theme === 'dark' ? '切换浅色主题' : '切换深色主题';
  return <header className="workspace-header" data-ui="app-header">
    <div className="workspace-topbar" data-ui="topbar">
      <Link to="/" disabled={shared} data-ui="brand" className="workspace-brand" title="Fliwright Cloud" aria-label="Fliwright Cloud 首页"><img src={brandLogo} alt="" width="28" height="28" /></Link>
      {shared ? <><span className="share-label">只读报告分享</span><Button variant="ghost" size="icon" title={themeLabel} aria-label={themeLabel} onClick={toggleTheme}><ThemeIcon /></Button></> : <>
        <ProjectSwitcher projects={directory.data} error={directory.error} retry={directory.reload} selectedId={selectedId} mode={board ? 'board' : 'project'} canCreate={user?.role === 'admin'} />
        <WorkspaceSearch key={`${path}:${scope}`} scope={scope} targetId={selectedId} />
        {board && <dl className="workspace-facts" aria-label="看板概况" ref={factsRef}>
          <WorkspaceFact label={selectedId ? '默认分支' : '项目'} value={selectedId ? project?.defaultBranch : directory.data?.length} title={project?.defaultBranch} />
          <WorkspaceFact label="测试套件" value={suiteCount} />
        </dl>}
        <nav className="workspace-nav" aria-label="主导航">
          {links.map(({ id, title, Icon, destination }) => <Link key={id} {...destination} aria-current={active === id ? 'page' : undefined} data-selected={active === id} aria-label={title} title={title}><Icon /><span>{title}</span></Link>)}
        </nav>
        {user?.name && <span className="workspace-user" aria-label={`当前用户 ${user.name}`} title={`${user.name} · ${user.role}`}>{user.name.slice(0, 2).toLocaleUpperCase()}</span>}
        <NavigationMenu aria-label="更多导航" value={menu} onValueChange={setMenu} className="workspace-more">
          <NavigationMenuList><NavigationMenuItem value="more">
            <NavigationMenuTrigger showChevron={false} aria-label="更多" title="更多" data-ui={tools.some(tool => path.startsWith(tool.to)) ? 'configuration-active' : undefined}><Ellipsis /></NavigationMenuTrigger>
            <NavigationMenuContent className="workspace-more-menu">
              <div className="mobile-workspace-links">{links.map(({ id, title, Icon, destination }) => <NavigationMenuLink asChild key={id}><Link {...destination} onClick={() => setMenu('')}><Icon />{title}</Link></NavigationMenuLink>)}</div>
              {tools.map(({ to, title, Icon }) => <NavigationMenuLink asChild key={to}><Link to={to} onClick={() => setMenu('')}><Icon />{title}</Link></NavigationMenuLink>)}
              <button type="button" onClick={() => { toggleTheme(); setMenu(''); }}><ThemeIcon />{themeLabel}</button>
            </NavigationMenuContent>
          </NavigationMenuItem></NavigationMenuList>
        </NavigationMenu>
        <RequestSubmission key={path} targetId={selectedId} />
      </>}
    </div>
  </header>;
}
