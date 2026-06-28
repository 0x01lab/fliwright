// packages/fliwright-vscode/src/trace/getTraceHtml.ts
import type { TraceData } from '@fliwright/core';

export function getTraceHtml(
  traces: Map<string, TraceData>,
  options: {
    runId: string;
    cspSource: string;
    nonce: string;
    screenshotBaseUrls: Map<string, string>; // testDir -> base URL for screenshots
  },
): string {
  const { runId, cspSource, nonce, screenshotBaseUrls } = options;

  // Serialize trace data for embedding
  const tracesJson: Record<string, { meta: TraceData['meta']; steps: TraceData['steps'] }> = {};
  for (const [dir, data] of traces) {
    tracesJson[dir] = data;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fliwright Trace Viewer</title>
  <style nonce="${nonce}">
    :root { --pass: #4CAF50; --fail: #f44336; --pending: var(--vscode-descriptionForeground); }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); height: 100vh; overflow: hidden; }
    .viewer { display: flex; height: 100vh; }
    .sidebar { width: 320px; min-width: 240px; border-right: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
    .sidebar-header { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    .sidebar-header h2 { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .sidebar-header .meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .test-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    .test-tab { padding: 3px 8px; font-size: 11px; border-radius: 3px; cursor: pointer; border: 1px solid var(--vscode-panel-border); background: transparent; color: var(--vscode-foreground); }
    .test-tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
    .test-tab.failed { border-color: var(--fail); }
    .step-list { flex: 1; overflow-y: auto; padding: 4px; }
    .step-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; margin-bottom: 2px; }
    .step-item:hover { background: var(--vscode-list-hoverBackground); }
    .step-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .step-item.failed-step { background: rgba(244,67,54,0.06); }
    .step-item.failed-step.selected { background: rgba(244,67,54,0.12); }
    .step-icon { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; color: white; }
    .step-icon.pass { background: var(--pass); }
    .step-icon.fail { background: var(--fail); }
    .step-icon.pending { background: var(--pending); }
    .step-info { flex: 1; min-width: 0; }
    .step-action { font-size: 12px; font-weight: 600; }
    .step-selector { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .step-duration { font-size: 11px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
    .step-thumb { width: 32px; height: 32px; border-radius: 3px; object-fit: cover; border: 1px solid var(--vscode-panel-border); flex-shrink: 0; background: var(--vscode-textBlockQuote-background); }
    .detail-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .detail-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: 14px; }
    .detail-header { padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 12px; }
    .detail-header .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; color: white; }
    .detail-header .badge.pass { background: var(--pass); }
    .detail-header .badge.fail { background: var(--fail); }
    .detail-header .action-name { font-size: 15px; font-weight: 600; }
    .detail-header .selector { font-size: 12px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); }
    .detail-header .duration { margin-left: auto; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .detail-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; gap: 16px; }
    .screenshot-panel { flex: 1; display: flex; align-items: center; justify-content: center; }
    .screenshot-panel img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; border: 1px solid var(--vscode-panel-border); }
    .no-screenshot { text-align: center; color: var(--vscode-descriptionForeground); }
    .info-panel { width: 300px; min-width: 200px; display: flex; flex-direction: column; gap: 12px; }
    .info-section h3 { font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
    .error-box { background: rgba(244,67,54,0.08); border: 1px solid rgba(244,67,54,0.2); border-radius: 4px; padding: 8px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre-wrap; word-break: break-all; color: var(--fail); }
    .widget-tree { background: var(--vscode-textBlockQuote-background); border-radius: 4px; padding: 8px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; }
    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .status-badge.passed { background: rgba(76,175,80,0.15); color: var(--pass); }
    .status-badge.failed { background: rgba(244,67,54,0.15); color: var(--fail); }
    .empty-traces { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--vscode-descriptionForeground); }
    .empty-traces .icon { font-size: 48px; }
    .empty-traces h3 { font-size: 16px; color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <div class="viewer" id="viewer"></div>
  <script nonce="${nonce}">
    const tracesData = ${JSON.stringify(tracesJson)};
    const screenshotBaseUrls = ${JSON.stringify(Object.fromEntries(screenshotBaseUrls))};
    const runId = ${JSON.stringify(runId)};

    let selectedTestDir = null;
    let selectedStepIdx = -1;

    function init() {
      // Single delegated click listener on the persistent #viewer container.
      // Inline onclick handlers are blocked by the nonce-only CSP.
      document.getElementById('viewer').addEventListener('click', onClick);
      const dirs = Object.keys(tracesData);
      if (!dirs.length) {
        document.getElementById('viewer').innerHTML = '<div class="empty-traces"><div class="icon">\\u{1F9EA}</div><h3>No trace data</h3><div>Run tests with trace enabled to see results here.</div></div>';
        return;
      }
      // Auto-select first failed test, or first test
      selectedTestDir = dirs.find(d => tracesData[d].meta.status === 'failed') || dirs[0];
      selectedStepIdx = 0;
      render();
    }

    function onClick(e) {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.getAttribute('data-action');
      if (action === 'select-test') {
        selectTest(el.getAttribute('data-dir'));
      } else if (action === 'select-step') {
        selectStep(Number(el.getAttribute('data-idx')));
      }
    }

    function render() {
      const el = document.getElementById('viewer');
      el.innerHTML = '<div class="sidebar">' + renderSidebar() + '</div><div class="detail-panel">' + renderDetail() + '</div>';
    }

    function renderSidebar() {
      const dirs = Object.keys(tracesData);
      let html = '<div class="sidebar-header"><h2>Run ' + esc(runId.replace(/T.*/, '')) + '</h2><div class="meta">' + dirs.length + ' test(s)</div></div>';
      // Test tabs
      html += '<div class="test-tabs">';
      for (const dir of dirs) {
        const t = tracesData[dir];
        const isActive = dir === selectedTestDir;
        const cls = 'test-tab' + (isActive ? ' active' : '') + (t.meta.status === 'failed' ? ' failed' : '');
        const label = esc(t.meta.testName.length > 20 ? t.meta.testName.substring(0, 20) + '...' : t.meta.testName);
        const icon = t.meta.status === 'passed' ? '\\u2713' : t.meta.status === 'failed' ? '\\u2717' : '\\u25CB';
        html += '<button class="' + cls + '" data-action="select-test" data-dir="' + esc(dir) + '">' + icon + ' ' + label + '</button>';
      }
      html += '</div>';
      // Step list
      html += '<div class="step-list">';
      if (selectedTestDir && tracesData[selectedTestDir]) {
        const trace = tracesData[selectedTestDir];
        const base = screenshotBaseUrls[selectedTestDir] || '';
        for (let i = 0; i < trace.steps.length; i++) {
          const s = trace.steps[i];
          const isFail = s.status === 'fail';
          const isSel = i === selectedStepIdx;
          const cls = 'step-item' + (isSel ? ' selected' : '') + (isFail ? ' failed-step' : '');
          const icon = s.status === 'pass' ? '\\u2713' : '\\u2717';
          const iconCls = 'step-icon ' + s.status;
          let thumb = '';
          if (s.screenshotFile) {
            thumb = '<img class="step-thumb" src="' + base + '/' + s.screenshotFile + '" alt="step">';
          }
          html += '<div class="' + cls + '" data-action="select-step" data-idx="' + i + '">';
          html += '<div class="' + iconCls + '">' + icon + '</div>';
          html += '<div class="step-info"><div class="step-action">' + esc(s.action) + '</div><div class="step-selector">' + esc(s.selector || '\\u2014') + '</div></div>';
          html += '<div class="step-duration">' + s.durationMs + 'ms</div>';
          html += thumb;
          html += '</div>';
        }
      }
      html += '</div>';
      return html;
    }

    function renderDetail() {
      if (!selectedTestDir || !tracesData[selectedTestDir]) {
        return '<div class="detail-empty">Select a test to view trace</div>';
      }
      const trace = tracesData[selectedTestDir];
      const step = trace.steps[selectedStepIdx];
      if (!step) {
        return '<div class="detail-empty">No steps recorded</div>';
      }

      let html = '';
      // Header
      const badgeCls = 'badge ' + step.status;
      const badgeText = step.status === 'pass' ? 'PASS' : 'FAIL';
      html += '<div class="detail-header">';
      html += '<span class="' + badgeCls + '">' + badgeText + '</span>';
      html += '<span class="action-name">' + esc(step.action) + '</span>';
      html += '<span class="selector">' + esc(step.selector) + '</span>';
      if (step.argument) html += '<span class="selector">\\u201C' + esc(step.argument) + '\\u201D</span>';
      html += '<span class="duration">' + step.durationMs + 'ms</span>';
      html += '</div>';

      // Body
      html += '<div class="detail-body">';

      // Screenshot
      const base = screenshotBaseUrls[selectedTestDir] || '';
      html += '<div class="screenshot-panel">';
      if (step.screenshotFile) {
        html += '<img src="' + base + '/' + step.screenshotFile + '" alt="Screenshot">';
      } else {
        html += '<div class="no-screenshot"><div style="font-size:48px">\\u{1F4F1}</div><div>No screenshot captured</div><div style="font-size:11px;margin-top:4px">Use trace mode "full" to capture every step</div></div>';
      }
      html += '</div>';

      // Info panel
      html += '<div class="info-panel">';
      if (step.error) {
        html += '<div class="info-section"><h3>Error</h3><div class="error-box">' + esc(step.error) + '</div></div>';
      }
      if (step.widgetTree) {
        html += '<div class="info-section"><h3>Widget Tree</h3><div class="widget-tree">' + esc(JSON.stringify(step.widgetTree, null, 2)) + '</div></div>';
      }
      // Step metadata
      html += '<div class="info-section"><h3>Details</h3>';
      html += '<div style="font-size:12px;line-height:1.8">';
      html += '<div><strong>Step:</strong> #' + step.index + '</div>';
      html += '<div><strong>Time:</strong> ' + esc(step.timestamp) + '</div>';
      html += '<div><strong>Duration:</strong> ' + step.durationMs + 'ms</div>';
      if (step.argument) html += '<div><strong>Argument:</strong> ' + esc(step.argument) + '</div>';
      html += '</div></div>';
      html += '</div>';

      html += '</div>';
      return html;
    }

    function selectTest(dir) {
      selectedTestDir = dir;
      selectedStepIdx = 0;
      render();
    }

    function selectStep(idx) {
      selectedStepIdx = idx;
      render();
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
