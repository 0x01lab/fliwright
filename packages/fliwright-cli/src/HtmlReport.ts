import { createHash } from 'node:crypto';
import type { EvidenceStatus, RunStatus } from '@fliwright/core';
import { reportScript, reportStyles } from './HtmlReportAssets.js';
import type { DeviceMetadata } from './DeviceMetadata.js';
import type { ReleaseAssessment, ReviewedCase, ReviewedIssue } from './ReleaseReview.js';

interface ReportImage { data: string; title: string; }
export interface HtmlReportStep {
  title: string; kind: string; status: RunStatus; startedAt: string; endedAt?: string;
  route?: string; source?: { file: string; line: number }; error?: unknown; nested?: boolean; images: ReportImage[];
}
export interface HtmlReportAttempt {
  id: string; name?: string; file?: string; status: RunStatus; outcome: RunStatus; evidenceStatus: EvidenceStatus;
  flaky?: boolean; expectedFailure?: boolean; startedAt?: string; endedAt?: string;
  steps: HtmlReportStep[]; failures: unknown[]; images: ReportImage[];
}
export interface HtmlReportTest {
  id: string; name: string; file?: string; status: RunStatus; duration?: number; error?: string;
  flaky?: boolean; attempts: HtmlReportAttempt[];
}
interface HtmlReport {
  runId: string; status: RunStatus; evidenceStatus: EvidenceStatus; duration?: number;
  tests: HtmlReportTest[]; runnerErrors: Array<{ phase: string; message: string; stack?: string }>; missing: string[];
  assessment: ReleaseAssessment; device?: DeviceMetadata; projectIcon?: string;
}

const labels: Record<RunStatus, string> = { passed: '通过', failed: '失败', skipped: '跳过', interrupted: '已中断', running: '执行中' };
const symbols: Record<RunStatus, string> = { passed: '✓', failed: '×', skipped: '−', interrupted: '!', running: '·' };
const evidenceLabels: Record<EvidenceStatus, string> = { complete: '证据完整', partial: '证据不完整', disabled: '自动记录已关闭' };
const kinds: Record<string, string> = { page: '页面', frame: '画面', step: '步骤', action: '操作', assertion: '断言', failure: '错误',
  mock: 'Mock', 'ai-call': 'AI', branch: '分支', optional: '可选步骤', manual: '人工操作', script: '脚本' };
