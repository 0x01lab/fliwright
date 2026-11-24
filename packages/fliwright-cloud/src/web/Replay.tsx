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
import { CloudDialog } from './components/ui/dialog.js';
import { Input } from './components/ui/input.js';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './components/ui/resizable.js';
import React, { useEffect, useId, useRef, useState } from 'react';
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
      className="flex h-full min-h-0 max-w-full items-center justify-center"
      href={url}
      target="_blank"
      rel="noreferrer"
      title="打开原始截图" data-ui="screenshot-link"
    >
      <img
        className="block h-full max-h-full w-auto max-w-full rounded-lg object-contain"
        src={url}
        alt={`${title} · 原始测试截图`}
        onError={() => setFailed(true)} data-ui="replay-screenshot"
      />
    </a>
  );
}

function ReplayLogs({ files, base, fileUrl, scope }: {
  files: string[];
  base: string;
  fileUrl: (path: string) => string;
  scope: { stepId?: string } | 'attempt';
}) {
  const logId = useId();
  const [logPath, setLogPath] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const logFiles = files.filter((path) => path.startsWith(`${base}/`) && /\.(log|jsonl|txt)$/.test(path));
  const activeLog = logFiles.includes(logPath)
    ? logPath
    : (logFiles.find((path) => path.endsWith('events.jsonl')) ?? logFiles[0]);
  const log = useFile(activeLog ? fileUrl(activeLog) : undefined);
  const allLogs = scope === 'attempt';
  const matchingLogs = parseLog(log.content).filter((line) =>
    (allLogs || (!!scope.stepId && line.timelineNodeId === scope.stepId)) &&
    display(line.message ?? line).toLowerCase().includes(logSearch.toLowerCase()),
  );
  return (
    <>
      <div className="grid min-w-0 gap-1.5 [&>label]:text-xs [&>label]:font-medium" data-ui="field">
        <Label htmlFor={logId}>日志文件</Label>
        <NativeSelect
          id={logId}
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
      ) : matchingLogs.length ? (
        <div className="max-h-80 overflow-auto rounded-md border border-border bg-code text-code-foreground [&_ol]:m-0 [&_ol]:list-none [&_ol]:p-0 [&_ol]:font-mono [&_ol]:text-[11px] [&_ol]:leading-relaxed [&_li]:grid [&_li]:grid-cols-[44px_1fr] [&_li]:gap-2.5 [&_li]:px-2.5 [&_li]:py-px [&_li]:whitespace-pre-wrap [&_li]:break-words" data-ui="log">
          <ol>
            {matchingLogs.map((l, i) => (
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
              : '此步骤没有关联日志。可从「尝试数据」查看完整日志。'}
        </div>
      )}
    </>
  );
}

