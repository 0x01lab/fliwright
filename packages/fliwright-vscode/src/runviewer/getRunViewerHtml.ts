// packages/fliwright-vscode/src/runviewer/getRunViewerHtml.ts
import type { TimelineData, FliwrightLogEvent, TraceData } from '@fliwright/core';

export interface RunViewerHtmlOptions {
  cspSource: string;
  nonce: string;
  screenshotBaseUrl: string; // webview URI for the run directory; node artifact paths are relative to it
}

/**
 * Build the tri-pane Run Viewer webview HTML:
 *   left  = timeline tree (nodes nested by parentId)
 *   mid   = screenshot + failure details + metadata for the selected node
 *   right = log events joined to the selected node via timelineNodeId
 *
 * Modeled on getTraceHtml.ts (inlined vanilla-JS, nonce-gated CSP, data embedded
 * via JSON.stringify). The webview script uses only string concatenation so it
 * does not collide with this file's own template literal.
 */
export function getRunViewerHtml(
  timeline: TimelineData,
  logs: FliwrightLogEvent[],
  trace: TraceData | undefined,
  options: RunViewerHtmlOptions,
): string {
  const { cspSource, nonce, screenshotBaseUrl } = options;
  const timelineJson = JSON.stringify(timeline).replace(/</g, '\\u003c');
  const logsJson = JSON.stringify(logs).replace(/</g, '\\u003c');
  const traceJson = JSON.stringify(trace ?? null).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fliwright Run Viewer</title>
  <style nonce="${nonce}">
    :root {
      --pass: #4CAF50;
      --fail: #f44336;
      --skip: var(--vscode-descriptionForeground);
      --run: #2196F3;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      overflow: hidden;
    }
    .viewer { display: flex; flex-direction: column; height: 100vh; }

    /* Run header */
    .run-header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; }
    .rh-top { display: flex; align-items: center; gap: 8px; }
    .run-status { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; color: #fff; text-transform: capitalize; }
    .run-status.passed { background: var(--pass); }
    .run-status.failed { background: var(--fail); }
    .run-status.running { background: var(--run); }
    .run-name { font-size: 13px; font-weight: 600; }
    .rh-meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .rh-counts { display: flex; gap: 10px; font-size: 11px; }
    .cnt.pass { color: var(--pass); }
    .cnt.fail { color: var(--fail); }
    .cnt.skip { color: var(--skip); }

    /* Body tri-pane */
    .body { flex: 1; display: flex; overflow: hidden; }
    .timeline-pane { width: 300px; min-width: 220px; border-right: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
    .pane-title { padding: 6px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
    .node-tree { flex: 1; overflow-y: auto; padding: 4px; }

    .node-row { display: flex; align-items: center; gap: 5px; padding: 3px 6px; border-radius: 3px; cursor: pointer; line-height: 1.4; }
    .node-row:hover { background: var(--vscode-list-hoverBackground); }
    .node-row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .node-row.failed { background: rgba(244,67,54,0.07); }
    .node-row.failed.selected { background: rgba(244,67,54,0.16); }
    .arrow { width: 12px; display: inline-block; text-align: center; font-size: 10px; color: var(--vscode-descriptionForeground); cursor: pointer; flex-shrink: 0; }
    .arrow.placeholder { cursor: default; }
    .dot { width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; flex-shrink: 0; }
    .dot.passed { background: var(--pass); }
    .dot.failed { background: var(--fail); }
    .dot.skipped { background: var(--skip); }
    .dot.running { background: var(--run); }
    .kind { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; padding: 1px 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); flex-shrink: 0; }
    .node-row.selected .kind { background: rgba(255,255,255,0.18); color: inherit; }
    .node-row .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dur { font-size: 10px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
    .node-row.selected .dur { color: inherit; opacity: .8; }

    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .detail-header { padding: 8px 14px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .detail-header.empty { color: var(--vscode-descriptionForeground); }
    .d-title { font-size: 13px; font-weight: 600; }
    .route { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: var(--vscode-descriptionForeground); }
    .d-dur { margin-left: auto; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .src-btn { padding: 2px 8px; font-size: 11px; border-radius: 3px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    .src-btn:hover { opacity: .9; }

    .split { flex: 1; display: flex; overflow: hidden; }
    .screenshot-pane { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .shot-wrap { display: flex; justify-content: center; }
    .shot-wrap img { max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 6px; border: 1px solid var(--vscode-panel-border); }
    .no-shot { text-align: center; color: var(--vscode-descriptionForeground); padding: 40px 0; }
    .no-shot-icon { font-size: 40px; margin-bottom: 6px; }
    .error-box { background: rgba(244,67,54,0.08); border: 1px solid rgba(244,67,54,0.25); border-radius: 5px; padding: 8px 10px; }
    .error-title { font-weight: 700; color: var(--fail); margin-bottom: 3px; }
    .error-msg { font-family: var(--vscode-editor-font-family, monospace); white-space: pre-wrap; word-break: break-word; font-size: 11px; }
    .hints { margin-top: 8px; }
    .hints-title { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .hint { display: flex; gap: 6px; padding: 2px 0; font-size: 11px; }
    .hint-kind { font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 3px; background: var(--vscode-textBlockQuote-background); color: var(--vscode-descriptionForeground); height: fit-content; flex-shrink: 0; }
    .meta { background: var(--vscode-textBlockQuote-background); border-radius: 5px; padding: 8px 10px; }
    .meta-title { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .meta-row { display: flex; gap: 8px; font-size: 11px; padding: 1px 0; }
    .meta-k { color: var(--vscode-descriptionForeground); min-width: 84px; }
    .meta-v { font-family: var(--vscode-editor-font-family, monospace); word-break: break-word; }
    .trace-list { display: flex; flex-direction: column; gap: 5px; }
    .trace-row { border-left: 3px solid var(--vscode-descriptionForeground); padding: 5px 8px; background: var(--vscode-textBlockQuote-background); border-radius: 0 4px 4px 0; }
    .trace-row.fail { border-left-color: var(--fail); }
    .trace-row.pass { border-left-color: var(--pass); }
    .trace-top { display: flex; gap: 6px; align-items: center; font-size: 11px; }
    .trace-action { font-weight: 700; }
    .trace-status { font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 0 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .trace-selector, .trace-arg, .trace-error { margin-top: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 10px; word-break: break-word; color: var(--vscode-descriptionForeground); }
    .trace-error { color: var(--fail); }
    .trace-shot { display: inline-block; margin-top: 4px; font-size: 10px; color: var(--vscode-textLink-foreground); text-decoration: none; }

    .logs-pane { width: 340px; min-width: 220px; border-left: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; overflow: hidden; }
    .logs-list { flex: 1; overflow-y: auto; padding: 4px 6px; display: flex; flex-direction: column; gap: 4px; }
    .logs-head { padding: 6px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
    .log { border-left: 3px solid var(--vscode-descriptionForeground); padding: 4px 8px; background: var(--vscode-textBlockQuote-background); border-radius: 0 4px 4px 0; }
    .log.error { border-left-color: var(--fail); }
    .log.warn { border-left-color: #ff9800; }
    .log.success { border-left-color: var(--pass); }
    .log.info { border-left-color: var(--vscode-descriptionForeground); }
    .log.debug, .log.trace { border-left-color: var(--vscode-descriptionForeground); opacity: .8; }
    .log-top { display: flex; align-items: center; gap: 6px; }
    .log-kind { font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 0 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .log-time, .log-dur { font-size: 10px; color: var(--vscode-descriptionForeground); }
    .log-dur { margin-left: auto; }
    .log-msg { font-size: 11px; margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
    .log-data { margin-top: 4px; }
    .log-data summary { cursor: pointer; font-size: 10px; color: var(--vscode-descriptionForeground); }
    .log-data pre { font-size: 10px; font-family: var(--vscode-editor-font-family, monospace); white-space: pre-wrap; word-break: break-word; margin-top: 3px; }

    .empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--vscode-descriptionForeground); }
    .empty-state .icon { font-size: 44px; }
    .empty-state h3 { font-size: 15px; color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <div class="viewer" id="viewer"></div>
  <script nonce="${nonce}">
    const TL = ${timelineJson};
    const LOGS = ${logsJson};
    const TRACE = ${traceJson};
    const BASE = ${JSON.stringify(screenshotBaseUrl)};
    const vscode = acquireVsCodeApi();

    let selectedId = null;
    const collapsed = new Set();

    // Build parent -> children map and root list once.
    const childrenOf = {};
    const roots = [];
    for (const n of TL.nodes) {
      const key = n.parentId || '__roots__';
      (childrenOf[key] = childrenOf[key] || []).push(n);
      if (!n.parentId) roots.push(n);
    }
    function kidsOf(id) { return childrenOf[id] || []; }
    function nodeById(id) { for (const n of TL.nodes) if (n.id === id) return n; return null; }

    function init() {
      // Single delegated click listener on the persistent #viewer container.
      // (Inline onclick handlers are blocked by the nonce-only CSP, so we use
      // event delegation with data-action attributes instead.)
      document.getElementById('viewer').addEventListener('click', onClick);
      if (!TL.nodes.length) { render(); return; }
      const failed = TL.nodes.find(function (n) { return n.status === 'failed'; });
      selectedId = (failed && failed.id) || (roots[0] && roots[0].id) || null;
      render();
    }

    function onClick(e) {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.getAttribute('data-action');
      const id = el.getAttribute('data-id');
      if (action === 'select') selectNode(id);
      else if (action === 'toggle') toggle(id);
      else if (action === 'source') openSourceFor(id);
    }

    function render() {
      const el = document.getElementById('viewer');
      if (!TL.nodes.length) {
        el.innerHTML = '<div class="empty-state"><div class="icon">\\u{1F9EA}</div><h3>No timeline nodes</h3><div>This run recorded no steps.</div></div>';
        return;
      }
      el.innerHTML = renderHeader()
        + '<div class="body">'
        + '<div class="timeline-pane"><div class="pane-title">Timeline</div><div class="node-tree">' + renderTree() + '</div></div>'
        + '<div class="main">' + renderDetailHeader()
        + '<div class="split">' + renderScreenshot() + renderLogs() + '</div>'
        + '</div></div>';
    }

    function renderHeader() {
      let passed = 0, failed = 0, skipped = 0;
      for (const n of TL.nodes) {
        if (n.status === 'passed') passed++;
        else if (n.status === 'failed') failed++;
        else if (n.status === 'skipped') skipped++;
      }
      const total = runDuration();
      const failureNodes = new Set();
      for (const f of (TL.agentVisibleFailures || [])) if (f.timelineNodeId) failureNodes.add(f.timelineNodeId);
      let h = '<div class="run-header">';
      h += '<div class="rh-top"><span class="run-status ' + esc(TL.status) + '">' + statusGlyph(TL.status) + ' ' + esc(TL.status) + '</span>';
      h += '<span class="run-name">' + esc(TL.testName) + '</span></div>';
      h += '<div class="rh-meta">' + esc(TL.mode) + ' \\u00B7 ' + esc(formatStamp(TL.startedAt)) + (total ? ' \\u00B7 ' + esc(total) : '') + '</div>';
      h += '<div class="rh-counts">';
      h += '<span class="cnt pass">' + passed + ' passed</span>';
      h += '<span class="cnt fail">' + failed + ' failed</span>';
      h += '<span class="cnt skip">' + skipped + ' skipped</span>';
      if (failureNodes.size) h += '<span class="cnt fail">' + failureNodes.size + ' failure(s)</span>';
      h += '</div></div>';
      return h;
    }

    function renderTree() {
      let h = '';
      for (const r of roots) h += renderNode(r, 0);
      return h;
    }

    function renderNode(n, depth) {
      const kids = kidsOf(n.id);
      const isCollapsed = collapsed.has(n.id);
      const arrow = kids.length
        ? '<span class="arrow" data-action="toggle" data-id="' + esc(n.id) + '">' + (isCollapsed ? '\\u25B6' : '\\u25BE') + '</span>'
        : '<span class="arrow placeholder"></span>';
      const cls = 'node-row' + (n.id === selectedId ? ' selected' : '') + (n.status === 'failed' ? ' failed' : '');
      let h = '<div class="' + cls + '" data-action="select" data-id="' + esc(n.id) + '" style="padding-left:' + (6 + depth * 14) + 'px">';
      h += arrow;
      h += '<span class="dot ' + esc(n.status) + '">' + statusGlyph(n.status) + '</span>';
      h += '<span class="kind">' + esc(n.kind) + '</span>';
      h += '<span class="title">' + esc(n.title || n.id) + '</span>';
      h += '<span class="dur">' + dur(n) + '</span>';
      h += '</div>';
      if (kids.length && !isCollapsed) {
        for (const k of kids) h += renderNode(k, depth + 1);
      }
      return h;
    }

    function renderDetailHeader() {
      const n = nodeById(selectedId);
      if (!n) return '<div class="detail-header empty">Select a node</div>';
      let h = '<div class="detail-header">';
      h += '<span class="dot ' + esc(n.status) + '">' + statusGlyph(n.status) + '</span>';
      h += '<span class="d-title">' + esc(n.title) + '</span>';
      h += '<span class="kind">' + esc(n.kind) + '</span>';
      if (n.route) h += '<span class="route">' + esc(n.route) + '</span>';
      h += '<span class="d-dur">' + dur(n) + '</span>';
      if (n.codeRef) h += '<button class="src-btn" data-action="source" data-id="' + esc(n.id) + '">\\u2197 Source</button>';
      h += '</div>';
      return h;
    }

    function renderScreenshot() {
      const n = nodeById(selectedId);
      let h = '<div class="screenshot-pane">';
      if (!n) { h += '<div class="no-shot"><div class="no-shot-icon">\\u{1F4F7}</div><div>Select a node to view its screenshot</div></div></div>'; return h; }
      const shot = (n.artifacts || []).find(function (a) { return a.kind === 'screenshot'; });
      if (shot) {
        h += '<div class="shot-wrap"><img src="' + BASE + '/' + esc(shot.path) + '" alt="screenshot"></div>';
      } else {
        h += '<div class="no-shot"><div class="no-shot-icon">\\u{1F4F7}</div><div>No screenshot captured for this step</div></div>';
      }
      if (n.error) {
        h += '<div class="error-box">';
        h += '<div class="error-title">' + esc(n.error.title || n.error.code) + '</div>';
        h += '<div class="error-msg">' + esc(n.error.message) + '</div>';
        if (n.error.recoveryHints && n.error.recoveryHints.length) {
          h += '<div class="hints"><div class="hints-title">Recovery hints</div>';
          for (const hint of n.error.recoveryHints) {
            h += '<div class="hint"><span class="hint-kind ' + esc(hint.kind) + '">' + esc(hint.kind) + '</span><span>' + esc(hint.description) + '</span></div>';
          }
          h += '</div>';
        }
        h += '</div>';
      }
      if (n.metadata) {
        const keys = Object.keys(n.metadata);
        if (keys.length) {
          h += '<div class="meta"><div class="meta-title">Details</div>';
          for (const k of keys) {
            h += '<div class="meta-row"><span class="meta-k">' + esc(k) + '</span><span class="meta-v">' + esc(formatMeta(n.metadata[k])) + '</span></div>';
          }
          h += '</div>';
        }
      }
      h += renderTrace(n);
      h += '</div>';
      return h;
    }

    function renderTrace(n) {
      if (!TRACE || !TRACE.steps || !TRACE.steps.length) return '';
      let h = '<div class="meta"><div class="meta-title">Trace</div>';
      h += '<div class="trace-list">';
      const failed = TRACE.steps.filter(function (s) { return s.status === 'fail'; });
      const selected = n.status === 'failed' && failed.length ? failed : TRACE.steps.slice(0, 8);
      for (const s of selected) {
        h += '<div class="trace-row ' + esc(s.status) + '">';
        h += '<div class="trace-top"><span class="trace-status">' + esc(s.status) + '</span><span class="trace-action">' + esc(s.action) + '</span>';
        h += '<span class="log-dur">' + esc(s.durationMs) + 'ms</span></div>';
        if (s.selector) h += '<div class="trace-selector">' + esc(s.selector) + '</div>';
        if (s.argument) h += '<div class="trace-arg">' + esc(s.argument) + '</div>';
        if (s.error) h += '<div class="trace-error">' + esc(s.error) + '</div>';
        if (s.screenshotFile) h += '<a class="trace-shot" href="' + BASE + '/trace/' + esc(s.screenshotFile) + '">Open trace screenshot</a>';
        h += '</div>';
      }
      if (TRACE.steps.length > selected.length) {
        h += '<div class="meta-row"><span class="meta-k">Total</span><span class="meta-v">' + TRACE.steps.length + ' action(s)</span></div>';
      }
      h += '</div></div>';
      return h;
    }

    function renderLogs() {
      const n = nodeById(selectedId);
      const nodeLogs = n ? LOGS.filter(function (l) { return l.timelineNodeId === n.id; }) : [];
      nodeLogs.sort(function (a, b) { return (a.timestamp || '').localeCompare(b.timestamp || ''); });
      let h = '<div class="logs-pane"><div class="logs-head">' + (nodeLogs.length ? nodeLogs.length + ' event(s)' : 'Logs') + '</div>';
      h += '<div class="logs-list">';
      if (!nodeLogs.length) {
        h += '<div class="no-shot" style="padding:24px 0">No log events for this step</div>';
      }
      for (const l of nodeLogs) {
        h += '<div class="log ' + esc(l.level) + '">';
        h += '<div class="log-top"><span class="log-kind">' + esc(l.kind) + '</span>';
        h += '<span class="log-time">' + esc(formatClock(l.timestamp)) + '</span>';
        if (l.durationMs != null) h += '<span class="log-dur">' + l.durationMs + 'ms</span>';
        h += '</div>';
        h += '<div class="log-msg">' + esc(l.message) + '</div>';
        if (l.data || l.error) {
          const payload = l.error ? { error: l.error } : l.data;
          h += '<details class="log-data"><summary>data</summary><pre>' + esc(JSON.stringify(payload, null, 2)) + '</pre></details>';
        }
        h += '</div>';
      }
      h += '</div></div>';
      return h;
    }

    function selectNode(id) { selectedId = id; render(); }
    function toggle(id) { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); render(); }
    function openSourceFor(id) {
      const n = nodeById(id);
      if (!n || !n.codeRef) return;
      vscode.postMessage({ type: 'openSource', file: n.codeRef.file, line: n.codeRef.line, column: n.codeRef.column || 0 });
    }

    function statusGlyph(s) {
      return s === 'passed' ? '\\u2713' : s === 'failed' ? '\\u2717' : s === 'skipped' ? '\\u25CB' : '\\u25D0';
    }
    function dur(n) {
      if (!n || !n.startedAt) return '';
      const start = Date.parse(n.startedAt);
      if (!start) return '';
      const end = n.endedAt ? Date.parse(n.endedAt) : NaN;
      if (!end) return n.status === 'running' ? '\\u2026' : '';
      const ms = end - start;
      if (!isFinite(ms) || ms < 0) return '';
      if (ms < 1000) return ms + 'ms';
      return (ms / 1000).toFixed(1) + 's';
    }
    function runDuration() {
      return dur({ startedAt: TL.startedAt, endedAt: TL.endedAt, status: TL.status });
    }
    function formatStamp(ts) { return ts ? String(ts).replace('T', ' ').replace(/\\..*/, '') : ''; }
    function formatClock(ts) { return ts && ts.length >= 19 ? ts.slice(11, 19) : (ts || ''); }
    function formatMeta(v) {
      if (v == null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }
    function esc(s) {
      if (s == null) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    init();
  </script>
</body>
</html>`;
}
