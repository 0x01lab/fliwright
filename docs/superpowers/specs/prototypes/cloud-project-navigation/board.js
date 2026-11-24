'use strict';
// Standalone design prototype. Only the current browser tab owns the example data.
const app = document.getElementById('app');
const modal = document.getElementById('overlay');
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
const E = escapeHtml;
const icons = {
  board:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8v8m4-8v5m4-5v8"/>',
  folder: '<path d="M3 7V5h6l2 2h10v12H3z"/>',
  report: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h5m-5 4h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  check: '<path d="m4 12 5 5 11-11"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10m0-2c7 0 12-1 12-6"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
  filter: '<path d="M3 7h18M6 12h12m-9 5h6"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a8.6 8.6 0 1 0 11 11Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  flow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v4a5 5 0 0 0 5 5h4"/>',
  scan: '<path d="M3 8V4h4m10 0h4v4m0 8v4h-4M7 20H3v-4m0-4h18"/>',
  settings:
    '<path d="M3 7h5m5 0h8M3 17h10m5 0h3"/><circle cx="10" cy="7" r="2.5"/><circle cx="15" cy="17" r="2.5"/>',
  list: '<path d="m3 7 2 2 3-4m3 2h10M3 16l2 2 3-4m3 2h10"/>',
  repo: '<rect x="4" y="3" width="15" height="18" rx="2"/><path d="M7 17h12M8 3v6l2-1 2 1V3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  alert: '<path d="m12 3 10 17H2zM12 9v4m0 3h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  arrow: '<path d="M6 18 18 6M7 6h11v11"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5"/>',
  device:
    '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',
  refresh: '<path d="M20 9a8 8 0 1 0 0 7m0-12v5h-5"/>'
};
function I(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}
const logo =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiB2aWV3Qm94PSIwIDAgMjU2IDI1NiIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJGbGl3cmlnaHQgY2hhbWVsZW9uIj48ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibG9nby1jcmVzdCIgeDE9Ijk2IiB5MT0iNjQiIHgyPSIxNjciIHkyPSIxNiIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIHN0b3AtY29sb3I9IiMzNkQ5OEEiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNCN0YzNEEiLz48L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsb2dvLWJvZHkiIHgxPSIzNyIgeTE9IjIwMiIgeDI9IjIxMCIgeTI9IjYwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agc3RvcC1jb2xvcj0iIzAwOUZGMCIvPjxzdG9wIG9mZnNldD0iLjM4IiBzdG9wLWNvbG9yPSIjMDBDOUQ4Ii8+PHN0b3Agb2Zmc2V0PSIuNyIgc3RvcC1jb2xvcj0iIzM2RDk4QSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0I3RjM0QSIvPjwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxvZ28tZm9sZCIgeDE9IjUzIiB5MT0iMTY3IiB4Mj0iMTM0IiB5Mj0iODkiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjMDBDOUQ4Ii8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDBCRkE2Ii8+PC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibG9nby10YWlsIiB4MT0iMTA1IiB5MT0iMjExIiB4Mj0iMTQzIiB5Mj0iMTU4IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agc3RvcC1jb2xvcj0iIzAwQkZBNiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0I3RjM0QSIvPjwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxwYXRoIGQ9Ik04MCA2NEM4MyAyMCAxMjIgNiAxNTAgMTZDMTc3IDI0IDE5OSA0MiAyMTEgNjhDMTcwIDg3IDEyNiA4MyA4MCA4MFoiIGZpbGw9InVybCgjbG9nby1jcmVzdCkiLz4KICA8cGF0aCBkPSJNMTI3IDU4QzcwIDMzIDE2IDc1IDE2IDEzOUMxNiAyMDIgNTUgMjQxIDEwMyAyNDFDMTQ0IDI0MSAxNjYgMjE3IDE2NCAxODhDMTYyIDE2MCAxNDIgMTQ4IDEyMyAxNTRDMTA1IDE1OSA5OCAxNzcgMTA0IDE5MEMxMDggMTk5IDExOSAyMDEgMTI3IDE5NkMxMTIgMTk5IDEwNiAxODggMTEyIDE3OUMxMjEgMTY1IDE0MiAxNzUgMTM4IDE5NEMxMzMgMjIwIDk0IDIyMiA3NyAyMDBDNTYgMTczIDY2IDEzOSA5NSAxMzNDMTIzIDEyNyAxMzkgMTUxIDE3MyAxNTVDMjEzIDE2MCAyNDQgMTQwIDI0NCAxMTNDMjQ0IDk0IDIyNSA3MCAyMDQgNjBDMTc5IDQ5IDE0OSA0OCAxMjcgNThaIiBmaWxsPSJ1cmwoI2xvZ28tYm9keSkiLz4KICA8cGF0aCBkPSJNMTI3IDU4Qzg3IDU0IDQ3IDgxIDM5IDEyMUMyOSAxNjkgNTUgMjExIDkxIDIyMEM2MyAyMDIgNjAgMTcwIDc4IDE0OEM5NiAxMjYgMTIxIDEyOCAxNDMgMTQ0QzEyMiAxMjYgMTEzIDEwNCAxMjcgNThaIiBmaWxsPSJ1cmwoI2xvZ28tZm9sZCkiIG9wYWNpdHk9Ii43MiIvPjxwYXRoIGQ9Ik0xMjMgMTU0QzEwNSAxNTkgOTggMTc3IDEwNCAxOTBDMTA4IDE5OSAxMTkgMjAxIDEyNyAxOTZDMTEyIDE5OSAxMDYgMTg4IDExMiAxNzlDMTIxIDE2NSAxNDIgMTc1IDEzOCAxOTRDMTM1IDIwOSAxMjMgMjE1IDExMCAyMTZDMTQ0IDIxOSAxNjUgMjAwIDE1OCAxNzhDMTUzIDE1OSAxMzcgMTUwIDEyMyAxNTRaIiBmaWxsPSJ1cmwoI2xvZ28tdGFpbCkiLz4KICA8Y2lyY2xlIGN4PSIxOTQiIGN5PSI5OSIgcj0iMzIiIGZpbGw9IiNGRkZGRkYiLz48Y2lyY2xlIGN4PSIyMDUiIGN5PSI5OSIgcj0iMjAiIGZpbGw9IiMxNDJENEUiLz48Y2lyY2xlIGN4PSIyMTIiIGN5PSI4OSIgcj0iNiIgZmlsbD0iI0ZGRkZGRiIvPjwvc3ZnPgo=';
const suites = { smoke: '冒烟测试', checkout: '交易流程', account: '账户管理' };
const suiteIcons = { smoke: 'play', checkout: 'layers', account: 'list' };
const caseNames = [
  ['home', 'smoke', '启动后展示首页行情', 'home'],
  ['login', 'smoke', '登录后恢复上次访问页面', 'session'],
  ['locale', 'smoke', '切换语言后保留首页状态', 'locale'],
  ['order', 'checkout', '提交订单后显示确认页', 'confirm'],
  ['quote', 'checkout', '报价更新后重新计算金额', 'quote'],
  ['cancel', 'checkout', '撤单后恢复可用余额', 'cancel'],
  ['assets', 'account', '从资产列表进入币种详情', 'assets'],
  ['private', 'account', '隐藏余额后金额脱敏', 'privacy'],
  ['filter', 'account', '返回列表后保留币种筛选', 'filter']
];
function buildFixtures() {
  const projects = [
    ['exio', 'Exio App', 'mobile/exio_app', 'main', 'fjord', '8fc62d1'],
    ['merchant', 'Exio App', 'merchant/exio_app', 'release', 'dusk', 'da751ce'],
    ['wali', 'Wali App', 'wallet/wali_app', 'main', 'coast', '19fa2b8'],
    ['sample', 'Flutter Demo', 'qa/flutter_demo', 'main', 'ember', '']
  ].map(([id, name, repo, branch, art, sha], ix) => ({
    id,
    name,
    repo,
    branch,
    art,
    ready: !!sha,
    auto: ix < 2,
    scans: sha
      ? [
          { sha, state: 'ready' },
          { sha: '36dcf9b', state: 'ready' }
        ]
      : [],
    scenarios: sha ? ['已登录账户', '访客首页'] : [],
    cases: sha
      ? caseNames.map(([cid, suite, title, file]) => ({
          id: cid,
          suite,
          title:
            id === 'merchant'
              ? ({
                  home: '打开商户首页查看营业额',
                  order: '提交退款后显示确认页',
                  assets: '账单详情显示结算金额'
                }[cid] ?? title)
              : id === 'wali' && cid === 'home'
                ? '启动后显示钱包首页'
                : title,
          file: `${suite}/${file}.test.ts`
        }))
      : []
  }));
  const seeds = [
    ['exio', 'quote', 'queued'],
    ['merchant', 'home', 'queued'],
    ['wali', 'cancel', 'queued'],
    ['exio', 'assets', 'running', 'failed'],
    ['merchant', 'order', 'preparing'],
    ['wali', 'private', 'finalizing', 'passed'],
    ['merchant', 'login', 'completed', 'passed'],
    ['exio', 'home', 'completed', 'passed'],
    ['wali', 'filter', 'completed', 'passed'],
    ['exio', 'order', 'completed', 'failed'],
    ['merchant', 'quote', 'infrastructure_failed'],
    ['exio', 'login', 'completed', 'passed'],
    ['exio', 'order', 'completed', 'passed'],
    ['wali', 'home', 'cancelled'],
    ['merchant', 'assets', 'completed', 'skipped']
  ];
  const runs = seeds.map(([pid, cid, state, verdict], i) => {
    const p = projects.find((v) => v.id === pid),
      c = p.cases.find((v) => v.id === cid);
    return {
      id: (0x8d1f26c8 - i).toString(16),
      pid,
      cid,
      title: c.title,
      suite: c.suite,
      sha: p.scans[0].sha,
      branch: p.branch,
      state,
      verdict,
      report: state === 'completed' && ['passed', 'failed'].includes(verdict),
      time: `10:${String(48 - i).padStart(2, '0')}`,
      actor: ['Lin', 'Mia', 'Chen'][i % 3],
      scenario: '直接运行',
      position: i === 0 ? 2 : i === 1 ? 1 : 3
    };
  });
  return { projects, runs, role: 'admin', empty: false, seq: 100 };
}
const storageKey = 'fliwright-board-prototype-v2';
let model;
try {
  model = JSON.parse(sessionStorage.getItem(storageKey));
} catch {}
model ??= buildFixtures();
// Older example runs also appear in tabs that already have saved demo data.
const completedExamples = model.runs.filter((r) => r.report && !r.created);
const sampleHistory = Array.from({ length: completedExamples.length * 12 }, (_, i) => {
  const minutes = 10 * 60 + 30 - i;
  return {
    ...completedExamples[i % completedExamples.length],
    id: (0x8d1f2600 - i).toString(16),
    time: `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
  };
});
function save() {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(model));
  } catch {}
}
function projects() {
  return model.projects.filter((p) =>
    model.empty ? !!p.emptyTeam : !p.emptyTeam
  );
}
function project(id) {
  return projects().find((p) => p.id === id);
}
function requests() {
  return model.runs.concat(sampleHistory).filter((r) => !!project(r.pid));
}
function canScan() {
  return ['admin', 'operator'].includes(model.role);
}
const tabs = {
  tests: ['测试用例', 'list'],
  scenarios: ['运行场景', 'flow'],
  runs: ['运行记录', 'clock'],
  scans: ['扫描记录', 'scan'],
  settings: ['项目设置', 'settings']
};
const stages = {
  queued: '等待设备',
  assigned: '已分配设备',
  preparing: '准备环境',
  running: '执行测试',
  finalizing: '收集报告',
  cancel_requested: '正在取消',
  passed: '测试通过',
  failed: '测试失败',
  infrastructure_failed: '执行异常',
  cancelled: '已取消',
  skipped: '已跳过',
  unknown: '待定',
  none: '未运行',
  ready: '扫描完成'
};
const columns = [
  ['pending', '待测试', 'clock'],
  ['run', '测试中', 'play'],
  ['pass', '已成功', 'check'],
  ['fail', '已失败', 'x'],
  ['other', '其他结果', 'pause']
];
function group(r) {
  if (r.state === 'queued') return 'pending';
  if (
    [
      'assigned',
      'preparing',
      'running',
      'finalizing',
      'cancel_requested'
    ].includes(r.state)
  )
    return 'run';
  if (r.state === 'infrastructure_failed') return 'fail';
  if (r.state === 'completed')
    return { passed: 'pass', failed: 'fail' }[r.verdict] || 'other';
  return 'other';
}
function glyph(tone, icon) {
  return ['pass', 'fail'].includes(tone)
    ? `<i class="glyph ${tone}">${I(icon)}</i>`
    : I(icon);
}
function status(r, position = false) {
  const tone = r ? group(r) : 'other',
    stage = r ? (r.state === 'completed' ? r.verdict : r.state) : 'none';
  const label =
    position && stage === 'queued'
      ? `排队第 ${r.position} 位`
      : stages[stage] || stage;
  const icon =
    r?.state === 'infrastructure_failed'
      ? 'alert'
      : columns.find((c) => c[0] === tone)[2];
  return `<span class="tag ${tone}">${glyph(tone, icon)}${E(label)}</span>`;
}
const hash = () => location.hash.slice(1) || '/queue';
function parse(route) {
  const [path, s = ''] = route.split('?');
  return {
    path,
    parts: path.split('/').filter(Boolean),
    q: new URLSearchParams(s)
  };
}
function url(path, fields = {}) {
  const qs = new URLSearchParams(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== '')
  );
  return path + (qs.size ? '?' + qs : '');
}
function projectUrl(id, view = 'tests') {
  return url('/projects/' + id, { view: view === 'tests' ? '' : view });
}
function A(path, text, cls = '', current = false, attrs = '') {
  return `<a class="${cls}" href="#${E(path)}" ${current ? 'aria-current="page"' : ''} ${attrs}>${text}</a>`;
}
function B(text, action, icon, cls = 'btn') {
  return `<button type="button" class="${cls}" data-action="${E(action)}">${icon ? I(icon) : ''}${E(text)}</button>`;
}
function iconButton(label, action, icon) {
  return `<button type="button" class="icon-button" aria-label="${label}" title="${label}" data-action="${action}">${I(icon)}</button>`;
}
function art(p) {
  return `background-image:url('${landscapes.cover(p.art)}')`;
}
function thumb(p) {
  return `<span class="thumb" style="${art(p)}"></span>`;
}
function facts(items) {
  return `<dl class="facts">${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}
function option(v, label, sel) {
  return `<option value="${E(v)}" ${sel === v ? 'selected' : ''}>${E(label)}</option>`;
}
function fieldSelect(id, label, options, selected, icon = 'filter') {
  return `<label class="ctl">${I(icon)}<select id="${id}" aria-label="${label}">${options.map(([v, n]) => option(v, n, selected)).join('')}</select></label>`;
}
function inputSearch(id, placeholder, value = '', local = false) {
  return `<label class="${local ? 'local-search' : 'board-search'}">${I('search')}<input id="${id}" type="search" aria-label="${placeholder}" placeholder="${placeholder}" value="${E(value)}"></label>`;
}
function notFound() {
  return `<main class="page-inner" id="content"><h1>页面不存在</h1>${A('/projects', '返回项目目录', 'btn')}</main>`;
}
function empty(title, text = '', action = '') {
  return `<div class="empty"><h3>${E(title)}</h3>${text ? `<p class="quiet">${E(text)}</p>` : ''}${action}</div>`;
}
function header(section) {
  return `<header class="top"><a class="brand" href="#/queue"><img src="${logo}" alt="">Fliwright <b>Cloud</b></a><span class="divider"></span><nav class="topnav" aria-label="团队导航">${[
    ['queue', '执行看板', '看板', 'board'],
    ['projects', '项目', '项目', 'grid'],
    ['reports', '测试报告', '报告', 'report']
  ]
    .map(([id, n, short, icon]) =>
      A(
        '/' + id,
        `${I(icon)}<span class="full">${n}</span><span class="short">${short}</span>`,
        'toplink',
        section === id,
        `aria-label="${n}"`
      )
    )
    .join(
      ''
    )}${B('更多', 'more', 'down', 'toplink')}</nav><div class="topright"><span class="proto">交互草图</span>${iconButton(document.documentElement.dataset.theme === 'dark' ? '切换浅色主题' : '切换深色主题', 'theme', document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}<button class="avatar" aria-label="演示身份与数据" title="演示身份与数据" data-action="profile">LH</button></div></header>`;
}
const laneBatchSize = 8;
let queueObserver;
function requestLink(r, origin) {
  return url('/requests/' + r.id, { from: origin });
}
function ticket(r, origin) {
  const p = project(r.pid);
  return A(
    requestLink(r, origin),
    `<div class="meta-row"><span class="source-label ${p.art}">${E(p.name)} · ${E(r.suite)}</span><code>#${E(r.id)}</code></div><h3>${E(r.title)}</h3><div class="origin">${I('repo')}${E(p.repo)}</div><div class="card-foot">${status(r, true)}<span class="ref">${I('branch')}${E(r.branch)} · ${E(r.sha)}</span></div>`,
    'ticket',
    false,
    `data-request="${r.id}"`
  );
}
function titleArea(crumb, title, icon, action = '', tools = '', trailing = '') {
  return `<header class="board-head"><div class="crumb">${crumb}</div><div class="titleline"><div class="titles"><span class="heading-icon">${I(icon)}</span><h1>${E(title)}</h1></div>${action}</div><div class="board-tools"><div class="tools">${tools}</div>${trailing}</div></header>`;
}
function groupBoardRequests(q) {
  const search = (q.get('q') || '').trim().toLowerCase();
  const pid = q.get('app');
  const lanes = new Map(columns.map(([key]) => [key, []]));
  for (const run of requests()) {
    if (pid && run.pid !== pid) continue;
    if (search && ![run.sha, run.branch, run.id].some(value => value.toLowerCase().includes(search))) continue;
    lanes.get(group(run)).push(run);
  }
  lanes.get('pending').sort((a, b) => a.position - b.position);
  return lanes;
}
function board(route, q, lanes) {
  const activeCount = Number(Boolean(q.get('q'))) + Number(Boolean(q.get('app')));
  const loaded = positions.get(route)?.loadedCounts || {};
  const toolbar = `<header class="queue-toolbar"><h1>执行看板</h1><div class="queue-actions"><button type="button" class="btn queue-filter" id="queue-filter" aria-haspopup="dialog" aria-controls="overlay" data-action="board-filters">${I('filter')}筛选${activeCount ? `<span class="filter-count" aria-label="${activeCount} 个已启用条件">${activeCount}</span>` : ''}</button>${B('提交测试', 'submit', 'plus', 'btn primary')}</div></header>`;
  return `<main class="scene" id="content">${toolbar}<div class="deck" tabindex="0" aria-label="团队执行看板列">${columns
    .map(([key, label, icon]) => {
      const cards = lanes.get(key);
      if (key === 'other' && !cards.length) return '';
      const visible = cards.slice(0, Math.max(laneBatchSize, loaded[key] || 0));
      return `<section class="lane" data-column="${key}"><div class="column-title"><span class="state-icon">${glyph(key, icon)}</span><h2>${label}</h2><span class="count" aria-label="共 ${cards.length} 条">${cards.length}</span></div><div class="lane-list" tabindex="0" role="region" aria-label="${label}任务">${visible.map((r) => ticket(r, route)).join('') || '<p class="empty-line">暂无任务</p>'}</div></section>`;
    })
    .join(
      ''
    )}</div></main>`;
}
function observeBoardLanes(route, lanes) {
  // The last visible batch ends in a real card, so underfilled viewports load too.
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting || !target.isConnected) continue;
      const list = target.parentElement;
      if (target !== list.lastElementChild) continue;
      observer.unobserve(target);
      const cards = lanes.get(list.parentElement.dataset.column);
      const start = list.childElementCount;
      const batch = cards.slice(start, start + laneBatchSize);
      list.insertAdjacentHTML('beforeend', batch.map(r => ticket(r, route)).join(''));
      if (list.childElementCount < cards.length) observer.observe(list.lastElementChild);
    }
  });
  for (const list of app.querySelectorAll('[data-column] .lane-list')) {
    if (list.childElementCount < lanes.get(list.parentElement.dataset.column).length) {
      observer.observe(list.lastElementChild);
    }
  }
  return observer;
}
function openBoardFilters() {
  const { q } = parse(hash());
  const selected = q.get('app') || '';
  const options =
    option('', '全部应用', selected) +
    projects()
      .map((p) => option(p.id, p.name + ' · ' + p.repo, selected))
      .join('');
  openDialog(
    'board-filters',
    '筛选执行看板',
    `<form id="board-filter-form"><label class="field">搜索提交、分支或任务 ID<input type="search" id="board-query" placeholder="例如 main" value="${E(q.get('q') || '')}"></label><label class="field">应用<select id="board-project">${options}</select></label><div class="form-foot">${B('清除筛选', 'reset-board', null, 'bare')}<button class="btn primary">完成</button></div></form>`,
    { focus: '#board-query' }
  );
  modal.classList.add('queue-filter-panel');
  positionBoardFilters();
}
function positionBoardFilters() {
  if (dialogType !== 'board-filters') return;
  const rect = document.getElementById('queue-filter').getBoundingClientRect();
  modal.style.setProperty('--filter-top', `${rect.bottom + 6}px`);
  modal.style.setProperty(
    '--filter-right',
    `${Math.min(window.innerWidth - rect.right, window.innerWidth - modal.offsetWidth - 8)}px`
  );
}
window.addEventListener('resize', positionBoardFilters);
function directory(q) {
  const query = q.get('q') || '',
    list = projects().filter((p) =>
      (p.name + ' ' + p.repo + ' ' + p.branch)
        .toLowerCase()
        .includes(query.toLowerCase().trim())
    );
  return `<main class="page-body" id="content"><div class="page-inner"><div class="trail">${I('layers')} 团队空间 ${I('next')} 项目</div><div class="titleline"><div><h1>项目</h1><p class="subtitle">${projects().length} 个项目</p></div>${model.role === 'admin' ? B('创建项目', 'create', 'plus', 'btn primary') : ''}</div><div class="section-head">${inputSearch('directory-query', '搜索项目名或仓库', query, true)}${query ? B('清除筛选', 'clear-dir', null, 'bare') : ''}</div>${list.length ? `<section class="tiles" aria-label="项目目录">${list.map((p) => A(projectUrl(p.id), `<div class="cover" style="${art(p)}"></div><div class="tile-content"><h2>${E(p.name)}</h2><code>${E(p.repo)}</code><div class="row"><span class="ref">${I('branch')}${E(p.branch)}</span><span class="tiny">${p.scans.some((s) => s.state === 'ready') ? p.cases.length + ' 个用例' : '尚未扫描'}</span></div></div>`, 'tile')).join('')}</section>` : empty(query ? '没有匹配的项目' : '连接第一个仓库', query ? '试试仓库路径或其他项目名。' : model.role === 'admin' ? '选择「创建项目」连接仓库。' : '请联系管理员创建项目。')}</div></main>`;
}
function rail(p, view) {
  return `<aside class="rail">${A('/projects', I('back') + '所有项目', 'backlink')}<button class="identity" data-action="switch" aria-label="切换项目，${E(p.name)}，${E(p.repo)}" aria-haspopup="dialog">${thumb(p)}<span><strong>${E(p.name)}</strong><small class="tiny">${E(p.repo)}</small></span><span class="chev">${I('down')}</span></button><nav class="railnav" aria-label="项目分区">${Object.entries(
    tabs
  )
    .map(([key, [title, icon]]) =>
      A(projectUrl(p.id, key), I(icon) + title, '', view === key)
    )
    .join('')}</nav></aside>`;
}
function scanVersion(p, q) {
  const ready = p.scans.filter((s) => s.state === 'ready');
  return ready.find((s) => s.sha === q.get('v'))?.sha || ready[0]?.sha || '';
}
function casesAt(p, sha) {
  if (!p.scans.some((s) => s.state === 'ready' && s.sha === sha)) return [];
  return sha === '36dcf9b' ? p.cases.slice(0, 5) : p.cases;
}
function caseBoard(p, q, route) {
  const sha = scanVersion(p, q),
    data = casesAt(p, sha),
    query = q.get('q') || '',
    match = data.filter((c) =>
      (c.title + ' ' + c.file + ' ' + c.suite)
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    );
  const tools =
    inputSearch('case-query', '搜索当前版本的用例', query) +
    fieldSelect(
      'version',
      '扫描版本',
      p.scans.filter((s) => s.state === 'ready').map((s) => [s.sha, s.sha]),
      sha,
      'branch'
    ) +
    (query ? B('清除筛选', 'clear-cases', null, 'clear') : '');
  const backdrop = landscapes.cover(
    p.art,
    true,
    document.documentElement.dataset.theme === 'dark'
  );
  return `<main class="scene" style="--landscape:url('${backdrop}')" id="content">${titleArea(`团队项目 ${I('next')} ${E(p.repo)}`, p.name + ' · 测试用例', 'list', '', sha ? tools : '', sha ? `<span class="live">${data.length} 个用例 · ${new Set(data.map((c) => c.suite)).size} 个套件</span>` : '')}<div class="deck" tabindex="0" aria-label="用例套件列">${
    !sha
      ? empty(
          p.scans.some((s) => s.state === 'queued')
            ? '正在生成测试目录'
            : '尚无测试目录',
          p.scans.some((s) => s.state === 'queued')
            ? '扫描完成后会显示用例。'
            : canScan()
              ? '扫描默认分支，发现仓库里的套件和用例。'
              : '请联系管理员或运维扫描仓库。',
          p.scans.some((s) => s.state === 'queued')
            ? A(projectUrl(p.id, 'scans'), '查看扫描进度', 'btn')
            : canScan()
              ? B('首次扫描', 'scan', 'scan', 'btn primary')
              : ''
        )
      : Object.entries(suites)
          .filter(([id]) => data.some((c) => c.suite === id))
          .map(([id, label]) => {
            const rows = match.filter((c) => c.suite === id);
            return `<section class="lane" data-suite="${id}"><div class="column-title">${I(suiteIcons[id])}<h2>${label}</h2><code class="tiny">${id}</code><span class="count">${rows.length}</span></div><div class="lane-list">${
              rows
                .map((c) => {
                  const recent = requests().find(
                    (r) => r.pid === p.id && r.cid === c.id && r.sha === sha
                  );
                  return A(
                    url('/case/' + p.id + '/' + c.id, { v: sha, from: route }),
                    `<h3>${E(c.title)}</h3><code>${E(c.file)}</code><div class="case-bottom">${status(recent)}${recent ? `<span class="ref" title="最近提交">${I('clock')} ${E(recent.time)}</span>` : ''}</div>`,
                    'case-tile'
                  );
                })
                .join('') || '<p class="empty-line">没有匹配的用例</p>'
            }</div>${p.ready ? B('运行套件', 'suite:' + id, 'play', 'lane-action') : ''}</section>`;
          })
          .join('')
  }</div>${sha && !p.ready ? `<footer class="board-bottom">项目等待就绪确认 ${A(projectUrl(p.id, 'settings'), '检查项目设置')}</footer>` : ''}</main>`;
}
function recordList(runs, origin) {
  return runs.length
    ? `<div class="records">${runs.map((r) => A(requestLink(r, origin), `<div><strong>${E(r.title)}</strong><small>${E(project(r.pid).repo)} · ${E(r.sha)} · #${r.id}</small></div>${status(r)}${I('next')}`, 'record', false, `data-request="${r.id}"`)).join('')}</div>`
    : empty('暂无运行记录');
}
function projectPage(id, view, q, route) {
  const p = project(id);
  if (!p || !tabs[view]) return notFound();
  let body = '';
  if (view === 'tests') body = caseBoard(p, q, route);
  else {
    const projectRuns = requests().filter((r) => r.pid === p.id),
      state = q.get('state') || '',
      pending = p.scans.some((s) => s.state === 'queued');
    let details = '',
      action = '';
    if (view === 'runs')
      details =
        `<div class="project-tools"><select class="select" id="run-state" aria-label="筛选运行状态">${[['', '全部状态'], ...columns.map(([k, n]) => [k, n])].map(([k, n]) => option(k, n, state)).join('')}</select></div>` +
        recordList(
          projectRuns.filter((r) => !state || group(r) === state),
          route
        );
    if (view === 'scans') {
      if (canScan() && !pending)
        action = B('扫描仓库', 'scan', 'scan', 'btn primary');
      details = p.scans.length
        ? p.scans
            .map(
              (s) =>
                `<div class="record">${I('scan')}<div><strong>${E(p.branch)}</strong><small>${E(s.sha)}</small></div><span class="tag">${s.state === 'queued' ? '等待扫描' : E(stages[s.state])}</span>${s.state === 'queued' && canScan() ? B('取消扫描', 'cancel-scan', null, 'bare') : ''}</div>`
            )
            .join('')
        : empty(
            '还没有扫描记录',
            canScan()
              ? '可从默认分支发起首次扫描。'
              : '请联系管理员或运维发起扫描。'
          );
    }
    if (view === 'scenarios')
      details = p.scenarios.length
        ? p.scenarios
            .map(
              (s) =>
                `<div class="record">${I('flow')}<div><strong>${E(s)}</strong><small>仓库运行场景</small></div></div>`
            )
            .join('')
        : empty('尚无运行场景', '用例支持直接运行。');
    if (view === 'settings') {
      details = `<section class="panel"><h2>仓库与运行配置</h2>${facts([
        ['仓库', E(p.repo)],
        ['默认分支', E(p.branch)],
        ['Push 自动运行', p.auto ? '已启用' : '已关闭'],
        [
          '项目状态',
          p.ready
            ? '已就绪'
            : p.scans.some((s) => s.state === 'ready')
              ? '目录已生成，等待确认'
              : '待扫描'
        ]
      ])}${model.role === 'admin' && !p.ready && p.scans.some((s) => s.state === 'ready') ? B('确认就绪', 'ready', 'check', 'btn primary') : ''}</section>`;
    }
    body = `<main class="workarea" id="content"><header class="normal-head"><div class="trail">${E(p.name)} ${I('next')} ${E(p.repo)}</div><div class="titleline"><h1>${tabs[view][0]}</h1>${action}</div></header><div class="work-body">${details}</div></main>`;
  }
  return `<div class="workspace">${rail(p, view)}${body}</div>`;
}
function teamPage(id, route) {
  let label = '',
    body = '';
  if (id === 'reports') {
    label = '测试报告';
    body = recordList(
      requests().filter((r) => r.report),
      route
    );
  } else if (id === 'overview') {
    label = '运行概览';
    body =
      `<div class="metrics">${columns
        .slice(0, 4)
        .map(
          ([k, n]) =>
            `<div class="panel"><small>${n}</small><strong>${requests().filter((r) => group(r) === k).length}</strong></div>`
        )
        .join('')}</div><h2 class="section-head">最近运行</h2>` +
      recordList(requests().slice(0, 4), route);
  } else if (id === 'resources') {
    label = '执行资源';
    body = `<div class="panel"><h2>设备与 Worker 主机</h2>${facts([
      ['Worker 主机', 'Mac mini · 在线'],
      ['设备', 'iPhone 16 · iOS 模拟器'],
      ['槽位', '2']
    ])}</div>`;
  } else return notFound();
  return `<main class="page-body" id="content"><div class="page-inner"><div class="trail">团队空间 ${I('next')} ${label}</div><h1>${label}</h1><div class="section-head"></div>${body}</div></main>`;
}
function ctx() {
  const r = parse(hash());
  if (!['case', 'requests'].includes(r.parts[0])) return hash();
  const from = r.q.get('from');
  return from && /^\/(queue|projects|reports|overview)(\/|\?|$)/.test(from)
    ? from
    : r.parts[0] === 'case'
      ? projectUrl(r.parts[1])
      : '/queue';
}
const positions = new Map();
let activeRoute = '',
  dialogType = '',
  dialogTrigger = null,
  choice = 0,
  choiceProjects = [],
  lastProject = 'exio';