export function Replay({
  report,
  shared = false,
  reportActions,
  active = true,
}: {
  report: ReportView;
  shared?: boolean;
  active?: boolean;
  reportActions?: React.ReactNode;
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
  const [attemptPanel, setAttemptPanel] = useState<'logs' | 'trace' | 'files'>();
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
  const error = node?.error as Record<string, any> | undefined;
  const failureCount = steps.filter((n) => n.status === 'failed').length;
  const attemptPanelTitles = { logs: '尝试日志', trace: '尝试 Trace', files: '全部归档文件' };
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
  const visibleRows = rows.filter(({ node: n }) => matchesStep(n, filter) && !hidden(n));
  const childCounts = new Map<string, number>();
  for (const step of steps) {
    if (step.parentId) childCounts.set(step.parentId, (childCounts.get(step.parentId) ?? 0) + 1);
  }
  return (
    <>
      <Card asChild>
        <section
          className={`grid min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden ${focused
            ? 'fixed inset-4 z-40 shadow-2xl outline-32 outline-background/90 max-sm:inset-1.5 max-[900px]:block max-[900px]:overflow-y-auto max-[900px]:[&_[data-ui~=workspace-replay]]:h-[1260px]'
            : 'h-[max(550px,calc(100dvh-76px))] max-[900px]:h-[1260px]'}`}
          aria-label="步骤回放"
          aria-keyshortcuts="ArrowLeft ArrowRight Space"
          onKeyDown={(e) => {
            if (e.defaultPrevented) return;
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
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-1.5" data-ui="replay-header">
            {reportActions && <div className="flex shrink-0 items-center gap-1.5">{reportActions}</div>}
            <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2 max-sm:ml-0 max-sm:w-full" data-ui="replay-attempt">
              <Label className="shrink-0 text-xs text-muted-foreground max-sm:sr-only" htmlFor="replay-attempt">用例 / 尝试</Label>
              <NativeSelect
                id="replay-attempt"
                className="w-[clamp(10rem,27vw,24rem)] truncate max-sm:w-[min(48vw,15rem)]"
                value={attemptIndex}
                disabled={!report.tests.length}
                onChange={(e) => {
                  setAttemptIndex(Number(e.target.value));
                  setSelection(undefined);
                  setImageIndex(0);
                  setPlaying(false);
                  setCollapsed(new Set());
                  setFilter('all');
                  setTab('details');
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
              {!shared && (
                <NativeSelect
                  aria-label="尝试数据"
                  value=""
                  disabled={!attempt}
                  onChange={(e) => {
                    switch (e.target.value) {
                      case 'logs': case 'trace': case 'files':
                        setPlaying(false);
                        setAttemptPanel(e.target.value);
                    }
                  }}
                >
                  <option value="" disabled>尝试数据</option>
                  <option value="logs">完整日志</option>
                  <option value="trace">尝试 Trace</option>
                  <option value="files">全部归档文件</option>
                </NativeSelect>
              )}
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
            className="min-h-0 bg-card [&_[data-panel]]:min-h-0 [&_[data-panel]]:min-w-0 [&_[data-panel]]:overflow-hidden" data-ui="workspace-replay"
          >
            <ResizablePanel
              id="replay-steps"
              tagName="section"
              className="grid grid-rows-[auto_auto_minmax(0,1fr)]"
              aria-label="步骤列表"
              defaultSize={stacked ? 24 : 26}
              minSize={stacked ? 16 : 20}
              maxSize={stacked ? 36 : 38} data-ui="rp-steps"
            >
              <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs" data-ui="rp-head">
                <span className="font-semibold">执行步骤</span>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground" data-ui="pos">
                  {index + 1} / {steps.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-1 gap-y-0.5 px-2 py-1.5" data-ui="chiprow">
                {filters.map(([id, label]) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    key={id}
                    className="rounded-full px-1.5 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
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
              <div className="relative min-h-0 overflow-auto px-1.5" data-ui="rp-body">
                {!visible.length && (
                  <div className="grid justify-items-center gap-2 px-4 py-7 text-center text-muted-foreground [&_svg]:size-6 [&_h3]:text-sm [&_p]:max-w-[44ch] [&_p]:text-xs px-2.5 py-4 text-xs" data-ui="empty compact">
                    {steps.length
                      ? '没有符合筛选条件的步骤。'
                      : '此尝试没有可用的时间线。'}
                  </div>
                )}
                {visibleRows.map(({ node: n, depth }, rowIndex) => {
                    const childCount = childCounts.get(n.id) ?? 0;
                    const continues = (visibleRows[rowIndex + 1]?.depth ?? 0) >= depth;
                    const group = childCount > 0;
                    const selected = n.id === node?.id;
                    return (
                      <div
                        key={n.id}
                        data-status={n.status}
                        ref={n.id === node?.id ? selectedRow : undefined}
                        className={`relative flex min-h-8 min-w-0 items-center rounded-md px-1 ${selected ? 'bg-accent' : ''}`}
                        data-ui={`replay-step ${group ? 'step-group' : ''} ${n.status} ${selected ? 'current' : ''}`}
                      >
                        {!!depth && filter === 'all' && (
                          <span aria-hidden="true" className={`pointer-events-none absolute left-2 top-0 w-2 border-l border-border after:absolute after:top-[50%] after:w-2 after:border-t after:border-border ${continues ? 'h-full' : 'h-1/2 after:top-full'}`} />
                        )}
                        {group ? (
                          <Button
                            variant="ghost"
                            size="default"
                            className="z-10 h-6 w-4 shrink-0 p-0 [&_svg]:size-3"
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
                        ) : <span className="w-4 shrink-0" aria-hidden="true" />}
                        <Button
                          variant="ghost"
                          size="default"
                          className="grid h-auto min-h-8 min-w-0 flex-1 grid-cols-[2.5ch_1rem_minmax(0,1fr)_7ch] gap-1.5 px-1 py-1.5 text-left font-normal [&>svg]:size-3.5"
                          aria-current={n.id === node?.id ? 'step' : undefined}
                          onClick={() => {
                            choose(n.id);
                            setPlaying(false);
                          }}
                          title={n.title} data-ui="step-select"
                        >
                          <span className="text-right font-mono text-[10px] tabular-nums text-muted-foreground" data-ui="step-number">
                            {String(steps.indexOf(n) + 1).padStart(2, '0')}
                          </span>
                          {n.status === 'failed' ? (
                            <ResultIcon status="failed" className="size-4 [&_svg]:size-2.5" />
                          ) : n.status === 'passed' &&
                            !matchesStep(n, 'screenshots') ? (
                            <ResultIcon status="passed" className="size-4 [&_svg]:size-2.5" />
                          ) : (
                            <Icon
                              name={
                                matchesStep(n, 'screenshots') ? 'camera' : 'clock'
                              }
                            />
                          )}
                          <span className="min-w-0" style={{ paddingLeft: filter === 'all' ? Math.min(depth, 5) * 8 : 0 }} data-ui="step-name">
                            <span className={`block truncate ${selected || group ? 'font-semibold' : ''}`}>{n.title}</span>
                            {group && <small className="block truncate text-[10px] leading-tight text-muted-foreground">{childCount} 个子步骤</small>}
                          </span>
                          <span className="text-right font-mono text-[10px] whitespace-nowrap tabular-nums text-muted-foreground" data-ui="step-duration">
                            {durationLabel(durationMs(n))}
                          </span>
                        </Button>
                      </div>
                    );
                  })}
              </div>
            </ResizablePanel>
            <ResizableHandle aria-label="调整步骤列表与回放区域大小" />
            <ResizablePanel
              id="replay-content"
              tagName="section"
              className="min-h-0"
              aria-label="回放区域"
              defaultSize={stacked ? 76 : 74}
              minSize={stacked ? 64 : 62} data-ui="rp-content"
            >
              <ResizablePanelGroup direction="vertical" className="h-full min-h-0" data-ui="replay-content-panels">
                <ResizablePanel id="replay-evidence" order={1} defaultSize={70} minSize={45}>
                  <ResizablePanelGroup
                    direction={stacked ? 'vertical' : 'horizontal'}
                    className="min-h-0" data-ui="replay-evidence"
                  >
                      <ResizablePanel
                        id="replay-stage"
                        tagName="section"
                        className="flex min-h-0 flex-col"
                        aria-label="回放画面"
                        defaultSize={stacked ? 52 : 42}
                        minSize={stacked ? 30 : 24} data-ui="rp-stage"
                      >
                        <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b border-border px-3 text-xs text-muted-foreground" data-ui="replay-current">
                          {images.length > 0 && <Icon name="camera" className="size-3.5" />}
                          {images.length === 1 && <span className="font-mono" aria-label="截图 1 / 1">1 / 1</span>}
                          {images.length > 1 && (
                            <NativeSelect size="sm" aria-label="截图" value={imageIndex} onChange={(e) => {
                              setImageIndex(Number(e.target.value));
                              setPlaying(false);
                            }}>
                              {images.map((path, i) => <option key={path} value={i}>{i + 1} / {images.length}</option>)}
                            </NativeSelect>
                          )}
                        </div>
                        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto overscroll-contain bg-muted p-2.5" data-ui="replay-canvas">
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
                                可在信息面板查看{shared ? '步骤信息' : '失败详情、日志或产物'}。
                              </p>
                            </div>
                          )}
                        </div>
                      </ResizablePanel>
                      <ResizableHandle aria-label="调整回放画面与信息面板大小" />
                      <ResizablePanel
                        id="replay-inspector"
                        defaultSize={stacked ? 48 : 58}
                        minSize={25}
                      >
                        <Tabs asChild value={tab} onValueChange={setTab}>
                          <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] [&_[data-ui~=rp-body]]:grid [&_[data-ui~=rp-body]]:content-start [&_[data-ui~=rp-body]]:gap-3 [&_[data-ui~=rp-body]]:p-3" aria-label="信息面板" data-ui="rp-inspector">
                            <TabsList
                              className="h-9 w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-card px-2.5"
                              aria-label="当前步骤证据"
                            >
                              <TabsTrigger value="details" className="h-6 shrink-0 px-2 data-[state=active]:bg-accent">
                                {node?.status === 'failed' ? '失败详情' : '步骤详情'}
                              </TabsTrigger>
                              {!shared && <>
                                <TabsTrigger value="logs" className="h-6 shrink-0 px-2 data-[state=active]:bg-accent">步骤日志</TabsTrigger>
                                <TabsTrigger value="source" className="h-6 shrink-0 px-2 data-[state=active]:bg-accent">源码</TabsTrigger>
                              </>}
                              <TabsTrigger value="artifacts" className="h-6 shrink-0 px-2 data-[state=active]:bg-accent">步骤产物</TabsTrigger>
                            </TabsList>
                            <TabsContent
                              value={tab}
                              className="relative min-h-0 overflow-auto [&_[data-ui~=kv]]:grid-cols-[auto_minmax(0,1fr)] [&_[data-ui~=kv]]:gap-x-3 [&_[data-ui~=kv]]:gap-y-1.5 [&_[data-ui~=kv]]:text-[11px] [&_[data-ui~=kv]_dd]:break-words [&_[data-ui~=codeblk]]:max-h-[420px] [&_[data-ui~=codeblk]]:text-[11px] [&_summary]:text-xs [&_[data-ui~=codesnap]]:max-h-[310px] [&_[data-ui~=codesnap]_code]:text-inherit [&_[data-ui~=note]_p]:mt-1 [&_[data-ui~=note]_p]:text-xs [&_[data-ui~=note]_p]:leading-relaxed [&_[data-ui~=note]_p]:text-inherit mt-0" data-ui="rp-body inspector-pane"
                            >
                              {tab === 'details' &&
                                (node ? (
                                  <>
                                    <div className="grid min-w-0 gap-2" data-ui={`assert ${error ? 'bad' : ''}`}>
                                      <div className={`flex min-w-0 items-center gap-2 text-sm font-semibold break-all ${node.status === 'failed' ? 'text-destructive' : ''}`} data-ui="hd">
                                        {node.status === 'failed' || node.status === 'passed'
                                          ? <ResultIcon status={node.status} />
                                          : <Icon name="clock" />}
                                        {node.title}
                                      </div>
                                      <div className="flex gap-2.5 text-[11px] text-muted-foreground" data-ui="step-facts">
                                        <span>{statusLabels[node.status]}</span>
                                        <code>{node.kind}</code>
                                        <span>{durationLabel(durationMs(node))}</span>
                                      </div>
                                      {error && (
                                        <>
                                          <pre className="m-0 max-h-72 overflow-auto rounded-md bg-code px-3 py-2.5 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere] text-code-foreground" data-ui="error-message">
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
                                      <h4 className="border-t border-border pt-2 !font-semibold !text-foreground">步骤信息</h4>
                                      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2 rounded-md border border-border p-2 text-xs [&_dt]:whitespace-nowrap [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:text-foreground" data-ui="kv">
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
                                <ReplayLogs key={attemptIndex} files={report.files} base={base} fileUrl={fileUrl} scope={{ stepId: node?.id }} />
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
                                </>
                              )}
                            </TabsContent>
                          </section>
                        </Tabs>
                      </ResizablePanel>
                  </ResizablePanelGroup>
                </ResizablePanel>
                <ResizableHandle
                  className="transition-colors hover:bg-primary focus-visible:bg-primary"
                  aria-label="调整时间轴与回放详情高度"
                />
                <ResizablePanel id="replay-timeline" order={2} defaultSize={30} minSize={18} maxSize={55}>
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
                      <div className="flex flex-wrap items-center gap-1 pointer-coarse:[&_:is(button,select)]:min-h-9" role="group" aria-label="时间轴回放控制" data-ui="replay-toolbar">
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          className="pointer-coarse:w-9"
                          aria-label="上一步"
                          title="上一步"
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
                          size="icon-sm"
                          className="pointer-coarse:w-9"
                          aria-label="下一步"
                          title="下一步"
                          disabled={
                            !visible.length || visible.indexOf(node) >= visible.length - 1
                          }
                          onClick={() => move(1)}
                        >
                          <Icon name="next" />
                        </Button>
                        <NativeSelect
                          size="sm"
                          className="w-14 max-[640px]:h-6"
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
      {attemptPanel && (
        <CloudDialog title={attemptPanelTitles[attemptPanel]} onClose={() => setAttemptPanel(undefined)} wide>
          <div className="grid min-w-0 gap-2 p-3">
            {attemptPanel === 'logs' && <ReplayLogs files={report.files} base={base} fileUrl={fileUrl} scope="attempt" />}
            {attemptPanel === 'trace' && (
              <pre className="m-0 overflow-auto whitespace-pre rounded-md bg-code p-3.5 font-mono text-xs leading-relaxed text-code-foreground">
                {attempt?.trace ? display(attempt.trace) : '此尝试没有可用 Trace。'}
              </pre>
            )}
            {attemptPanel === 'files' && (
              <AttemptFiles files={report.files} base={base} fileUrl={fileUrl} />
            )}
          </div>
        </CloudDialog>
      )}
    </>
  );
}

function AttemptFiles({ files, base, fileUrl }: {
  files: string[];
  base: string;
  fileUrl: (path: string) => string;
}) {
  const paths = files.filter((path) => path.startsWith(`${base}/`));
  if (!paths.length) return <p className="text-muted-foreground">此尝试没有归档文件。</p>;
  return (
    <div className="grid gap-1.5" data-ui="arts">
      {paths.map((path) => (
        <a
          className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm bg-muted px-2.5 py-1.5 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          key={path}
          href={fileUrl(path)}
          target="_blank"
          rel="noreferrer"
          data-ui="art"
        >
          <Icon name="doc" />
          <span className="truncate text-xs text-secondary-foreground" title={path} data-ui="nm">
            {path.slice(base.length + 1)}
          </span>
          <span aria-hidden="true">↗</span>
        </a>
      ))}
    </div>
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