function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
function duration(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.max(0, Math.round(value))} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.floor(value / 60000)} min ${Math.round(value % 60000 / 1000)} s`;
}
function elapsed(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) ? Math.max(0, value) : undefined;
}
function badge(status: RunStatus): string {
  return `<span class="badge ${status}"><span class="status-icon" aria-hidden="true">${symbols[status]}</span>${labels[status]}</span>`;
}
function code(value: unknown): string {
  return `<pre>${escape(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre>`;
}
function gallery(images: ReportImage[]): string {
  if (!images.length) return '';
  return `<div class="gallery">${images.map(image => `<button type="button" class="screenshot" aria-label="放大截图：${escape(image.title)}"><img loading="lazy" src="${escape(image.data)}" alt="${escape(image.title)}"><span>${escape(image.title)} ↗</span></button>`).join('')}</div>`;
}
function stepHtml(step: HtmlReportStep, index: number): string {
  return `<li class="step${step.nested ? ' nested' : ''}"><div class="step-heading"><span class="step-number">${String(index + 1).padStart(2, '0')}</span><div class="step-title"><span class="kind">${escape(kinds[step.kind] ?? step.kind)}</span><strong>${escape(step.title)}</strong></div>${badge(step.status)}<span class="duration">${duration(elapsed(step.startedAt, step.endedAt))}</span></div>
    ${step.route || step.source ? `<p class="step-meta">${escape(step.route)}${step.source ? ` · ${escape(step.source.file)}:${escape(step.source.line)}` : ''}</p>` : ''}
    ${step.error ? `<details class="technical"><summary>错误详情</summary>${code(step.error)}</details>` : ''}${gallery(step.images)}</li>`;
}
function attemptHtml(attempt: HtmlReportAttempt, index: number, multiple: boolean): string {
  const content = `<div class="attempt-meta"><span>${escape(attempt.id)}</span><span>${escape(evidenceLabels[attempt.evidenceStatus])}</span>${attempt.expectedFailure ? '<span>预期失败</span>' : ''}${attempt.startedAt ? `<time>${escape(attempt.startedAt)}</time>` : ''}</div>
    ${attempt.steps.length ? `<ol class="steps">${attempt.steps.map(stepHtml).join('')}</ol>` : '<p class="empty-evidence">未记录执行步骤。</p>'}
    ${gallery(attempt.images)}${attempt.failures.length ? `<details class="technical"><summary>失败上下文 · ${attempt.failures.length}</summary>${attempt.failures.map(code).join('')}</details>` : ''}`;
  return multiple
    ? `<details class="attempt" data-attempt="${escape(attempt.id)}"${attempt.outcome === 'passed' && attempt.status === 'passed' ? ' open' : ''}><summary><span>执行 ${index + 1}</span>${badge(attempt.status)}<span class="duration">${duration(elapsed(attempt.startedAt, attempt.endedAt))}</span></summary>${content}</details>`
    : `<section class="attempt" data-attempt="${escape(attempt.id)}">${content}</section>`;
}
function caseStatus(entry: ReviewedCase): string {
  return entry.status;
}
function caseHtml(test: HtmlReportTest | undefined, reviewed?: ReviewedCase, issue?: ReviewedIssue): string {
  const definition = reviewed?.definition;
  const name = definition?.title ?? test?.name ?? '';
  const id = definition?.id ?? test?.id ?? '';
  const status = reviewed ? caseStatus(reviewed) : test!.status;
  const statusHtml = test ? badge(test.status) : `<span class="badge missing">${escape(reviewed?.result ?? '待执行')}</span>`;
  const time = test?.duration ?? (test?.attempts.length ? test.attempts.reduce((total, attempt) => total + (elapsed(attempt.startedAt, attempt.endedAt) ?? 0), 0) : undefined);
  const automation = definition?.automation;
  const gapReason = automation && 'reason' in automation ? automation.reason : undefined;
  const supporting = reviewed?.supportingTests ?? [];
  const search = [gapReason, ...supporting.map(entry => entry.name), id, name, definition?.description, definition?.expectedResult, ...(definition?.acceptanceCriteria ?? []), ...(issue?.acceptanceCriteria.flatMap(criterion => [criterion.id, criterion.text]) ?? []), definition?.binding?.file, definition?.binding?.name, test?.file, issue?.url, issue?.title, issue ? `#${issue.source.iid}` : '', ...(definition?.preconditions ?? []), ...(definition?.steps.flatMap(step => [step.action, step.expectedResult]) ?? [])].filter(Boolean).join(' ').toLowerCase();
  return `<details class="test-card" data-status="${status}" data-case-id="${escape(id)}" data-name="${escape(search)}" open>
    <summary><code class="case-number">${escape(id)}</code><div class="case-heading"><strong>${escape(name)}</strong></div>${test?.flaky ? '<span class="flaky">重试后通过</span>' : ''}${statusHtml}<span class="chevron" aria-hidden="true">⌄</span></summary>
    <div class="test-body"><dl class="case-description"><div><dt>用例描述</dt><dd>${escape(definition?.description ?? '未提供测试用例描述')}</dd></div>${definition ? `<div><dt>验收标准</dt><dd>${definition.acceptanceCriteria.map(escape).join('、')}</dd></div><div><dt>前置条件</dt><dd>${definition.preconditions.length ? definition.preconditions.map(escape).join('<br>') : '无'}</dd></div><div><dt>测试步骤</dt><dd><ol>${definition.steps.map(step => `<li>${escape(step.action)}<br><span class="muted">预期：${escape(step.expectedResult)}</span></li>`).join('')}</ol></dd></div>` : ''}<div><dt>预期结果</dt><dd>${escape(definition?.expectedResult ?? '未提供预期结果')}</dd></div>${gapReason ? `<div><dt>覆盖缺口</dt><dd>${escape(gapReason)}</dd></div>` : ''}<div><dt>测试结果</dt><dd>${statusHtml}${test?.attempts.some(attempt => attempt.expectedFailure) ? ' <span class="qualification-note">预期失败，不能作为发版验收通过依据</span>' : ''}${test?.flaky ? ' <span class="qualification-note">重试后通过；执行记录保留全部尝试</span>' : ''}${test ? `<span class="result-duration">${duration(time)}</span>` : ''}</dd></div></dl>
    ${supporting.length ? `<details class="execution"><summary>部分覆盖的执行证据 · ${supporting.length} 项</summary><p class="empty-evidence">以下执行仅覆盖部分预期，不能认定整条用例通过。</p>${supporting.map(entry => `<section><h3>${escape(entry.name)} ${badge(entry.status)}</h3>${entry.attempts.map((attempt, i) => attemptHtml(attempt, i, entry.attempts.length > 1)).join('')}</section>`).join('')}</details>` : ''}
    ${test?.error ? `<div class="error-detail">${code(test.error)}</div>` : ''}
    ${test ? `<details class="execution"><summary>执行记录与截图 <span>${test.attempts.length} 次执行</span></summary><p class="source-file">${escape(test.file ?? definition?.binding?.file ?? '')}</p>${test.attempts.map((attempt, i) => attemptHtml(attempt, i, test.attempts.length > 1)).join('') || '<p class="empty-evidence">没有独立执行记录。</p>'}</details>` : `<p class="empty-evidence">${status === 'pending' ? '尚未提供完整测试脚本。' : status === 'partial' || status === 'blocked' ? '补齐覆盖缺口后才能进行完整用例验收。' : '本次运行未匹配到唯一的测试执行结果。'}</p>`}</div></details>`;
}

/** Render preloaded evidence with escaped text and no network or runtime dependencies. */
export function renderHtmlReport(report: HtmlReport): string {
  const { assessment } = report;
  const release = assessment.release;
  const heading = assessment.issues.length === 1 ? assessment.issues[0].title : '发版测试审核报告';
  const reviewed = assessment.issues.flatMap(issue => issue.cases);
  const linked = new Set(reviewed.flatMap(entry => [...(entry.test ? [entry.test] : []), ...entry.supportingTests]));
  const unlinked = report.tests.filter(test => !linked.has(test));
  const statuses = [...reviewed.map(caseStatus), ...unlinked.map(test => test.status)];
  const counts = Object.fromEntries([...Object.keys(labels), 'missing', 'ambiguous', 'pending', 'partial', 'blocked'].map(status => [status, statuses.filter(value => value === status).length]));
  const total = statuses.length;
  const qualified = reviewed.filter(entry => entry.qualified).length;
  const firstStart = report.tests.flatMap(test => test.attempts.map(attempt => attempt.startedAt ?? '')).filter(Boolean).sort()[0];
  const hash = createHash('sha256').update(reportScript).digest('base64');
  const decision = assessment.releaseReady ? '测试合格，待人工审核' : '测试未合格，禁止发版';
  const releaseFields = [['应用', release.app], ['版本 / 构建号', `${release.version ?? '未提供'} / ${release.build ?? '未提供'}`],
    ['代码提交', release.commit], ['平台 / 环境', `${release.platform ?? '未提供'} / ${release.environment ?? '未提供'}`],
    ['测试运行', report.runId], ['测试时间', firstStart], ['测试耗时', duration(report.duration)], ['设备型号', report.device?.model ?? '未记录']];
  const issueHtml = assessment.issues.map(issue => {
    const reference = `#${new URL(issue.url).pathname.split('/').filter(Boolean).at(-1)}`;
    return `<section class="issue-group" data-issue-group><header class="issue-heading"><div><a href="${escape(issue.url)}" target="_blank" rel="noopener noreferrer">${escape(reference)} ${escape(issue.title)} ↗</a></div><span class="issue-result ${issue.qualified ? 'qualified' : 'unqualified'}">${issue.cases.filter(entry => entry.qualified).length} / ${issue.cases.length} 合格</span></header><div class="acceptance-criteria"><h3>${issue.basis === 'acceptance-checklist' ? '验收 checklist' : '根据需求推导的验收标准'}</h3>${issue.acceptanceCriteria.length ? `<ol>${issue.acceptanceCriteria.map(criterion => `<li><code>${escape(criterion.id)}</code> ${escape(criterion.text)}</li>`).join('')}</ol>` : '<p>无可验证的验收标准。</p>'}</div>${issue.cases.map(entry => caseHtml(entry.test, entry, issue)).join('')}</section>`;
  }).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'">
<title>${escape([release.app, release.version].filter(Boolean).join(' ') || report.runId)} · 发版测试审核报告</title><style>${reportStyles}</style></head>
<body><aside class="report-toolbar" aria-label="报告工具栏"><a class="project-icon" href="#overview" aria-label="${escape(release.app ?? '项目')} · 返回报告概览">${report.projectIcon ? `<img src="${escape(report.projectIcon)}" width="40" height="40" alt="${escape(release.app ?? '项目')} 图标">` : `<span aria-hidden="true">${escape(Array.from(release.app ?? '项目')[0])}</span>`}</a>
<button id="theme" type="button" aria-label="切换深色主题" title="切换深色主题" aria-pressed="false"><svg class="theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/></svg><svg class="theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg></button></aside>
<main><section id="overview"><h1>${escape(heading)}</h1><dl class="release-meta">${releaseFields.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value ?? '未提供')}</dd></div>`).join('')}</dl></section>
<section class="review-decision" aria-labelledby="review-decision"><div class="decision-heading"><span class="decision-icon ${assessment.releaseReady ? 'qualified' : 'unqualified'}" aria-hidden="true">${assessment.releaseReady ? '✓' : '×'}</span><h2 id="review-decision">${decision}</h2></div><p class="decision-policy">发版条件：审核清单内全部用例通过、无漏测、无未关联测试，且测试证据完整。测试合格后仍需人工审核。</p>
<dl class="review-counts"><div><dt>GitLab Item</dt><dd>${assessment.issues.length}</dd></div><div><dt>计划用例</dt><dd>${reviewed.length}</dd></div><div><dt>已合格</dt><dd>${qualified}</dd></div><div><dt>未合格</dt><dd>${reviewed.length - qualified}</dd></div><div><dt>未关联测试</dt><dd>${unlinked.length}</dd></div></dl>
${assessment.blockers.length ? `<div class="blockers"><h3>发版阻塞项</h3><ul>${assessment.blockers.map(blocker => `<li>${escape(blocker)}</li>`).join('')}</ul></div>` : ''}</section>
${report.missing.length ? `<section class="notice"><strong>证据不完整</strong><details><summary>查看 ${report.missing.length} 项缺失记录</summary><ul>${report.missing.map(issue => `<li>${escape(issue)}</li>`).join('')}</ul></details></section>` : ''}
${report.runnerErrors.length ? `<section class="runner-errors"><h2>运行环境错误 <span>${report.runnerErrors.length}</span></h2>${report.runnerErrors.map(error => `<article><strong>${escape(error.phase)}</strong>${code(error.message)}${error.stack ? `<details><summary>堆栈信息</summary>${code(error.stack)}</details>` : ''}</article>`).join('')}</section>` : ''}
<section class="cases"><div class="section-title"><h2>GitLab Item 与测试用例</h2><button id="expand" type="button">收起全部用例</button></div>
<div class="toolbar"><div class="filters" role="group" aria-label="按结果筛选"><button type="button" data-filter="all" aria-pressed="true">全部 <span>${total}</span></button>${Object.entries({ ...labels, missing: '待执行', ambiguous: '匹配不唯一', pending: '待编写', partial: '部分覆盖', blocked: '受阻' }).filter(([status]) => counts[status] > 0).map(([status, label]) => `<button type="button" data-filter="${status}" aria-pressed="false">${label} <span>${counts[status]}</span></button>`).join('')}</div><label class="search"><span>搜索</span><input id="search" type="search" placeholder="Item、用例或描述" autocomplete="off"></label></div>
<p id="visible-count" class="visible-count" aria-live="polite">共 ${total} 个用例</p><div id="test-list">${issueHtml}${unlinked.length ? `<section class="issue-group unlinked" data-issue-group><header class="issue-heading"><h3>未关联 GitLab Item 的测试</h3><span>${unlinked.length} 个</span></header>${unlinked.map(test => caseHtml(test)).join('')}</section>` : ''}</div><p id="no-results" class="empty-state"${total ? ' hidden' : ''}>没有匹配的测试用例。</p></section>
<footer><span>发版测试审核报告</span><button id="print" type="button">打印 / PDF</button><code>${escape(report.runId)}</code></footer></main>
<dialog id="image-dialog" aria-label="截图预览"><div class="dialog-toolbar"><p id="image-caption"></p><button id="close-image" type="button" autofocus>关闭 ×</button></div><img id="preview-image" alt=""></dialog>
<script>${reportScript}</script></body></html>`;
}
