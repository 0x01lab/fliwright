import type { StepModel } from './types.js';

export function getEditorHtml(
  steps: StepModel[],
  options: {
    testName?: string;
    liveMode?: boolean;
    cspSource: string;
    nonce: string;
  },
): string {
  const { testName, liveMode, cspSource, nonce } = options;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${testName ?? 'Fliwright Test Editor'}</title>
  <style nonce="${nonce}">
    :root { --step-pass: #4CAF50; --step-fail: #f44336; --step-warn: #FF9800; --step-pending: var(--vscode-descriptionForeground); }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); height: 100vh; overflow: hidden; }
    .editor { display: flex; height: 100vh; }
    .step-panel { width: 380px; min-width: 280px; border-right: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
    .toolbar { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 6px; align-items: center; }
    .toolbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
    .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
    .toolbar .stats { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .live-badge { background: #f44336; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    .step-list { flex: 1; overflow-y: auto; padding: 8px; }
    .step-card { margin-bottom: 6px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); overflow: hidden; cursor: pointer; }
    .step-card.selected { border-color: var(--vscode-focusBorder); border-width: 2px; }
    .step-card.failed { border-color: var(--step-fail); }
    .step-header { padding: 10px 12px; display: flex; align-items: center; gap: 10px; }
    .step-header:hover { background: var(--vscode-list-hoverBackground); }
    .step-card.selected .step-header { background: var(--vscode-editor-selectionBackground); }
    .step-card.failed .step-header { background: rgba(244,67,54,0.08); }
    .step-badge { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; color: white; }
    .step-badge.pass { background: var(--step-pass); }
    .step-badge.fail { background: var(--step-fail); }
    .step-badge.pending { background: var(--step-pending); }
    .step-title { font-weight: 600; }
    .step-meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .step-expand { color: var(--vscode-descriptionForeground); font-size: 10px; }
    .sub-steps { padding: 4px 12px 8px 50px; border-top: 1px dashed var(--vscode-panel-border); display: none; }
    .step-card.expanded .sub-steps { display: block; }
    .sub-step { padding: 4px 0; display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .sub-step .dot { width: 8px; height: 8px; border-radius: 50%; }
    .sub-step .dot.pass { background: var(--step-pass); }
    .sub-step .dot.fail { background: var(--step-fail); }
    .sub-step .dot.warn { background: var(--step-warn); }
    .sub-step code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
    .sub-step .detail { color: var(--vscode-descriptionForeground); }
    .sub-step .warn-tag { color: var(--step-warn); font-size: 10px; }
    .right-panel { flex: 1; display: flex; flex-direction: column; }
    .screenshot-area { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .phone-frame { width: 220px; height: 400px; background: var(--vscode-textBlockQuote-background); border-radius: 12px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--vscode-panel-border); overflow: hidden; }
    .phone-frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .no-screenshot { text-align: center; color: var(--vscode-descriptionForeground); }
    .detail-panel { height: 150px; border-top: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
    .detail-tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); padding: 0 12px; }
    .detail-tab { padding: 6px 12px; font-size: 12px; cursor: pointer; color: var(--vscode-descriptionForeground); border-bottom: 2px solid transparent; }
    .detail-tab.active { font-weight: 600; border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-foreground); }
    .detail-content { flex: 1; padding: 8px 12px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; overflow-y: auto; display: none; }
    .detail-content.active { display: block; }
    .code-line { white-space: pre; }
    .code-comment { color: var(--vscode-descriptionForeground); }
    .code-keyword { color: #569CD6; }
    .code-func { color: #DCDCAA; }
    .code-prop { color: #9CDCFE; }
    .code-string { color: #CE9178; }
    .code-number { color: #B5CEA8; }
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--vscode-descriptionForeground); gap: 12px; }
    .empty-state .icon { font-size: 48px; }
    .empty-state h3 { font-size: 16px; color: var(--vscode-foreground); }
    .empty-state p { font-size: 13px; max-width: 300px; text-align: center; }
    .empty-state button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; }
  </style>
</head>
<body>
  <div class="editor" id="editor"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let steps = [];
    let selectedIdx = -1;
    let expandedIdx = -1;
    let activeTab = 'code';
    let liveMode = ${liveMode ? 'true' : 'false'};

    function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function render() {
      const el = document.getElementById('editor');
      if (!steps.length) {
        el.innerHTML = '<div class="empty-state"><div class="icon">🧪</div><h3>No visual steps found</h3><p>This test file does not contain @fliwright-step annotations yet.</p><button onclick="vscode.postMessage({type:\'run-test\'})">⏺ Record to Generate</button></div>';
        return;
      }
      el.innerHTML = '<div class="step-panel"><div class="toolbar"><button onclick="vscode.postMessage({type:\'run-test\'})">▶ Run</button><button onclick="vscode.postMessage({type:\'open-source\'})">📝 Source</button>' + (liveMode ? '<span class="live-badge">● LIVE</span>' : '') + '<span class="stats">' + steps.length + ' steps</span></div><div class="step-list" id="stepList"></div></div><div class="right-panel"><div class="screenshot-area" id="screenshotArea"></div><div class="detail-panel"><div class="detail-tabs" id="detailTabs"></div><div id="detailContent"></div></div></div>';
      renderStepList();
      renderScreenshot();
      renderDetailPanel();
    }

    function renderStepList() {
      const list = document.getElementById('stepList');
      if (!list) return;
      list.innerHTML = steps.map((s, i) => {
        const st = s.annotation.status || 'pending';
        const sel = i === selectedIdx ? ' selected' : '';
        const exp = i === expandedIdx ? ' expanded' : '';
        const fail = st === 'fail' ? ' failed' : '';
        const badge = st === 'pass' ? '✓' : st === 'fail' ? '✗' : String(i+1);
        const meta = s.atoms.length + ' ops' + (s.annotation.duration ? ' · ' + (s.annotation.duration/1000).toFixed(1) + 's' : '');
        const atoms = s.atoms.map(a => {
          const dc = a.status === 'fail' ? 'fail' : a.warning ? 'warn' : 'pass';
          const arg = a.argument ? ': ' + esc(a.argument) : '';
          const warn = a.warning ? '<span class="warn-tag">⚠ ' + esc(a.warning) + '</span>' : '';
          return '<div class="sub-step"><span class="dot ' + dc + '"></span><code>' + esc(a.action) + '</code><span class="detail">' + esc(a.selector) + arg + '</span>' + warn + '</div>';
        }).join('');
        return '<div class="step-card' + sel + fail + exp + '" onclick="selectStep(' + i + ')"><div class="step-header"><div class="step-badge ' + st + '">' + badge + '</div><div style="flex:1;min-width:0"><div class="step-title">' + esc(s.annotation.name) + '</div><div class="step-meta">' + meta + '</div></div><span class="step-expand">' + (i === expandedIdx ? '▼' : '▶') + '</span></div><div class="sub-steps">' + atoms + '</div></div>';
      }).join('');
    }

    function renderScreenshot() {
      const area = document.getElementById('screenshotArea');
      if (!area) return;
      const s = steps[selectedIdx];
      if (!s || !s.annotation.screenshot) {
        area.innerHTML = '<div class="phone-frame"><div class="no-screenshot"><div style="font-size:32px">📱</div><div>No screenshot</div></div></div>';
        return;
      }
      area.innerHTML = '<div class="phone-frame"><img src="' + esc(s.annotation.screenshot) + '" alt="Step screenshot"></div>';
    }

    function renderDetailPanel() {
      const tabs = document.getElementById('detailTabs');
      const content = document.getElementById('detailContent');
      if (!tabs || !content) return;
      const names = ['code','network','assertions','healing'];
      const labels = {code:'Code',network:'Network',assertions:'Assertions',healing:'Healing'};
      tabs.innerHTML = names.map(t => '<div class="detail-tab' + (t === activeTab ? ' active' : '') + '" onclick="switchTab(\'' + t + '\')">' + labels[t] + '</div>').join('');
      const s = steps[selectedIdx];
      content.innerHTML = renderTabContent(activeTab, s);
    }

    function renderTabContent(tab, s) {
      if (!s) return '';
      if (tab === 'code') {
        const annLine = '<div class="code-line code-comment">// @fliwright-step: ' + esc(JSON.stringify(s.annotation)) + '</div>';
        const codeLines = s.sourceCode.split('\\n').map(l => {
          let c = esc(l);
          c = c.replace(/\\bawait\\b/g, '<span class="code-keyword">await</span>');
          c = c.replace(/\\bexpect\\b/g, '<span class="code-func">expect</span>');
          c = c.replace(/\\bpage\\b/g, '<span class="code-prop">page</span>');
          c = c.replace(/\\blocator\\b/g, '<span class="code-func">locator</span>');
          return '<div class="code-line">' + c + '</div>';
        }).join('');
        return annLine + codeLines;
      }
      if (tab === 'assertions') {
        const atoms = s.atoms.filter(a => a.action === 'assert');
        if (!atoms.length) return '<div style="color:var(--vscode-descriptionForeground)">No assertions in this step.</div>';
        return atoms.map(a => '<div class="code-line"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:' + (a.status === 'pass' ? 'var(--step-pass)' : 'var(--step-fail)') + '"></span>' + esc(a.selector) + ' ' + a.status + '</div>').join('');
      }
      return '<div style="color:var(--vscode-descriptionForeground)">No data for this tab yet.</div>';
    }

    function selectStep(idx) {
      if (selectedIdx === idx) {
        expandedIdx = expandedIdx === idx ? -1 : idx;
        vscode.postMessage({ type: 'toggle-expand', index: idx });
      } else {
        selectedIdx = idx;
        expandedIdx = idx;
        vscode.postMessage({ type: 'select-step', index: idx });
      }
      render();
    }

    function switchTab(tab) { activeTab = tab; render(); }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'init') { steps = msg.steps; selectedIdx = steps.length > 0 ? 0 : -1; render(); }
      else if (msg.type === 'step-updated') { steps[msg.index] = msg.step; render(); }
      else if (msg.type === 'step-added') { steps.push(msg.step); selectedIdx = steps.length - 1; render(); }
      else if (msg.type === 'run-status') { if (steps[msg.stepIndex]) { steps[msg.stepIndex].annotation.status = msg.status; if (msg.error) steps[msg.stepIndex].annotation.error = msg.error; render(); } }
      else if (msg.type === 'live-mode') { liveMode = msg.active; render(); }
      else if (msg.type === 'navigate-to-failure') { selectedIdx = msg.stepIndex; expandedIdx = msg.stepIndex; render(); }
    });
  </script>
</body>
</html>`;
}
