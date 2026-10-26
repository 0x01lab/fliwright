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
import type { ReportView } from '../ReportStore.js';
import { Icon, ResultIcon } from './ui.js';
import { TimeTimeline } from './TimeTimeline.js';
import {
  artifactPath,
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
      <div className="empty compact">未归档源码快照，无法展示对应源码。</div>
    );
  if (error)
    return (
      <div role="alert" className="error">
        {error}
      </div>
    );
  if (loading) return <div className="empty compact">正在读取源码…</div>;
  return (
    <div className="codesnap" ref={container}>
      <ol>
        {content.split('\n').map((text, i) => (
          <li
            key={i}
            className={i + 1 === line ? 'hl' : ''}
            ref={i + 1 === line ? highlight : undefined}
          >
            <span className="ln">{i + 1}</span>
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
    <div role="alert" className="empty">
      截图无法读取。
      <a href={url} target="_blank" rel="noreferrer">
        打开原始产物
      </a>
    </div>
  ) : (
    <a
      className="screenshot-link"
      href={url}
      target="_blank"
      rel="noreferrer"
      title="打开原始截图"
    >
      <img
        className="replay-screenshot"
        src={url}
        alt={`${title} · 原始测试截图`}
        onError={() => setFailed(true)}
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
    const list = row?.closest<HTMLElement>('.rp-body');
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
        className={`overflow-hidden replay-panel ${focused ? 'replay-focused' : ''}`}
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
        tabIndex={0}
      >
        <div className="panel-head">
          <h2>步骤回放</h2>
          <span className="sub">
            {steps.length} 步 ·{' '}
            {steps.filter((n) => matchesStep(n, 'screenshots')).length} 步有截图
            · {failureCount} 处失败
          </span>
          <div className="right replay-attempt">
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
              variant="secondary"
              size="default"
              className="focus-button"
              aria-pressed={focused}
              onClick={() => setFocused((f) => !f)}
            >
              {focused ? '退出专注' : '专注回放'}
            </Button>
          </div>
        </div>
        <ResizablePanelGroup
          key={stacked ? 'stacked' : 'columns'}
          direction={stacked ? 'vertical' : 'horizontal'}
          className="workspace-replay"
        >
          <ResizablePanel
            id="replay-steps"
            tagName="section"
            className="rp-steps"
            aria-label="步骤列表"
            defaultSize={stacked ? 22 : 18}
            minSize={stacked ? 15 : 12}
            maxSize={stacked ? 35 : 30}
          >
            <div className="rp-head">
              <span>步骤</span>
              <span className="pos">
                {index + 1} / {steps.length} 步
              </span>
            </div>
            <div className="rp-body">
              <div className="chiprow">
                {filters.map(([id, label]) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    key={id}
                    className="chip rounded-full aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                    aria-pressed={filter === id}
                    onClick={() => changeFilter(id)}
                    title={id === 'slow' ? '耗时不少于 10 秒' : undefined}
                  >
                    {label}
                    <span className="n">
                      {steps.filter((n) => matchesStep(n, id)).length}
                    </span>
                  </Button>
                ))}
              </div>
              {!visible.length && (
                <div className="empty compact">
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
                      ref={n.id === node?.id ? selectedRow : undefined}
                      className={`replay-step ${group ? 'step-group' : ''} ${n.status} ${n.id === node?.id ? 'current' : ''}`}
                      style={{ paddingLeft: 10 + Math.min(depth, 5) * 12 }}
                    >
                      {group && (
                        <Button
                          variant="ghost"
                          size="default"
                          className="collapse-step h-auto min-h-6 w-4 shrink-0 p-0"
                          aria-label={`${collapsed.has(n.id) ? '展开' : '折叠'} ${n.title}`}
                          aria-expanded={!collapsed.has(n.id)}
                          onClick={() =>
                            setCollapsed((old) => {
                              const next = new Set(old);
                              if (next.has(n.id)) next.delete(n.id);
                              else next.add(n.id);
                              return next;
                            })
                          }
                        >
                          <Icon
                            name="chevron"
                            className={collapsed.has(n.id) ? '' : 'expanded'}
                          />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="default"
                        className="step-select h-auto min-h-7 w-full justify-start rounded-none px-2 py-1 text-left font-normal"
                        aria-current={n.id === node?.id ? 'step' : undefined}
                        onClick={() => {
                          choose(n.id);
                          setPlaying(false);
                        }}
                        title={n.title}
                      >
                        <span className="step-number">
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
                        <span className="step-name">
                          {n.title}
                          <small>
                            {group
                              ? `${nodes.filter((c) => c.parentId === n.id).length} 个子步骤`
                              : n.kind}
                          </small>
                        </span>
                        <span
                          className={`step-duration ${matchesStep(n, 'slow') ? 'slow' : ''}`}
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
            className="rp-content"
            aria-label="回放区域"
            defaultSize={stacked ? 78 : 82}
            minSize={stacked ? 65 : 70}
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
                <div className="replay-toolbar" role="group" aria-label="时间轴回放控制">
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
                    className="play-speed h-7 py-0.5 pl-2 pr-6 text-xs"
                    aria-label="回放速度"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
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
              className="replay-evidence"
            >
              <ResizablePanel
                id="replay-stage"
                tagName="section"
                className="rp-stage"
                aria-label="回放画面"
                defaultSize={stacked ? 55 : 39}
                minSize={stacked ? 30 : 24}
              >
                <div className="replay-current">
                  <b>{node ? `${index + 1}. ${node.title}` : '选择步骤查看证据'}</b>
                  <span>
                    {node && durationLabel(durationMs(node))}
                    {images.length ? ` · ${images.length} 张截图` : ''}
                  </span>
                </div>
                <div className="replay-canvas">
                  {images.length ? (
                    <Screenshot
                      key={images[Math.min(imageIndex, images.length - 1)]}
                      url={fileUrl(images[Math.min(imageIndex, images.length - 1)])}
                      title={node?.title ?? ''}
                    />
                  ) : (
                    <div className="canvas-empty">
                      <Icon name="camera" />
                      <h3>此步骤没有截图</h3>
                      <p>
                        可在右侧查看{shared ? '步骤信息' : '失败详情、日志或产物'}。
                      </p>
                    </div>
                  )}
                </div>
                {images.length > 1 && (
                  <div className="image-selector">
                    {images.map((path, i) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        key={path}
                        className="chip rounded-full aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                        aria-pressed={i === imageIndex}
                        onClick={() => setImageIndex(i)}
                      >
                        截图 {i + 1}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="replay-position">
                  <div className="scrubber-caption">
                    <span>
                      {index + 1} / {steps.length} 步 ·{' '}
                      {node && statusLabels[node.status]} ·{' '}
                      {durationLabel(node && durationMs(node))}
                    </span>
                    <span className={failureCount ? 'failure-text' : ''}>
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
                  <section className="rp-inspector" aria-label="信息面板">
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
                      className="rp-body inspector-pane mt-0"
                    >
                      {tab === 'details' &&
                        (node ? (
                          <>
                            <div className={`assert ${error ? 'bad' : ''}`}>
                              <div className="hd">
                                <Icon name={error ? 'x' : 'check'} />
                                {node.title}
                              </div>
                              <div className="step-facts">
                                <span>{statusLabels[node.status]}</span>
                                <span>{durationLabel(durationMs(node))}</span>
                                <code>{node.kind}</code>
                              </div>
                              {error && (
                                <>
                                  <pre className="error-message">
                                    {display(error.message ?? error)}
                                  </pre>
                                  {(error.expected !== undefined ||
                                    error.actual !== undefined) && (
                                    <dl className="cmp">
                                      <dt>期望</dt>
                                      <dd className="want">
                                        {display(error.expected)}
                                      </dd>
                                      <dt>实际</dt>
                                      <dd className="got">{display(error.actual)}</dd>
                                    </dl>
                                  )}
                                </>
                              )}
                            </div>
                            {sourceRef && (
                              <div className="sect">
                                <h4>
                                  <Icon name="code" />
                                  源码位置
                                </h4>
                                <div className="source-location">
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
                                <div className="note warn">
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
                            <div className="sect">
                              <h4>步骤信息</h4>
                              <dl className="kv">
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
                                        className="text-button h-auto justify-start p-0 text-xs text-primary"
                                        onClick={() => choose(node.parentId!)}
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
                                <pre className="codeblk">
                                  {display(node.metadata)}
                                </pre>
                              </details>
                            )}
                            {error && (
                              <details>
                                <summary>完整失败记录</summary>
                                <pre className="codeblk">{display(error)}</pre>
                              </details>
                            )}
                            <div className="sect">
                              <h4>
                                <Icon name="box" />
                                本步骤产物{' '}
                                <span className="right">{artifacts.length}</span>
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
                          <div className="empty">选择一个步骤查看详细信息。</div>
                        ))}
                      {tab === 'source' && (
                        <div className="sect">
                          <h4>
                            归档源码{' '}
                            {sourceRef?.line ? `· 第 ${sourceRef.line} 行` : ''}
                          </h4>
                          <code className="source-location">
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
                          <div className="field">
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
                          <Label className="check">
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
                            <div role="alert" className="error">
                              {log.error}
                            </div>
                          )}
                          {log.loading ? (
                            <div className="empty">正在读取日志…</div>
                          ) : stepLogs.length ? (
                            <div className="log">
                              <ol>
                                {stepLogs.map((l, i) => (
                                  <li
                                    key={i}
                                    className={
                                      l.level === 'error'
                                        ? 'err'
                                        : l.level === 'warn'
                                          ? 'warn'
                                          : ''
                                    }
                                  >
                                    <span className="ln">{i + 1}</span>
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
                            <div className="empty compact">
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
                          <pre className="codeblk">
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
                              <div className="arts">
                                {report.files
                                  .filter((p) => p.startsWith(`${base}/`))
                                  .map((p) => (
                                    <a
                                      className="art"
                                      key={p}
                                      href={fileUrl(p)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <Icon name="doc" />
                                      <span className="nm" title={p}>
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
                        className={`rp-body inspector-pane report-pane mt-0 ${tab !== id ? 'hidden' : ''}`}
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
          <div className="note warn">
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
    <div className="arts">
      {artifacts.map((a, i) => {
        const path = resolve(a.path);
        const permitted =
          path && (!shared || /\.(png|jpe?g|webp)$/i.test(path));
        return permitted ? (
          <a
            key={i}
            className="art"
            href={fileUrl(path)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name={a.kind === 'screenshot' ? 'camera' : 'doc'} />
            <span className="nm" title={a.path}>
              {a.path}
            </span>
            <span className="sz">{a.kind} ↗</span>
          </a>
        ) : (
          <div className="art" key={i}>
            <Icon name="doc" />
            <span className="nm" title={a.path}>
              {a.path}
            </span>
            <span className="sz">{path ? '受限' : '未归档'}</span>
          </div>
        );
      })}
    </div>
  ) : (
    <p className="hint">此步骤没有关联产物。</p>
  );
}
