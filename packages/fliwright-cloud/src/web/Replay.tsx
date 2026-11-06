import { Alert } from './components/ui/alert.js';
import { Card } from './components/ui/card.js';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from './components/ui/tabs.js';
import { Label } from './components/ui/label.js';
import { NativeSelect } from './components/ui/native-select.js';
import { Button } from './components/ui/button.js';
import { Checkbox } from './components/ui/checkbox.js';
import { Input } from './components/ui/input.js';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './components/ui/resizable.js';
import React, { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import type { ReportView } from '../ReportStore.js';
import { Icon, ResultIcon } from './ui.js';
import { TimeTimeline } from './TimeTimeline.js';
import {
  artifactPath,
  evidenceLabel,
  buildTimeAxis,
  durationLabel,
  durationMs,
  matchesStep,
  orderedSteps,
  parseLog,
  screenshotPaths,
  type ReplayNode,
  type StepFilter,
} from './replay-model.js';

const display = (value: unknown) =>
  typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '—');
const statusLabels: Record<string, string> = {
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
  running: '运行中',
  interrupted: '已中断',
};
const filters: Array<[StepFilter, string]> = [
  ['all', '全部'],
  ['failed', '失败'],
  ['screenshots', '有截图'],
  ['slow', '慢步骤'],
];

function useFile(url?: string) {
  const [data, setData] = useState({
    url: '',
    content: '',
    error: '',
    loading: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    if (!url) return;
    setData({ url, content: '', error: '', loading: true });
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`证据读取失败（${response.status}）`);
        const content = await response.text();
        setData({ url, content, error: '', loading: false });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted)
          setData({ url, content: '', error: e.message, loading: false });
      });
    return () => controller.abort();
  }, [url]);
  return data.url === url ? data : { content: '', error: '', loading: !!url };
}