function remember(route) {
  if (!route) return;
  const deck = app.querySelector('.deck'),
    scroll = app.querySelector('.workarea,.page-body');
  positions.set(route, {
    left: deck?.scrollLeft || 0,
    top: scroll?.scrollTop || 0,
    laneOffsets: Array.from(app.querySelectorAll('.lane-list'), (el) => el.scrollTop),
    loadedCounts: Object.fromEntries(Array.from(app.querySelectorAll('[data-column] .lane-list'),
      list => [list.parentElement.dataset.column, list.childElementCount]))
  });
}
function restore(route) {
  const pos = positions.get(route);
  if (!pos) return;
  const deck = app.querySelector('.deck'),
    scroll = app.querySelector('.workarea,.page-body');
  if (deck) deck.scrollLeft = pos.left;
  if (scroll) scroll.scrollTop = pos.top;
  app
    .querySelectorAll('.lane-list')
    .forEach((el, i) => (el.scrollTop = pos.laneOffsets[i] || 0));
}
function setTheme(value) {
  document.documentElement.dataset.theme = value;
  document.documentElement.style.setProperty(
    '--landscape',
    `url('${landscapes.cover(value === 'dark' ? 'night' : 'day', true)}')`
  );
}
let preference = 'dark';
try {
  preference =
    localStorage.getItem('cloud-theme') === 'light' ? 'light' : 'dark';
} catch {}
setTheme(preference);
function render() {
  const route = hash(),
    r = parse(route),
    isDetail = ['requests', 'case'].includes(r.parts[0]),
    base = isDetail
      ? ctx() !== route
        ? ctx()
        : r.parts[0] === 'case'
          ? projectUrl(r.parts[1])
          : '/queue'
      : route;
  if (activeRoute !== base) {
    remember(activeRoute);
    activeRoute = base;
  } else remember(base);
  const b = parse(base),
    [area, id, oldView] = b.parts;
  const view = b.q.get('view') || oldView || 'tests';
  if (area === 'projects' && project(id)) lastProject = id;
  queueObserver?.disconnect();
  const lanes = area === 'queue' ? groupBoardRequests(b.q) : null;
  const body =
    area === 'queue'
      ? board(base, b.q, lanes)
      : area === 'projects'
        ? id
          ? projectPage(id, view, b.q, base)
          : directory(b.q)
        : teamPage(area, base);
  app.innerHTML = header(area) + body;
  restore(base);
  if (lanes) queueObserver = observeBoardLanes(base, lanes);
  document.title =
    (app.querySelector('h1')?.textContent || '云测') + ' · Fliwright Cloud';
  if (isDetail) {
    if (r.parts[0] === 'requests') {
      const run = requests().find((x) => x.id === r.parts[1]);
      if (run) showRequest(run);
      else missingCard();
    } else {
      const p = project(r.parts[1]),
        sha = r.q.get('v') || p?.scans.find((s) => s.state === 'ready')?.sha,
        c = p && casesAt(p, sha).find((c) => c.id === r.parts[2]);
      if (c) showCase(p, c, sha);
      else missingCard();
    }
  } else if (dialogType === 'route') dismiss();
}
function go(route) {
  if (route === hash()) render();
  else location.hash = route;
}
function patch(fields) {
  const r = parse(hash());
  for (const [key, val] of Object.entries(fields)) {
    if (!val) r.q.delete(key);
    else r.q.set(key, val);
  }
  const route = r.path + (r.q.size ? '?' + r.q : '');
  history.replaceState(history.state, '', '#' + route);
  render();
}
function notice(text) {
  document.getElementById('notice').textContent = text;
  setTimeout(() => {
    if (document.getElementById('notice').textContent === text)
      document.getElementById('notice').textContent = '';
  }, 2200);
}
function openDialog(
  type,
  title,
  body,
  { artProject = null, eyebrow = '', wide = false, focus = null } = {}
) {
  if (!modal.open) dialogTrigger = document.activeElement;
  dialogType = type;
  modal.className = wide ? 'card-dialog' : '';
  modal.innerHTML =
    (artProject
      ? `<div class="dialog-cover" style="${art(artProject)}"></div>`
      : '') +
    `<div class="dialog-body"><div class="dialog-head"><div>${eyebrow ? `<div class="trail">${eyebrow}</div>` : ''}<h2 id="dialog-title">${E(title)}</h2></div>${iconButton('关闭', 'close', 'x')}</div>${body}</div>`;
  if (!modal.open) modal.showModal();
  if (focus) modal.querySelector(focus)?.focus();
}
function dismiss() {
  const previous = dialogTrigger;
  dialogType = '';
  if (modal.open) modal.close();
  if (previous?.isConnected) previous.focus();
  dialogTrigger = null;
}
function returnFromCard() {
  const from = ctx();
  if (history.state?.source === from) history.back();
  else {
    history.replaceState(null, '', '#' + from);
    render();
  }
}
function closeDialog() {
  if (dialogType === 'board-filters') {
    dismiss();
    document.getElementById('queue-filter')?.focus({ preventScroll: true });
    return;
  }
  if (dialogType === 'route') returnFromCard();
  else {
    dismiss();
    if (isCardRoute()) render();
  }
}
function missingCard() {
  openDialog('route', '卡片不存在', A('/queue', '返回执行看板', 'btn'));
}
function showRequest(r) {
  const p = project(r.pid),
    failed = r.state === 'completed' && r.verdict === 'failed';
  const where = `${E(p.name)} · ${E(p.repo)} ${I('next')} #${E(r.id)}`;
  let evidence = '';
  if (r.report) {
    evidence = `<div class="section-head"><h3>测试步骤</h3>${failed ? B('跳到失败步骤', 'evidence', 'arrow', 'bare') : ''}</div><ol class="steps"><li>${glyph('pass', 'check')} 准备运行环境</li><li>${glyph('pass', 'check')} 执行测试操作</li><li>${glyph(failed ? 'fail' : 'pass', failed ? 'x' : 'check')} ${failed ? '页面断言失败' : '页面断言通过'}</li></ol>${failed ? `<details class="evidence" id="evidence"><summary>步骤 3 · 失败证据</summary><p class="form-note">确认页未按预期显示</p><pre>expect(确认页标题).toBeVisible()\n等待 5000 ms 后超时\ncheckout/confirm.test.ts</pre></details>` : ''}`;
  } else
    evidence = `<div class="evidence"><h3>任务动态</h3><ol class="steps"><li>${I('clock')} ${r.time} · 请求已提交</li><li>${I(r.state === 'infrastructure_failed' ? 'alert' : 'clock')} ${r.state === 'infrastructure_failed' ? 'Worker 心跳中断，未生成报告' : E(stages[r.state] || r.verdict || '等待调度')}</li></ol></div>`;
  openDialog(
    'route',
    r.title,
    `${status(r, true)}${facts([
      ['项目仓库', E(p.repo)],
      [
        '套件 / 版本',
        `<code>${E(r.suite)} · ${E(r.branch)} · ${E(r.sha)}</code>`
      ],
      ['发起人', E(r.actor) + ' · ' + E(r.time)],
      ['运行场景', E(r.scenario)]
    ])}${evidence}<div class="form-foot">${B('返回' + (parse(ctx()).parts[0] === 'queue' ? '看板' : '列表'), 'close', 'back')}</div>`,
    { artProject: p, wide: true, eyebrow: where }
  );
}
function showCase(p, c, sha) {
  const run = requests().find(
    (r) => r.pid === p.id && r.cid === c.id && r.sha === sha
  );
  const origin = ctx();
  openDialog(
    'route',
    c.title,
    `${status(run)}${facts([
      ['套件', E(c.suite)],
      ['测试文件', `<code>${E(c.file)}</code>`],
      ['扫描版本', `<code>${E(sha)}</code>`]
    ])}<div class="form-foot">${run ? A(requestLink(run, origin), '查看最近运行', 'btn') : ''}${p.ready ? B('运行用例', 'run-case:' + c.id, 'play', 'btn primary') : A(projectUrl(p.id, 'settings'), '检查项目设置', 'btn')}</div>`,
    {
      artProject: p,
      eyebrow: `${E(p.name)} · ${E(p.repo)} ${I('next')} 测试用例`,
      wide: true
    }
  );
}

