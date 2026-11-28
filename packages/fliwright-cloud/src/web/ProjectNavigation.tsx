import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearch } from '@tanstack/react-router';
import { Check, ChevronDown, Clock3, FolderGit2, Folders, Layers, ListChecks, Plus, ScanLine, Search, Settings2 } from 'lucide-react';
import type { Project } from '@fliwright/cloud-protocol';
import { Input } from './components/ui/input.js';
import { repoPath } from './project-identity.js';

export const projectViews = {
  tests: '测试用例', scenarios: '运行场景', runs: '运行记录', scans: '扫描记录', settings: '项目设置',
} as const;
export type ProjectView = keyof typeof projectViews;
export type WorkspacePage = 'board' | 'reports' | 'cases' | 'project' | 'directory' | 'other';
const viewIcons = { tests: ListChecks, scenarios: Layers, runs: Clock3, scans: ScanLine, settings: Settings2 };

export function activeProjectView(view?: string): ProjectView {
  return view && Object.hasOwn(projectViews, view) ? view as ProjectView : 'tests';
}

export function useWorkspaceProjectId() {
  const { projectId } = useParams({ strict: false });
  const { targetId } = useSearch({ strict: false });
  return projectId ?? targetId;
}

export function boardDestination(projectId?: string, search?: string) {
  return projectId
    ? { to: '/projects/$projectId/kanban', params: { projectId }, search: { search } } as const
    : { to: '/queue', search: { search, targetId: undefined } } as const;
}

export function reportsDestination(projectId?: string) {
  return projectId
    ? { to: '/projects/$projectId/reports', params: { projectId } } as const
    : { to: '/reports', search: { targetId: undefined } } as const;
}

export function projectViewDestination(projectId: string, view: ProjectView, search: { v?: string; q?: string; state?: string } = {}) {
  const params = { projectId };
  return view === 'tests'
    ? { to: '/projects/$projectId/testcases', params, search } as const
    : { to: '/projects/$projectId', params, search: { ...search, view } } as const;
}

export function matchesProject(project: Project, search: string) {
  return `${project.name} ${project.repository} ${project.defaultBranch}`.toLowerCase().includes(search.trim().toLowerCase());
}

export function ProjectSwitcher({ projects, error, retry, selectedId, page, canCreate }: {
  projects?: Project[]; error: string; retry: () => void; selectedId?: string; page: WorkspacePage; canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useSearch({ strict: false });
  const path = useLocation({ select: location => location.pathname });
  const includeAll = (page === 'board' || page === 'reports') && !filter.trim();
  const destination = (projectId?: string) => {
    if (page === 'reports') return reportsDestination(projectId);
    if (page === 'board' || !projectId) return boardDestination(projectId, search.search);
    const view = page === 'project' ? activeProjectView(search.view) : 'tests';
    const currentView = projectId === selectedId && (page === 'cases' || page === 'project');
    return projectViewDestination(projectId, view, currentView ? { v: search.v, q: search.q, state: search.state } : {});
  };
  const selected = projects?.find(project => project.id === selectedId);
  const matches = projects?.filter(project => matchesProject(project, filter)) ?? [];
  const count = matches.length + Number(includeAll);
  const active = Math.min(index, count - 1);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => { setOpen(false); }, [path, selectedId]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return <div ref={panel} className="project-switcher" data-ui="project-switcher"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }}>
    <button type="button" ref={trigger} className="project-picker" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`切换项目，${selected ? `${selected.name}，${repoPath(selected.repository)}` : selectedId ?? '全部项目'}`}
      onClick={() => {
        setOpen(!open); setFilter('');
        const selectedIndex = projects?.findIndex(project => project.id === selectedId) ?? -1;
        setIndex(selectedIndex < 0 ? 0 : selectedIndex + Number(page === 'board' || page === 'reports'));
      }}>
      <strong>{selected?.name ?? selectedId ?? '全部项目'}</strong><ChevronDown />
    </button>
    {open && <div role="dialog" aria-label="切换项目" className="project-menu" data-ui="project-switcher-menu">
      <div className="workspace-search"><Search /><Input type="search" autoFocus role="combobox" aria-label="搜索项目" placeholder="搜索项目或仓库…"
        aria-controls="project-options" aria-expanded="true" aria-activedescendant={active >= 0 ? `project-option-${active}` : undefined}
        value={filter} onChange={event => { setFilter(event.target.value); setIndex(0); }} onKeyDown={event => {
          if (!count || event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault(); document.getElementById(`project-option-${active}`)?.click();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
            setIndex(next); document.getElementById(`project-option-${next}`)?.scrollIntoView?.({ block: 'nearest' });
          }
        }} /></div>
      <div id="project-options" role="listbox" aria-label="项目列表" data-ui="project-list">
        {includeAll && <Link {...destination()} role="option" id="project-option-0" aria-selected={!selectedId}
          data-active={active === 0} onMouseEnter={() => setIndex(0)} onClick={close}>
          <Folders /><strong>全部项目</strong>{!selectedId && <Check />}
        </Link>}
        {matches.map((project, i) => {
          const option = i + Number(includeAll);
          const isSelected = project.id === selectedId;
          return <Link key={project.id} {...destination(project.id)} id={`project-option-${option}`} role="option" data-ui="project-list-item"
            aria-selected={isSelected} aria-current={isSelected ? 'page' : undefined} data-active={active === option}
            onMouseEnter={() => setIndex(option)} onClick={close}>
            <FolderGit2 /><span><strong>{project.name}</strong><code>{repoPath(project.repository)}</code></span>{isSelected && <Check />}
          </Link>;
        })}
      </div>
      {error ? <p role="alert">{error} <button type="button" onClick={retry}>重试</button></p> : !matches.length && <p role="status">{!projects ? '正在加载项目…' : filter ? '没有匹配的项目' : '暂无项目'}</p>}
      <div className="project-menu-actions">
        <Link to="/projects" search={{ targetId: selectedId }} onClick={close}><Folders />项目目录</Link>
        {canCreate && <Link to="/projects" search={{ targetId: selectedId, createProject: true }} onClick={close}><Plus />创建项目</Link>}
      </div>
    </div>}
  </div>;
}

export function ProjectNavigation({ selected, view, version }: { selected: Project; view: ProjectView; version?: string }) {
  return <nav className="project-sections" aria-label="项目分区">
    {(Object.keys(projectViews) as ProjectView[]).map(key => {
      const Icon = viewIcons[key];
      return <Link key={key} {...projectViewDestination(selected.id, key, { v: version })}
        activeOptions={{ exact: true }} data-selected={key === view} aria-current={key === view ? 'page' : undefined}>
        <Icon />{projectViews[key]}
      </Link>;
    })}
  </nav>;
}