function Source({ url, line }: { url?: string; line?: number }) {
  const { content, error, loading } = useFile(url);
  const highlight = useRef<HTMLLIElement>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current && highlight.current)
      container.current.scrollTop = Math.max(
        0,
        highlight.current.offsetTop - container.current.clientHeight / 2,
      );
  }, [content, line]);
  if (!url)
    return (
      <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs px-2.5 py-4 text-xs" data-ui="empty compact">未归档源码快照，无法展示对应源码。</div>
    );
  if (error)
    return (
      <Alert asChild variant="destructive"><div role="alert" data-ui="error">
        {error}
      </div></Alert>
    );
  if (loading) return <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs px-2.5 py-4 text-xs" data-ui="empty compact">正在读取源码…</div>;
  return (
    <div className="relative max-h-80 overflow-auto rounded-md border border-border bg-code text-code-foreground [&_ol]:m-0 [&_ol]:list-none [&_ol]:py-2 [&_ol]:font-mono [&_ol]:text-[11.5px] [&_ol]:leading-relaxed [&_li]:grid [&_li]:grid-cols-[44px_1fr] [&_li]:gap-2.5 [&_li]:pr-3 [&_li]:pl-2.5 [&_li]:whitespace-pre" ref={container} data-ui="codesnap">
      <ol>
        {content.split('\n').map((text, i) => (
          <li
            key={i}
            className={i + 1 === line ? "bg-code-highlight/15 [&>span]:text-code-highlight" : ''}
            ref={i + 1 === line ? highlight : undefined} data-ui={i + 1 === line ? 'hl' : ''}
          >
            <span className="text-right text-code-muted select-none" data-ui="ln">{i + 1}</span>
            <code>{text || ' '}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Screenshot({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div role="alert" className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs" data-ui="empty">
      截图无法读取。
      <a href={url} target="_blank" rel="noreferrer">
        打开原始产物
      </a>
    </div>
  ) : (
    <a
      className="block h-full min-h-0 max-w-full"
      href={url}
      target="_blank"
      rel="noreferrer"
      title="打开原始截图" data-ui="screenshot-link"
    >
      <img
        className="block h-auto max-h-full w-auto max-w-full rounded-lg object-contain shadow-xl"
        src={url}
        alt={`${title} · 原始测试截图`}
        onError={() => setFailed(true)} data-ui="replay-screenshot"
      />
    </a>
  );
}

export function Replay({
  report,
  shared = false,
  reportTabs = [],
  active = true,
}: {
  report: ReportView;
  shared?: boolean;
  active?: boolean;
  reportTabs?: Array<{
    id: string;
    label: string;
    icon: string;
    content: React.ReactNode;
  }>;
}) {
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [selection, setSelection] = useState<string>();
  const [filter, setFilter] = useState<StepFilter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState('details');
  const [imageIndex, setImageIndex] = useState(0);
  const [logPath, setLogPath] = useState('');
  const [allLogs, setAllLogs] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const [stacked, setStacked] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 900px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setStacked(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const attempt = report.tests[attemptIndex];
  const nodes: ReplayNode[] = Array.isArray(attempt?.timeline.nodes)
    ? attempt.timeline.nodes.filter(
        (n: unknown): n is ReplayNode =>
          !!n &&
          typeof n === 'object' &&
          typeof (n as ReplayNode).id === 'string',
      )
    : [];
  const rows = orderedSteps(nodes);
  const steps = rows.map((r) => r.node);
  const node =
    steps.find((n) => n.id === selection) ??
    steps.find((n) => n.status === 'failed') ??
    steps[0];
  const index = node ? steps.indexOf(node) : -1;
  const visible = steps.filter((n) => matchesStep(n, filter));
  const playbackAxis = buildTimeAxis(nodes, attempt?.timeline ?? {});
  const canPlay = playbackAxis.entries.length > 0 && playbackAxis.durationMs > 0;
  const selectedRow = useRef<HTMLDivElement>(null);
  const resultPath =
    report.manifest.tests
      .find((t) => t.testId === attempt?.testId)
      ?.attempts.find((a) => a.attemptId === attempt?.attemptId)?.resultPath ??
    '';
  const base = resultPath.split('/').slice(0, -1).join('/');
  const prefix = shared ? '/api/shared/reports' : '/api/reports';
  const fileUrl = (path: string) =>
    `${prefix}/${report.id}/file?path=${encodeURIComponent(path)}`;
  const resolve = (path: unknown) => artifactPath(base, path, report.files);
  const artifacts = node?.artifacts ?? [];
  const images = screenshotPaths(node, base, report.files);
  const sourceRef = node?.codeRef ?? node?.error?.scriptLocation;
  const sourceArtifact = artifacts.find(
    (a) => a.kind === 'source' || /\.(ts|dart)$/.test(a.path),
  );
  const archivedSource =
    resolve((sourceRef as { sourcePath?: string } | undefined)?.sourcePath) ??
    resolve(sourceArtifact?.path) ??
    resolve(sourceRef?.file);
  const logFiles = shared
    ? []
    : report.files.filter(
        (p) => p.startsWith(`${base}/`) && /\.(log|jsonl|txt)$/.test(p),
      );
  const activeLog = logFiles.includes(logPath)
    ? logPath
    : (logFiles.find((p) => p.endsWith('events.jsonl')) ?? logFiles[0]);
  const log = useFile(
    tab === 'logs' && activeLog ? fileUrl(activeLog) : undefined,
  );
  const parsedLogs = parseLog(log.content);
  const stepLogs = parsedLogs.filter(
    (l) =>
      (allLogs || l.timelineNodeId === node?.id) &&
      display(l.message ?? l)
        .toLowerCase()
        .includes(logSearch.toLowerCase()),
  );
  const error = node?.error as Record<string, any> | undefined;
  const failureCount = steps.filter((n) => n.status === 'failed').length;
  const choose = (id: string) => {
    setSelection(id);
    setImageIndex(0);
  };
  const togglePlayback = () => {
    if (!canPlay) return;
    if (!playing) {
      setFilter('all');
      setCollapsed(new Set());
    }
    setPlaying((value) => !value);
  };
  const move = (direction: number) => {
    const position = visible.findIndex((n) => n.id === node?.id);
    const next = visible[position + direction];
    if (next) choose(next.id);
    setPlaying(false);
  };
  const jumpFailure = () => {
    const failed =
      steps.find((n, i) => i > index && n.status === 'failed') ??
      steps.find((n) => n.status === 'failed');
    if (failed) {
      setFilter('all');
      setCollapsed(new Set());
      choose(failed.id);
      setTab('details');
      setPlaying(false);
    }
  };
  useEffect(() => {
    const row = selectedRow.current;
    const list = row?.closest<HTMLElement>('[data-ui~=rp-body]');
    if (
      row &&
      list &&
      (row.offsetTop < list.scrollTop ||
        row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
    )
      list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2);
  }, [selection, filter, attemptIndex]);
  const changeFilter = (value: StepFilter) => {
    setFilter(value);
    setPlaying(false);
    setCollapsed(new Set());
    if (node && !matchesStep(node, value)) {
      const next = steps.find((n) => matchesStep(n, value));
      if (next) choose(next.id);
    }
  };
  const hidden = (n: ReplayNode) => {
    if (filter !== 'all') return false;
    let parent = n.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (collapsed.has(parent)) return true;
      seen.add(parent);
      parent = nodes.find((p) => p.id === parent)?.parentId;
    }
    return false;
  };
  return (
    <Card asChild>
      <section
        className={`overflow-hidden [&>[data-ui~=panel-head]]:flex-wrap ${focused ? "fixed inset-4 z-50 grid grid-rows-[auto_minmax(0,1fr)] shadow-2xl outline-32 outline-background/90 max-[1240px]:overflow-auto max-sm:inset-1.5 [&_[data-ui~=workspace-replay]]:h-full max-[900px]:[&_[data-ui~=workspace-replay]]:h-[1500px] [&_[data-ui~=replay-canvas]]:p-6" : ''}`}
        aria-label="步骤回放"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setFocused(false);
          const target = e.target as HTMLElement;
          if (
            /INPUT|SELECT|TEXTAREA/.test(target.tagName) ||
            target.isContentEditable ||
            !!target.closest(
              '[role="tablist"], [role="slider"], [role="checkbox"], [role="separator"]',
            )
          )
            return;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            move(-1);
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            move(1);
          }
          if (e.key === ' ') {
            if (/BUTTON|A/.test(target.tagName)) return;
            e.preventDefault();
            togglePlayback();
          }
        }}
        tabIndex={0} data-ui={`overflow-hidden replay-panel ${focused ? 'replay-focused' : ''}`}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 [&_h2]:text-xs max-[900px]:flex-wrap" data-ui="panel-head">
          <h2>步骤回放</h2>
          <span className="text-xs text-muted-foreground" data-ui="sub">
            {steps.length} 步 ·{' '}
            {steps.filter((n) => matchesStep(n, 'screenshots')).length} 步有截图
            · {failureCount} 处失败
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2 [&_label]:text-[11px] [&_label]:text-muted-foreground [&>[data-slot=native-select-wrapper]]:h-7.5 [&>[data-slot=native-select-wrapper]]:max-w-75 [&>[data-slot=native-select-wrapper]]:text-[11px] max-[1380px]:[&>[data-slot=native-select-wrapper]]:max-w-57.5 max-sm:w-full max-sm:[&>[data-slot=native-select-wrapper]]:max-w-full max-sm:[&>[data-slot=native-select-wrapper]]:flex-1" data-ui="right replay-attempt">
            <Label htmlFor="replay-attempt">用例 / 尝试</Label>
            <NativeSelect
              id="replay-attempt"
              value={attemptIndex}
              disabled={!report.tests.length}
              onChange={(e) => {
                setAttemptIndex(Number(e.target.value));
                setSelection(undefined);
                setImageIndex(0);
                setPlaying(false);
                setCollapsed(new Set());
                setFilter('all');
                setLogPath('');
                setTab('details');
                setAllLogs(false);
                setLogSearch('');
              }}
            >
              {report.tests.map((a, i) => (
                <option key={`${a.testId}-${a.attemptId}`} value={i}>
                  {display(a.result.testName ?? a.testId)} · {a.attemptId} ·{' '}
                  {statusLabels[display(a.result.status)] ??
                    display(a.result.status)}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="ghost"
              size="icon"
              aria-label={focused ? '退出全屏' : '全屏回放'}
              title={focused ? '退出全屏' : '全屏回放'}
              aria-pressed={focused}
              onClick={() => setFocused((f) => !f)} data-ui="focus-button"
            >
              {focused ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
            </Button>
          </div>
        </div>
        <ResizablePanelGroup
          key={stacked ? 'stacked' : 'columns'}
          direction={stacked ? 'vertical' : 'horizontal'}
          className="h-[960px] min-h-0 rounded-none bg-card shadow-none max-[900px]:h-[1500px] [&_[data-panel]]:min-h-0 [&_[data-panel]]:min-w-0 [&_[data-panel]]:overflow-hidden" data-ui="workspace-replay"
        >
          <ResizablePanel
            id="replay-steps"
            tagName="section"
            className="grid grid-rows-[auto_minmax(0,1fr)]"
            aria-label="步骤列表"
            defaultSize={stacked ? 22 : 18}
            minSize={stacked ? 15 : 12}
            maxSize={stacked ? 35 : 30} data-ui="rp-steps"
          >
            <div className="flex min-h-10 items-center gap-2 border-b border-border px-2.5 py-2 text-[11px] text-muted-foreground [&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wider" data-ui="rp-head">
              <span>步骤</span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground" data-ui="pos">
                {index + 1} / {steps.length} 步
              </span>
            </div>
            <div className="relative min-h-0 overflow-auto" data-ui="rp-body">
              <div className="sticky top-0 z-10 flex flex-wrap gap-1 bg-card px-2.5 py-1.5" data-ui="chiprow">
                {filters.map(([id, label]) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    key={id}
                    className=" rounded-full aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                    aria-pressed={filter === id}
                    onClick={() => changeFilter(id)}
                    title={id === 'slow' ? '耗时不少于 10 秒' : undefined} data-ui="chip"
                  >
                    {label}
                    <span className="font-mono text-[10px]" data-ui="n">
                      {steps.filter((n) => matchesStep(n, id)).length}
                    </span>
                  </Button>
                ))}
              </div>
              {!visible.length && (
                <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs px-2.5 py-4 text-xs" data-ui="empty compact">
                  {steps.length
                    ? '没有符合筛选条件的步骤。'
                    : '此尝试没有可用的时间线。'}
                </div>
              )}
              {rows
                .filter(({ node: n }) => matchesStep(n, filter) && !hidden(n))
                .map(({ node: n, depth }) => {
                  const group = nodes.some((child) => child.parentId === n.id);
                  return (
                    <div
                      key={n.id}
                      data-status={n.status}
                      ref={n.id === node?.id ? selectedRow : undefined}
                      className={`data-[status=failed]:bg-destructive/10 mx-1 my-px flex min-w-0 items-center gap-0.5 rounded-lg px-2 py-px ${group ? "mt-2 [&_[data-ui~=step-name]]:font-semibold" : ''}  ${n.id === node?.id ? "bg-accent" : ''}`}
                      style={{ paddingLeft: 10 + Math.min(depth, 5) * 12 }} data-ui={`replay-step ${group ? 'step-group' : ''} ${n.status} ${n.id === node?.id ? 'current' : ''}`}
                    >
                      {group && (
                        <Button
                          variant="ghost"
                          size="default"
                          className="min-h-5.5 w-4 shrink-0 bg-transparent p-0 [&_svg]:size-3 h-auto min-h-6 w-4 shrink-0 p-0"
                          aria-label={`${collapsed.has(n.id) ? '展开' : '折叠'} ${n.title}`}
                          aria-expanded={!collapsed.has(n.id)}
                          onClick={() =>
                            setCollapsed((old) => {
                              const next = new Set(old);
                              if (next.has(n.id)) next.delete(n.id);
                              else next.add(n.id);
                              return next;
                            })
                          } data-ui="collapse-step"
                        >
                          <Icon
                            name="chevron"
                            className={collapsed.has(n.id) ? '' : "rotate-90"}
                          />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="default"
                        className="[&>[data-ui~=result-icon]]:mx-0.5 h-auto min-h-7 w-full justify-start rounded-none px-2 py-1 text-left font-normal"
                        aria-current={n.id === node?.id ? 'step' : undefined}
                        onClick={() => {
                          choose(n.id);
                          setPlaying(false);
                        }}
                        title={n.title} data-ui="step-select"
                      >
                        <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground" data-ui="step-number">
                          {steps.indexOf(n) + 1}
                        </span>
                        {n.status === 'failed' ? (
                          <ResultIcon status="failed" />
                        ) : n.status === 'passed' &&
                          !matchesStep(n, 'screenshots') ? (
                          <ResultIcon status="passed" />
                        ) : (
                          <Icon
                            name={
                              matchesStep(n, 'screenshots') ? 'camera' : 'clock'
                            }
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate [&_small]:text-[9px] [&_small]:leading-tight" data-ui="step-name">
                          {n.title}
                          <small>
                            {group
                              ? `${nodes.filter((c) => c.parentId === n.id).length} 个子步骤`
                              : n.kind}
                          </small>
                        </span>
                        <span
                          className={`whitespace-nowrap font-mono text-[10px] text-muted-foreground ${matchesStep(n, 'slow') ? "rounded-sm bg-warn-bg px-1 text-warn-ink" : ''}`} data-ui={`step-duration ${matchesStep(n, 'slow') ? 'slow' : ''}`}
                        >
                          {durationLabel(durationMs(n))}
                        </span>
                      </Button>
                    </div>
                  );
                })}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle aria-label="调整步骤列表与回放区域大小" />
          <ResizablePanel
            id="replay-content"
            tagName="section"
            className="grid grid-rows-[auto_minmax(0,1fr)]"
            aria-label="回放区域"
            defaultSize={stacked ? 78 : 82}
            minSize={stacked ? 65 : 70} data-ui="rp-content"
          >
            <TimeTimeline
              key={attemptIndex}
              nodes={nodes}
              bounds={attempt?.timeline ?? {}}
              selectedId={node?.id}
              selectedScreenshotIndex={imageIndex}
              playback={{
                playing,
                speed,
                onSelect: choose,
                onPause: () => setPlaying(false),
                onEnd: () => setPlaying(false),
              }}
              screenshots={(step) => screenshotPaths(step, base, report.files).map(fileUrl)}
              controls={
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="时间轴回放控制" data-ui="replay-toolbar">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-8"
                    aria-label="上一步"
                    disabled={!visible.length || visible.indexOf(node) <= 0}
                    onClick={() => move(-1)}
                  >
                    <Icon name="prev" />
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!canPlay}
                    onClick={togglePlayback}
                  >
                    <Icon name={playing ? 'pause' : 'play'} />
                    {playing ? '暂停' : '播放'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-8"
                    aria-label="下一步"
                    disabled={
                      !visible.length || visible.indexOf(node) >= visible.length - 1
                    }
                    onClick={() => move(1)}
                  >
                    <Icon name="next" />
                  </Button>
                  <NativeSelect
                    className="h-7 w-14.5 text-[11px] h-7 py-0.5 pl-2 pr-6 text-xs"
                    aria-label="回放速度"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))} data-ui="play-speed"
                  >
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                  </NativeSelect>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!failureCount}
                    onClick={jumpFailure}
                  >
                    <Icon name="alert" />
                    跳到失败步骤
                  </Button>
                </div>
              }
              onSelect={(id, screenshotIndex = 0) => {
                choose(id);
                setImageIndex(screenshotIndex);
                setFilter('all');
                setCollapsed(new Set());
                setPlaying(false);
              }}
            />
            <ResizablePanelGroup
              direction={stacked ? 'vertical' : 'horizontal'}
              className="min-h-0" data-ui="replay-evidence"
            >
              <ResizablePanel
                id="replay-stage"
                tagName="section"
                className="flex min-h-0 flex-col"
                aria-label="回放画面"
                defaultSize={stacked ? 55 : 39}
                minSize={stacked ? 30 : 24} data-ui="rp-stage"
              >
                <div className="flex items-center justify-between gap-2.5 border-b border-border px-2.5 py-2 text-xs [&_b]:truncate [&>span]:shrink-0 [&>span]:font-mono [&>span]:text-[10px] [&>span]:text-muted-foreground max-sm:[&>span]:hidden" data-ui="replay-current">
                  <b>{node ? `${index + 1}. ${node.title}` : '选择步骤查看证据'}</b>
                  <span>
                    {node && durationLabel(durationMs(node))}
                    {images.length ? ` · ${images.length} 张截图` : ''}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto overscroll-contain bg-muted p-3" data-ui="replay-canvas">
                  {images.length ? (
                    <Screenshot
                      key={images[Math.min(imageIndex, images.length - 1)]}
                      url={fileUrl(images[Math.min(imageIndex, images.length - 1)])}
                      title={node?.title ?? ''}
                    />
                  ) : (
                    <div className="grid min-h-full content-center justify-items-center gap-2.5 text-center text-muted-foreground [&>svg]:size-8 [&_h3]:text-sm [&_p]:text-xs" data-ui="canvas-empty">
                      <Icon name="camera" />
                      <h3>此步骤没有截图</h3>
                      <p>
                        可在右侧查看{shared ? '步骤信息' : '失败详情、日志或产物'}。
                      </p>
                    </div>
                  )}
                </div>
                {images.length > 1 && (
                  <div className="flex justify-center gap-1 p-1" data-ui="image-selector">
                    {images.map((path, i) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        key={path}
                        className=" rounded-full aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                        aria-pressed={i === imageIndex}
                        onClick={() => setImageIndex(i)} data-ui="chip"
                      >
                        截图 {i + 1}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="border-t border-border px-2.5 pt-1.5 pb-2" data-ui="replay-position">
                  <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground" data-ui="scrubber-caption">
                    <span>
                      {index + 1} / {steps.length} 步 ·{' '}
                      {node && statusLabels[node.status]} ·{' '}
                      {durationLabel(node && durationMs(node))}
                    </span>
                    <span className={failureCount ? "text-destructive" : ''} data-ui={failureCount ? 'failure-text' : ''}>
                      {failureCount ? `失败 ${failureCount} 处` : '无失败步骤'}
                    </span>
                    <span>← → 切换 · 空格播放</span>
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle aria-label="调整回放画面与信息面板大小" />
              <ResizablePanel
                id="replay-inspector"
                defaultSize={stacked ? 45 : 61}
                minSize={25}
              >
                <Tabs asChild value={tab} onValueChange={setTab}>
                  <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] [&_[data-ui~=rp-body]]:grid [&_[data-ui~=rp-body]]:content-start [&_[data-ui~=rp-body]]:gap-3 [&_[data-ui~=rp-body]]:p-3" aria-label="信息面板" data-ui="rp-inspector">
                    <TabsList
                      className="mx-2.5 mt-3 flex h-auto flex-wrap justify-start"
                      aria-label="回放与报告信息"
                    >
                      {[
                        [
                          'details',
                          node?.status === 'failed' ? '失败详情' : '步骤详情',
                          'alert',
                        ],
                        ...(!shared
                          ? [
                              ['logs', '日志', 'log'],
                              ['source', '源码', 'code'],
                              ['trace', 'Trace', 'list'],
                            ]
                          : []),
                        ['artifacts', '产物', 'box'],
                        ...reportTabs.map(({ id, label, icon }) => [id, label, icon]),
                      ].map(([id, label, icon]) => (
                        <TabsTrigger key={id} value={id} className="h-7">
                          <Icon name={icon} />
                          {label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    <TabsContent
                      value={reportTabs.some(({ id }) => id === tab) ? 'details' : tab}
                      className="relative min-h-0 overflow-auto [&_[data-ui~=kv]]:grid-cols-[auto_minmax(0,1fr)] [&_[data-ui~=kv]]:gap-x-3 [&_[data-ui~=kv]]:gap-y-1.5 [&_[data-ui~=kv]]:text-[11px] [&_[data-ui~=kv]_dd]:break-words [&_[data-ui~=codeblk]]:max-h-[420px] [&_[data-ui~=codeblk]]:text-[11px] [&_summary]:text-xs [&_[data-ui~=codesnap]]:max-h-[310px] [&_[data-ui~=codesnap]_code]:text-inherit [&_[data-ui~=note]_p]:mt-1 [&_[data-ui~=note]_p]:text-xs [&_[data-ui~=note]_p]:leading-relaxed [&_[data-ui~=note]_p]:text-inherit mt-0" data-ui="rp-body inspector-pane"
                    >
                      {tab === 'details' &&
                        (node ? (
                          <>
                            <div className={`grid gap-2 rounded-md bg-muted px-3 py-2.5 ${error ? "bg-destructive/10 text-destructive" : ''}`} data-ui={`assert ${error ? 'bad' : ''}`}>
                              <div className="flex items-center gap-2 text-xs font-semibold [&_svg]:size-3.5" data-ui="hd">
                                <Icon name={error ? 'x' : 'check'} />
                                {node.title}
                              </div>
                              <div className="flex gap-2.5 text-[11px] text-muted-foreground" data-ui="step-facts">
                                <span>{statusLabels[node.status]}</span>
                                <span>{durationLabel(durationMs(node))}</span>
                                <code>{node.kind}</code>
                              </div>
                              {error && (
                                <>
                                  <pre className="text-xs text-destructive" data-ui="error-message">
                                    {display(error.message ?? error)}
                                  </pre>
                                  {(error.expected !== undefined ||
                                    error.actual !== undefined) && (
                                    <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 font-mono text-xs [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:break-words" data-ui="cmp">
                                      <dt>期望</dt>
                                      <dd className="font-semibold text-pass-ink" data-ui="want">
                                        {display(error.expected)}
                                      </dd>
                                      <dt>实际</dt>
                                      <dd className="font-semibold text-destructive" data-ui="got">{display(error.actual)}</dd>
                                    </dl>
                                  )}
                                </>
                              )}
                            </div>
                            {sourceRef && (
                              <div className="grid gap-2 [&>h4]:flex [&>h4]:items-center [&>h4]:gap-2 [&>h4]:text-xs [&>h4]:uppercase [&>h4]:tracking-wide [&>h4]:text-muted-foreground" data-ui="sect">
                                <h4>
                                  <Icon name="code" />
                                  源码位置
                                </h4>
                                <div className="break-words text-[11px] text-muted-foreground" data-ui="source-location">
                                  <code>
                                    {sourceRef.file}:{sourceRef.line}
                                    {sourceRef.column ? `:${sourceRef.column}` : ''}
                                  </code>
                                </div>
                                {!shared && (
                                  <Source
                                    url={
                                      archivedSource
                                        ? fileUrl(archivedSource)
                                        : undefined
                                    }
                                    line={sourceRef.line}
                                  />
                                )}
                              </div>
                            )}
                            {error &&
                              Array.isArray(error.recoveryHints) &&
                              error.recoveryHints.length > 0 && (
                                <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2.5 text-xs text-secondary-foreground [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_b]:text-foreground [&_code]:rounded-sm [&_code]:bg-card [&_code]:px-1.5 bg-warn-bg text-warn-ink" data-ui="note warn">
                                  <Icon name="alert" />
                                  <div>
                                    <b>诊断建议</b>
                                    {error.recoveryHints.map(
                                      (hint: { description: string }, i: number) => (
                                        <p key={i}>{hint.description}</p>
                                      ),
                                    )}
                                  </div>
                                </div>
                              )}
                            <div className="grid gap-2 [&>h4]:flex [&>h4]:items-center [&>h4]:gap-2 [&>h4]:text-xs [&>h4]:uppercase [&>h4]:tracking-wide [&>h4]:text-muted-foreground" data-ui="sect">
                              <h4>步骤信息</h4>
                              <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2 text-xs [&_dt]:whitespace-nowrap [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:text-foreground" data-ui="kv">
                                <dt>步骤 ID</dt>
                                <dd>
                                  <code>{node.id}</code>
                                </dd>
                                <dt>开始</dt>
                                <dd>
                                  {node.startedAt
                                    ? new Date(node.startedAt).toLocaleString('zh-CN')
                                    : '—'}
                                </dd>
                                <dt>结束</dt>
                                <dd>
                                  {node.endedAt
                                    ? new Date(node.endedAt).toLocaleString('zh-CN')
                                    : '—'}
                                </dd>
                                <dt>路由</dt>
                                <dd>
                                  <code>{node.route ?? '—'}</code>
                                </dd>
                                {node.parentId && (
                                  <>
                                    <dt>父步骤</dt>
                                    <dd>
                                      <Button
                                        variant="ghost"
                                        size="default"
                                        className="min-h-0 bg-transparent p-0 text-left text-[11px] text-primary h-auto justify-start p-0 text-xs text-primary"
                                        onClick={() => choose(node.parentId!)} data-ui="text-button"
                                      >
                                        {steps.find((n) => n.id === node.parentId)
                                          ?.title ?? node.parentId}
                                      </Button>
                                    </dd>
                                  </>
                                )}
                              </dl>
                            </div>
                            {!shared && node.metadata && (
                              <details>
                                <summary>步骤上下文 / 元数据</summary>
                                <pre className="m-0 overflow-auto whitespace-pre rounded-md border border-border bg-code p-3.5 font-mono text-xs leading-relaxed text-code-foreground [tab-size:2]" data-ui="codeblk">
                                  {display(node.metadata)}
                                </pre>
                              </details>
                            )}
                            {error && (
                              <details>
                                <summary>完整失败记录</summary>
                                <pre className="m-0 overflow-auto whitespace-pre rounded-md border border-border bg-code p-3.5 font-mono text-xs leading-relaxed text-code-foreground [tab-size:2]" data-ui="codeblk">{display(error)}</pre>
                              </details>
                            )}
                            <div className="grid gap-2 [&>h4]:flex [&>h4]:items-center [&>h4]:gap-2 [&>h4]:text-xs [&>h4]:uppercase [&>h4]:tracking-wide [&>h4]:text-muted-foreground" data-ui="sect">
                              <h4>
                                <Icon name="box" />
                                本步骤产物{' '}
                                <span className="ml-auto flex flex-wrap items-center gap-2" data-ui="right">{artifacts.length}</span>
                              </h4>
                              <ArtifactList
                                artifacts={artifacts}
                                resolve={resolve}
                                fileUrl={fileUrl}
                                shared={shared}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs" data-ui="empty">选择一个步骤查看详细信息。</div>
                        ))}
                      {tab === 'source' && (
                        <div className="grid gap-2 [&>h4]:flex [&>h4]:items-center [&>h4]:gap-2 [&>h4]:text-xs [&>h4]:uppercase [&>h4]:tracking-wide [&>h4]:text-muted-foreground" data-ui="sect">
                          <h4>
                            归档源码{' '}
                            {sourceRef?.line ? `· 第 ${sourceRef.line} 行` : ''}
                          </h4>
                          <code className="break-words text-[11px] text-muted-foreground" data-ui="source-location">
                            {sourceRef?.file ?? '无源码位置'}
                          </code>
                          <Source
                            url={archivedSource ? fileUrl(archivedSource) : undefined}
                            line={sourceRef?.line}
                          />
                        </div>
                      )}
                      {tab === 'logs' && (
                        <>
                          <div className="grid min-w-0 gap-1.5 [&>label]:text-xs [&>label]:font-medium" data-ui="field">
                            <Label htmlFor="replay-log">日志文件</Label>
                            <NativeSelect
                              id="replay-log"
                              value={activeLog ?? ''}
                              onChange={(e) => setLogPath(e.target.value)}
                            >
                              {logFiles.map((p) => (
                                <option key={p} value={p}>
                                  {p.slice(base.length + 1)}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          <Label className="flex cursor-pointer items-start gap-2 text-xs" data-ui="check">
                            <Checkbox
                              checked={allLogs}
                              onCheckedChange={(checked) =>
                                setAllLogs(checked === true)
                              }
                            />
                            查看整个尝试的日志
                          </Label>
                          <Input
                            aria-label="搜索日志"
                            placeholder="搜索日志内容"
                            value={logSearch}
                            onChange={(e) => setLogSearch(e.target.value)}
                          />
                          {log.error && (
                            <Alert asChild variant="destructive"><div role="alert" data-ui="error">
                              {log.error}
                            </div></Alert>
                          )}
                          {log.loading ? (
                            <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs" data-ui="empty">正在读取日志…</div>
                          ) : stepLogs.length ? (
                            <div className="max-h-80 overflow-auto rounded-md border border-border bg-code text-code-foreground [&_ol]:m-0 [&_ol]:list-none [&_ol]:p-0 [&_ol]:font-mono [&_ol]:text-[11px] [&_ol]:leading-relaxed [&_li]:grid [&_li]:grid-cols-[44px_1fr] [&_li]:gap-2.5 [&_li]:px-2.5 [&_li]:py-px [&_li]:whitespace-pre-wrap [&_li]:break-words" data-ui="log">
                              <ol>
                                {stepLogs.map((l, i) => (
                                  <li
                                    key={i}
                                    className={
                                      l.level === 'error'
                                        ? "bg-destructive/10 text-destructive"
                                        : l.level === 'warn'
                                          ? "bg-warn-bg text-warn-ink"
                                          : ''
                                    } data-ui={
                                      l.level === 'error'
                                        ? 'err'
                                        : l.level === 'warn'
                                          ? 'warn'
                                          : ''
                                    }
                                  >
                                    <span className="text-right text-code-muted select-none" data-ui="ln">{i + 1}</span>
                                    <span>
                                      {l.timestamp ? `${display(l.timestamp)} ` : ''}
                                      {display(l.message ?? l)}
                                      {l.error ? `\n${display(l.error)}` : ''}
                                    </span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          ) : (
                            <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs px-2.5 py-4 text-xs" data-ui="empty compact">
                              {!logFiles.length
                                ? '此尝试没有归档日志。'
                                : allLogs
                                  ? '没有匹配的日志。'
                                  : '此步骤没有关联日志，可切换查看整个尝试。'}
                            </div>
                          )}
                        </>
                      )}
                      {tab === 'trace' && (
                        <>
                          <h4>尝试 Trace</h4>
                          <pre className="m-0 overflow-auto whitespace-pre rounded-md border border-border bg-code p-3.5 font-mono text-xs leading-relaxed text-code-foreground [tab-size:2]" data-ui="codeblk">
                            {attempt?.trace
                              ? display(attempt.trace)
                              : '此尝试没有可用 Trace。'}
                          </pre>
                        </>
                      )}
                      {tab === 'artifacts' && (
                        <>
                          <h4>本步骤产物 · {artifacts.length}</h4>
                          <ArtifactList
                            artifacts={artifacts}
                            resolve={resolve}
                            fileUrl={fileUrl}
                            shared={shared}
                          />
                          {!shared && (
                            <details>
                              <summary>此尝试的全部归档文件</summary>
                              <div className="grid gap-1.5" data-ui="arts">
                                {report.files
                                  .filter((p) => p.startsWith(`${base}/`))
                                  .map((p) => (
                                    <a
                                      className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm bg-muted px-2.5 py-1.5 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
                                      key={p}
                                      href={fileUrl(p)}
                                      target="_blank"
                                      rel="noreferrer" data-ui="art"
                                    >
                                      <Icon name="doc" />
                                      <span className="truncate text-xs text-secondary-foreground" title={p} data-ui="nm">
                                        {p.slice(base.length + 1)}
                                      </span>
                                      <span>↗</span>
                                    </a>
                                  ))}
                              </div>
                            </details>
                          )}
                        </>
                      )}
                    </TabsContent>
                    {reportTabs.map(({ id, content }) => (
                      <TabsContent
                        key={id}
                        value={id}
                        forceMount
                        className={`relative min-h-0 overflow-auto [&_[data-ui~=kv]]:grid-cols-[auto_minmax(0,1fr)] [&_[data-ui~=kv]]:gap-x-3 [&_[data-ui~=kv]]:gap-y-1.5 [&_[data-ui~=kv]]:text-[11px] [&_[data-ui~=kv]_dd]:break-words [&_[data-ui~=codeblk]]:max-h-[420px] [&_[data-ui~=codeblk]]:text-[11px] [&_summary]:text-xs [&_[data-ui~=codesnap]]:max-h-[310px] [&_[data-ui~=codesnap]_code]:text-inherit [&_[data-ui~=note]_p]:mt-1 [&_[data-ui~=note]_p]:text-xs [&_[data-ui~=note]_p]:leading-relaxed [&_[data-ui~=note]_p]:text-inherit [&_[data-ui~=diagnostic-section]]:rounded-none [&_[data-ui~=diagnostic-section]]:bg-transparent [&_[data-ui~=diagnostic-section]]:p-0 [&_[data-ui~=diagnostic-section]]:shadow-none [&_[data-ui~=meta-grid]]:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] [&_[data-ui~=v]]:whitespace-normal [&_[data-ui~=v]]:break-words [&_[data-ui~=attempt-row]]:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] [&_[data-ui~=attempt-row]]:px-0 [&_[data-ui~=attempt-row]_code]:break-words [&_[data-ui~=event]]:grid-cols-[auto_minmax(0,1fr)] [&_[data-ui~=event]]:px-0 [&_[data-ui~=event]_pre]:col-span-full [&_[data-ui~=event]_pre]:whitespace-pre-wrap [&_[data-ui~=event]_pre]:break-words [&_[data-ui~=event-list]]:max-h-none [&_[data-ui~=share-panel]_[data-ui~=panel-heading]]:flex-wrap [&_[data-ui~=share-panel]_[data-ui~=panel-heading]]:p-0 [&_[data-ui~=share-panel]_[data-ui~=panel-heading]]:pb-3 [&_[data-ui~=share-controls]]:px-0 [&_[data-ui~=share-controls]_label]:flex [&_[data-ui~=share-controls]_label]:items-center [&_[data-ui~=share-controls]_label]:gap-2 mt-0 ${tab !== id ? 'hidden' : ''}`}
                      >
                        {content}
                      </TabsContent>
                    ))}
                  </section>
                </Tabs>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
        {(attempt?.result.flaky || attempt?.result.expectedFailure) && (
          <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2.5 text-xs text-secondary-foreground [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_b]:text-foreground [&_code]:rounded-sm [&_code]:bg-card [&_code]:px-1.5 bg-warn-bg text-warn-ink" data-ui="note warn">
            <Icon name="alert" />
            {attempt.result.flaky
              ? '此用例在重试后通过（flaky），请检查各次尝试。'
              : '此用例标记为预期失败。'}
          </div>
        )}
      </section>
    </Card>
  );
}

function ArtifactList({
  artifacts,
  resolve,
  fileUrl,
  shared,
}: {
  artifacts: NonNullable<ReplayNode['artifacts']>;
  resolve: (path: unknown) => string | undefined;
  fileUrl: (path: string) => string;
  shared: boolean;
}) {
  return artifacts.length ? (
    <div className="grid gap-1.5" data-ui="arts">
      {artifacts.map((a, i) => {
        const path = resolve(a.path);
        const permitted =
          path && (!shared || /\.(png|jpe?g|webp)$/i.test(path));
        return permitted ? (
          <a
            key={i}
            className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm bg-muted px-2.5 py-1.5 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
            href={fileUrl(path)}
            target="_blank"
            rel="noreferrer" data-ui="art"
          >
            <Icon name={a.kind === 'screenshot' ? 'camera' : 'doc'} />
            <span className="truncate text-xs text-secondary-foreground" title={a.path} data-ui="nm">
              {a.path}
            </span>
            <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground" data-ui="sz">{evidenceLabel(a)} ↗</span>
          </a>
        ) : (
          <div className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm bg-muted px-2.5 py-1.5 [&_svg]:size-3.5 [&_svg]:text-muted-foreground" key={i} data-ui="art">
            <Icon name="doc" />
            <span className="truncate text-xs text-secondary-foreground" title={a.path} data-ui="nm">
              {a.path}
            </span>
            <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground" data-ui="sz">{path ? '受限' : '未归档'}</span>
          </div>
        );
      })}
    </div>
  ) : (
    <p className="text-xs leading-[1.45] text-muted-foreground">此步骤没有关联产物。</p>
  );
}