function isCardRoute() {
  return ['requests', 'case'].includes(parse(hash()).parts[0]);
}
function currentProject() {
  return project(parse(ctx()).parts[1]);
}
function showSwitcher() {
  openDialog(
    'switch',
    '切换项目',
    `<label class="local-search pop-search">${I('search')}<input id="project-choice" placeholder="搜索项目名或仓库" role="combobox" aria-label="搜索项目名或仓库" aria-expanded="true" aria-autocomplete="list" aria-controls="choices" autocomplete="off"></label><div id="choices" role="listbox" aria-label="团队项目"></div><div class="form-foot">${A('/projects', '所有项目', 'btn')}</div>`,
    { focus: '#project-choice' }
  );
  drawChoices('');
}
function drawChoices(query, step = 0) {
  const active = currentProject()?.id;
  choiceProjects = projects().filter((p) =>
    [p.name, p.repo, p.branch]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );
  choice =
    step && choiceProjects.length
      ? (choice + step + choiceProjects.length) % choiceProjects.length
      : Math.max(
          0,
          choiceProjects.findIndex((p) => p.id === active)
        );
  document.getElementById('choices').innerHTML =
    choiceProjects
      .map(
        (p, index) =>
          `<button type="button" role="option" id="pick-${p.id}" aria-selected="${index === choice}" tabindex="-1" data-action="pick:${p.id}" class="switchrow" data-highlight="${index === choice}">${thumb(p)}<span><strong>${E(p.name)}</strong><code>${E(p.repo)}</code></span>${p.id === active ? '<span class="spacer" aria-label="当前项目">' + I('check') + '</span>' : ''}</button>`
      )
      .join('') || '<p class="empty-line">没有匹配的项目</p>';
  const input = document.getElementById('project-choice');
  if (choiceProjects[choice])
    input.setAttribute(
      'aria-activedescendant',
      'pick-' + choiceProjects[choice].id
    );
  else input.removeAttribute('aria-activedescendant');
}
function pickProject(pid) {
  if (!project(pid)) return;
  const current = currentProject()?.id;
  dismiss();
  if (pid !== current) go(projectUrl(pid));
}
function showProfile() {
  const roles = [
    ['admin', '管理员'],
    ['operator', '运维'],
    ['member', '普通成员']
  ];
  openDialog(
    'profile',
    '演示身份与数据',
    `<form id="profile-form"><label class="field">身份<select name="role">${roles.map(([id, n]) => option(id, n, model.role)).join('')}</select></label><label class="field">团队<select name="team">${option('demo', '示例团队', model.empty ? 'empty' : 'demo')}${option('empty', '新建团队', model.empty ? 'empty' : 'demo')}</select></label><div class="form-foot"><button class="btn primary">进入项目目录</button></div></form>`
  );
}
function createProject() {
  if (model.role !== 'admin') return;
  openDialog(
    'create',
    '创建项目',
    `<form id="create-form"><label class="field">项目名称<input name="name" required maxlength="64" autofocus></label><label class="field">仓库路径<input name="repo" placeholder="mobile/exio_app" required maxlength="140"></label><label class="field">默认分支<input name="branch" value="main" required maxlength="80"></label><p class="form-note">仓库及扫描数据仅保存在本标签页。</p><div class="form-foot"><button class="btn primary">创建项目</button></div></form>`,
    { focus: 'input' }
  );
}
let submission = null;
function configureRun(
  pid,
  { cid = '', suite = '', sha = '', global = false } = {}
) {
  const eligible = projects().filter(
    (p) => p.ready && p.scans.some((s) => s.state === 'ready') && p.cases.length
  );
  const p = eligible.find((p) => p.id === pid) || (global ? eligible[0] : null);
  if (!p) {
    openDialog(
      'confirm',
      '暂无可运行的项目',
      A('/projects', '打开项目目录', 'btn')
    );
    return;
  }
  sha = sha || scanVersion(p, new URLSearchParams());
  const catalog = casesAt(p, sha);
  if (!catalog.length) return;
  const c = cid ? catalog.find((item) => item.id === cid) : null;
  if (cid && !c) return;
  const suiteIds = [...new Set(catalog.map((item) => item.suite))];
  const activeSuite =
    c?.suite || (suiteIds.includes(suite) ? suite : suiteIds[0]);
  submission = { pid: p.id, cid: c?.id || '', sha, suite: activeSuite, global };
  const target = global
    ? `<label class="field">项目<select id="submit-project">${eligible.map((x) => option(x.id, x.name + ' · ' + x.repo, p.id)).join('')}</select></label><label class="field">运行套件<select name="suite">${suiteIds.map((id) => option(id, suites[id] + ' · ' + id, activeSuite)).join('')}</select></label>`
    : facts([
        ['项目', E(p.name) + ' · ' + E(p.repo)],
        ['套件', E(suites[activeSuite]) + ' · ' + E(activeSuite)],
        ...(c ? [['用例', E(c.title)]] : [])
      ]);
  openDialog(
    'confirm',
    c ? '运行用例' : global ? '提交测试' : '运行套件',
    `<form id="run-form">${target}${facts([['提交版本', `<code>${E(p.branch)} · ${E(sha)}</code>`]])}<label class="field">运行场景<select name="scenario">${['直接运行', ...p.scenarios].map((s) => option(s, s, '直接运行')).join('')}</select></label><div class="form-foot">${B('取消', 'close', null)}<button class="btn primary">${I('play')} 确认提交</button></div></form>`
  );
}
function submitRun(form) {
  if (!submission) return;
  const { pid, sha, cid, global } = submission,
    p = project(pid);
  if (!p?.ready) return;
  const data = new FormData(form),
    suite = data.get('suite') || submission.suite,
    cases = casesAt(p, sha).filter((c) => c.suite === suite);
  if (!cases.length) return;
  const now = Date.now(),
    id = (0xb58b0000 + ++model.seq).toString(16),
    c = cases.find((c) => c.id === cid);
  const queued = requests().filter((r) => r.state === 'queued');
  const position = Math.max(0, ...queued.map((r) => r.position)) + 1;
  model.runs.unshift({
    id,
    pid,
    cid,
    title: c?.title || suites[suite] + ' · 套件运行',
    suite,
    sha,
    branch: p.branch,
    state: 'queued',
    position,
    report: false,
    scenario: data.get('scenario'),
    actor: '我',
    time: new Date(now).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    created: now
  });
  save();
  dismiss();
  submission = null;
  go(global ? '/queue' : projectUrl(pid, 'runs'));
  notice('已提交测试 · #' + id);
}
function scanProject() {
  const p = currentProject();
  if (!canScan() || !p || p.scans.some((s) => s.state === 'queued')) return;
  p.scans.unshift({
    sha: (0xadd0000 + ++model.seq).toString(16),
    state: 'queued',
    created: Date.now()
  });
  save();
  go(projectUrl(p.id, 'scans'));
  notice('扫描已加入队列');
}
function advanceDemo() {
  const now = Date.now();
  let changed = false;
  for (const run of model.runs) {
    if (!run.created || run.state === 'completed') continue;
    const age = now - run.created,
      next = age >= 18000 ? 'completed' : age >= 7000 ? 'running' : 'queued';
    if (run.state === next) continue;
    Object.assign(run, {
      state: next,
      verdict: 'passed',
      report: next === 'completed'
    });
    changed = true;
  }
  for (const p of model.projects) {
    for (const scan of p.scans) {
      if (scan.state !== 'queued' || now - scan.created < 6000) continue;
      scan.state = 'ready';
      if (!p.cases.length) {
        const [id, suite, title, file] = caseNames[0];
        p.cases.push({ id, suite, title, file: `${suite}/${file}.test.ts` });
      }
      changed = true;
    }
  }
  if (changed) {
    for (const team of [true, false]) {
      const teamProjects = new Set(
        model.projects.filter((p) => !!p.emptyTeam === team).map((p) => p.id)
      );
      model.runs
        .filter((r) => teamProjects.has(r.pid) && r.state === 'queued')
        .sort((a, b) => a.position - b.position)
        .forEach((r, i) => (r.position = i + 1));
    }
    save();
    if (!modal.open || dialogType === 'route' || dialogType === 'board-filters')
      refresh();
  }
}
function refresh() {
  const old = document.activeElement,
    id = old?.id,
    card = old?.closest('a')?.getAttribute('href'),
    caret = old?.type === 'search' ? old.selectionStart : null;
  const evidence = modal.querySelector('#evidence')?.open;
  render();
  const target = id
    ? document.getElementById(id)
    : card
      ? Array.from(app.querySelectorAll('a')).find(
          (a) => a.getAttribute('href') === card
        )
      : null;
  if (target) {
    target.focus({ preventScroll: true });
    if (caret !== null) target.setSelectionRange(caret, caret);
  }
  if (evidence && modal.querySelector('#evidence'))
    modal.querySelector('#evidence').open = true;
}
function handleAction(action) {
  const [name, id] = action.split(':');
  const p = currentProject(),
    r = parse(hash());
  switch (name) {
    case 'theme': {
      const next =
        document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      try {
        localStorage.setItem('cloud-theme', next);
      } catch {}
      render();
      app.querySelector('[data-action="theme"]').focus();
      break;
    }
    case 'more':
      openDialog(
        'more',
        '团队工具',
        `<nav class="list-menu">${A('/overview', I('board') + ' 运行概览')}${A('/resources', I('device') + ' 执行资源')}</nav>`
      );
      break;
    case 'profile':
      showProfile();
      break;
    case 'switch':
      showSwitcher();
      break;
    case 'pick':
      pickProject(id);
      break;
    case 'close':
      closeDialog();
      break;
    case 'board-filters':
      openBoardFilters();
      break;
    case 'reset-board':
      document.getElementById('board-query').value = '';
      document.getElementById('board-project').value = '';
      patch({ app: '', q: '' });
      break;
    case 'clear-dir':
    case 'clear-cases':
      patch({ q: '' });
      break;
    case 'create':
      createProject();
      break;
    case 'submit':
      configureRun(lastProject, { global: true });
      break;
    case 'suite':
      if (p) configureRun(p.id, { suite: id, sha: scanVersion(p, r.q) });
      break;
    case 'run-case':
      configureRun(r.parts[1], { cid: id, sha: r.q.get('v') || '' });
      break;
    case 'scan':
      scanProject();
      break;
    case 'cancel-scan':
      if (p && canScan()) {
        const s = p.scans.find((s) => s.state === 'queued');
        if (s) {
          s.state = 'cancelled';
          save();
          render();
        }
      }
      break;
    case 'ready':
      if (
        p &&
        model.role === 'admin' &&
        p.scans.some((s) => s.state === 'ready')
      ) {
        p.ready = true;
        save();
        go(projectUrl(p.id));
        notice('项目已就绪');
      }
      break;
    case 'evidence': {
      const el = document.getElementById('evidence');
      if (el) {
        el.open = true;
        el.scrollIntoView({ block: 'nearest' });
        el.querySelector('summary').focus();
      }
      break;
    }
  }
}
let returnFocus = '';
window.addEventListener('hashchange', () => {
  if (modal.open && dialogType !== 'route') dismiss();
  render();
  if (!isCardRoute() && returnFocus) {
    Array.from(app.querySelectorAll('a'))
      .find((a) => a.hash === returnFocus)
      ?.focus({ preventScroll: true });
    returnFocus = '';
  }
});
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (button) {
    handleAction(button.dataset.action);
    return;
  }
  const a = e.target.closest('a[href^="#"]');
  if (
    !a ||
    e.defaultPrevented ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey
  )
    return;
  if (a.classList.contains('skip')) {
    e.preventDefault();
    const main = document.getElementById('content');
    main.tabIndex = -1;
    main.focus();
    return;
  }
  const route = a.hash.slice(1);
  if (!route.startsWith('/')) return;
  e.preventDefault();
  if (/^\/(case|requests)\//.test(route)) {
    const source = ctx();
    if (!isCardRoute()) {
      returnFocus = a.hash;
      history.pushState({ source }, '', '#' + route);
    } else {
      history.replaceState(history.state, '', '#' + route);
    }
    render();
  } else {
    if (modal.open) dismiss();
    go(route);
  }
});
modal.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeDialog();
});
modal.addEventListener('click', (e) => {
  if (e.target !== modal) return;
  const rect = modal.getBoundingClientRect();
  if (
    e.clientX < rect.left ||
    e.clientX > rect.right ||
    e.clientY < rect.top ||
    e.clientY > rect.bottom
  )
    closeDialog();
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'project-choice') {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      drawChoices(e.target.value, e.key === 'ArrowDown' ? 1 : -1);
      document
        .getElementById('pick-' + choiceProjects[choice]?.id)
        ?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && choiceProjects[choice]) {
      e.preventDefault();
      pickProject(choiceProjects[choice].id);
    }
  } else if (
    e.key === 'b' &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    !modal.open &&
    !e.target.closest('input,textarea,select') &&
    app.querySelector('[data-action="switch"]')
  ) {
    e.preventDefault();
    app.querySelector('[data-action="switch"]').focus();
    showSwitcher();
  }
});
document.addEventListener('input', (e) => {
  const input = e.target;
  if (input.id === 'project-choice') {
    drawChoices(input.value);
    return;
  }
  if (
    !['board-query', 'case-query', 'directory-query'].includes(input.id) ||
    e.isComposing
  )
    return;
  const caret = input.selectionStart;
  patch({ q: input.value });
  const next = document.getElementById(input.id);
  next.focus({ preventScroll: true });
  next.setSelectionRange(caret, caret);
});
document.addEventListener('compositionend', (e) => {
  if (['board-query', 'case-query', 'directory-query'].includes(e.target.id))
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('change', (e) => {
  const input = e.target;
  if (input.id === 'submit-project') {
    configureRun(input.value, { global: true });
    return;
  }
  const key = { version: 'v', 'run-state': 'state', 'board-project': 'app' }[
    input.id
  ];
  if (key) {
    patch({ [key]: input.value });
    document.getElementById(input.id)?.focus({ preventScroll: true });
  }
});
document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  const data = new FormData(form);
  if (form.id === 'board-filter-form') {
    closeDialog();
    return;
  }
  if (form.id === 'run-form') {
    submitRun(form);
    return;
  }
  if (form.id === 'profile-form') {
    model.role = data.get('role');
    model.empty = data.get('team') === 'empty';
    save();
    dismiss();
    go('/projects');
    return;
  }
  if (form.id === 'create-form' && model.role === 'admin') {
    const name = data.get('name').trim(),
      repo = data.get('repo').trim(),
      branch = data.get('branch').trim();
    if (!name || !repo || !branch) {
      notice('请完整填写项目名称、仓库和分支');
      return;
    }
    const p = {
      id: 'project-' + ++model.seq,
      name,
      repo,
      branch,
      art: 'coast',
      emptyTeam: model.empty,
      ready: false,
      auto: false,
      scans: [],
      scenarios: [],
      cases: []
    };
    model.projects.push(p);
    save();
    dismiss();
    go(projectUrl(p.id));
  }
});
render();
advanceDemo();
setInterval(advanceDemo, 700);
