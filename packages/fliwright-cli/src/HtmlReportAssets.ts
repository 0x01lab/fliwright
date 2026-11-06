// Keep the report self contained. No CDN, fonts, client framework or server is needed.
export const reportStyles = String.raw`
:root{color-scheme:light;--bg:#f7f7f8;--card:#fff;--ink:#202124;--muted:#6b7078;--line:#dfe1e5;--fill:#f2f3f5;--pass:#137547;--pass-bg:#edf6f0;--fail:#b52636;--fail-bg:#fbeff0;--focus:#245dbb;--warn:#875e12;--warn-bg:#faf4e7}
:root.dark{color-scheme:dark;--bg:#151515;--card:#1d1d1d;--ink:#ededed;--muted:#a5a5a5;--line:#363636;--fill:#272727;--pass:#74d49b;--pass-bg:#20372a;--fail:#ff8e99;--fail-bg:#3e2428;--focus:#8bb5ff;--warn:#e6c372;--warn-bg:#372f20}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}button,input{font:inherit}h1,h2,h3,p,dl{margin:0}h1{font-size:25px;font-weight:650;letter-spacing:-.5px}h2{font-size:17px;font-weight:600}h3{font-size:14px;font-weight:600}a{color:var(--focus);text-underline-offset:3px}button{cursor:pointer;border:1px solid var(--line);border-radius:5px;background:var(--card);color:var(--ink);padding:5px 10px;font-size:12px}button:hover{background:var(--fill)}button:focus-visible,input:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:3px}summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}[hidden]{display:none!important}code,.duration,.source-file,.attempt-meta{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.report-toolbar{position:fixed;top:max(20px,env(safe-area-inset-top));left:max(24px,env(safe-area-inset-left));z-index:4;display:flex;flex-direction:column;align-items:center;gap:16px;width:40px}.project-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;text-decoration:none;color:var(--ink);background:var(--card);overflow:hidden}.project-icon img{display:block;width:100%;height:100%;object-fit:contain}.project-icon span{font-size:20px;font-weight:650}#theme{display:grid;place-items:center;width:40px;height:40px;padding:10px;border:0;border-radius:50%;box-shadow:0 2px 12px #0000000a}#theme svg{width:20px;height:20px;grid-area:1/1}.theme-sun,:root.dark .theme-moon{display:none}:root.dark .theme-sun{display:block}main{max-width:1180px;width:calc(100% - 144px);margin:auto;padding:32px 24px 20px}.release-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 28px;margin-top:20px;padding:20px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.release-meta dt{font-size:11px;color:var(--muted)}.release-meta dd{margin:3px 0 0;font-size:13px;overflow-wrap:anywhere}.review-decision{margin-top:22px;padding:18px 20px;background:var(--card);border:1px solid var(--line);border-radius:7px}.decision-heading{display:flex;gap:9px;align-items:center}.decision-icon{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;font-size:14px;background:var(--fill)}.decision-icon.qualified{background:var(--pass);color:#fff}.decision-icon.unqualified{background:var(--fail);color:#fff}.decision-policy{font-size:12px;color:var(--muted);margin:7px 0 16px}.review-counts{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.review-counts>div{border-top:1px solid var(--line);padding-top:10px}.review-counts dt{font-size:11px;color:var(--muted)}.review-counts dd{margin:2px 0 0;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}.blockers{margin-top:17px;padding-top:13px;border-top:1px solid var(--line)}.blockers h3{font-size:12px}.blockers ul{margin:7px 0 0;padding-left:20px;font-size:12px}.blockers li{margin:3px 0;overflow-wrap:anywhere}
.cases{margin-top:30px}.section-title{display:flex;justify-content:space-between;align-items:center;gap:15px}.toolbar{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:12px;align-items:center;background:var(--bg);padding:14px 0 8px}.filters{display:flex;gap:3px;flex-wrap:wrap}.filters button{border:0;background:transparent;color:var(--muted);padding:5px 10px}.filters button[aria-pressed=true]{color:var(--ink);background:var(--line)}.filters span{font-size:10px;margin-left:5px}.search{display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:5px;background:var(--card);color:var(--muted);font-size:11px;padding:5px 9px}.search input{background:transparent;border:0;color:var(--ink);font-size:12px;width:190px;min-width:0}.visible-count{font-size:11px;color:var(--muted);margin:4px 0 15px}
.issue-group{margin-bottom:26px}.issue-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:0 0 12px}.issue-heading>div{min-width:0;flex:1}.issue-heading a{font-size:15px;font-weight:600;overflow-wrap:anywhere}.issue-result{white-space:nowrap;padding:2px 8px;font-size:11px;border-radius:4px;background:var(--fill)}.issue-result.qualified{color:var(--pass);background:var(--pass-bg)}.issue-result.unqualified{color:var(--fail);background:var(--fail-bg)}.unlinked>.issue-heading{font-size:12px;color:var(--muted)}
.test-card{margin-bottom:8px;border:1px solid var(--line);border-radius:7px;background:var(--card);overflow:hidden}.test-card>summary{display:flex;align-items:center;gap:12px;padding:12px 15px;background:var(--card)}.test-card>summary:hover{background:var(--fill)}.case-number{color:var(--muted);font-size:10px;max-width:180px;overflow-wrap:anywhere}.case-heading{flex:1;min-width:0}.case-heading strong{font-size:13px;font-weight:600;overflow-wrap:anywhere}.chevron{color:var(--muted);font-size:13px}.test-card[open]>summary .chevron{transform:rotate(180deg)}.test-body{padding:0 15px 12px;border-top:1px solid var(--line)}.case-description{padding:13px 0 7px}.case-description>div{display:grid;grid-template-columns:74px minmax(0,1fr);gap:12px;margin-bottom:10px}.case-description dt{font-size:12px;color:var(--muted);padding-top:1px}.case-description dd{margin:0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.acceptance-criteria{font-size:12px;margin:12px 0 16px}.acceptance-criteria h3{font-size:12px}.acceptance-criteria ol{padding-left:20px}.case-description dd ol{margin:0;padding-left:18px}.case-description dd li+li{margin-top:8px}.muted{color:var(--muted)}.case-description dd .badge{vertical-align:middle}.qualification-note{font-size:11px;color:var(--muted)}.result-duration{display:inline-block;font-size:11px;margin-left:12px;color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;padding:2px 7px;border-radius:4px;background:var(--fill);color:var(--muted);white-space:nowrap}.badge.passed{background:var(--pass-bg);color:var(--pass)}.badge.failed,.badge.interrupted{background:var(--fail-bg);color:var(--fail)}.badge.missing{background:var(--warn-bg);color:var(--warn)}.status-icon{display:inline-grid;place-items:center;width:13px;height:13px;font-size:10px;border-radius:50%;background:var(--muted);color:var(--card);line-height:1}.passed .status-icon{background:var(--pass);color:#fff}.failed .status-icon,.interrupted .status-icon{background:var(--fail);color:#fff}.flaky{font-size:10px;padding:2px 6px;color:var(--warn);background:var(--warn-bg);border-radius:3px;white-space:nowrap}
.execution{border-top:1px solid var(--line);margin-top:4px;padding-top:8px}.execution>summary{font-size:11px;color:var(--muted);padding:2px 0}.execution>summary:before,.technical>summary:before{content:'＋ ';}.execution[open]>summary:before,.technical[open]>summary:before{content:'− '}.execution>summary>span{margin-left:8px;font-size:10px}.source-file{font-size:10px;color:var(--muted);overflow-wrap:anywhere;margin:10px 0}.attempt-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:10px;color:var(--muted);padding:10px 0}.attempt>summary{display:flex;align-items:center;gap:10px;font-size:12px;padding:10px 0}.attempt>summary:before{content:'›';color:var(--muted)}.attempt[open]>summary:before{content:'⌄'}.attempt>summary .duration{margin-left:auto}.attempt+.attempt{border-top:1px solid var(--line)}.steps{list-style:none;padding:0;margin:0}.step{padding:10px 0;border-top:1px solid var(--line)}.step.nested{margin-left:16px}.step-heading{display:flex;gap:10px;align-items:center}.step-number{font-size:10px;color:var(--muted)}.step-title{flex:1;display:flex;gap:8px;align-items:baseline;min-width:0}.step-title strong{font-size:12px;font-weight:500;overflow-wrap:anywhere}.kind{font-size:10px;color:var(--muted);white-space:nowrap}.duration{font-size:10px;color:var(--muted);min-width:60px;text-align:right;white-space:nowrap}.step-meta{font-size:10px;color:var(--muted);margin:3px 0 0 24px;overflow-wrap:anywhere}.technical{font-size:11px;margin-top:8px}.technical summary{color:var(--muted);padding:4px 0}pre{font:11px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:380px;overflow:auto;padding:12px;margin:6px 0;color:#e6e6e6;background:#151515;border-radius:5px}.empty-evidence{color:var(--muted);font-size:11px;padding:8px 0}.error-detail{margin:4px 0 12px}
.gallery{display:flex;gap:10px;overflow-x:auto;padding:10px 0 3px}.screenshot{display:flex;flex-direction:column;align-items:center;flex-shrink:0;max-width:220px;padding:0;overflow:hidden;background:var(--fill)}.screenshot img{height:180px;max-width:220px;object-fit:contain;padding:7px}.screenshot span{width:100%;padding:5px 8px;color:var(--muted);background:var(--card);font-size:10px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.notice,.runner-errors{margin-top:18px;padding:14px 16px;background:var(--card);border:1px solid var(--line);border-radius:6px;font-size:12px}.notice>strong{color:var(--warn)}.notice details{margin-top:5px}.notice li{overflow-wrap:anywhere}.runner-errors h2{font-size:14px;margin-bottom:8px}.runner-errors article>strong{color:var(--fail)}.empty-state{text-align:center;padding:45px 15px;color:var(--muted);font-size:13px}footer{margin-top:30px;padding-top:15px;display:flex;justify-content:space-between;border-top:1px solid var(--line);color:var(--muted);font-size:10px}
dialog{max-width:94vw;max-height:94vh;padding:0;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);box-shadow:0 24px 80px #0005}dialog::backdrop{background:#000b}.dialog-toolbar{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:10px 14px;border-bottom:1px solid var(--line)}.dialog-toolbar p{font-size:12px}#preview-image{display:block;max-height:80vh;max-width:90vw;object-fit:contain;margin:auto}
@media(max-width:760px){.report-toolbar{top:max(16px,env(safe-area-inset-top));left:max(12px,env(safe-area-inset-left));gap:12px}main{width:calc(100% - 64px);margin-left:64px;padding:16px 16px 16px 8px}h1{font-size:22px}.release-meta{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:15px;padding:15px 0}.review-decision{padding:14px;margin-top:16px}.decision-heading h2{font-size:15px}.decision-icon{flex-shrink:0}.review-counts{grid-template-columns:repeat(3,1fr);gap:12px}.toolbar{flex-direction:column;align-items:stretch}.search input{width:100%;font-size:16px}.section-title h2{font-size:16px}.test-card>summary{flex-wrap:wrap;gap:7px;padding:11px 12px}.case-heading{flex-basis:60%}.case-number{width:100%;font-size:10px}.test-body{padding:0 12px 10px}.case-description>div{grid-template-columns:60px minmax(0,1fr);gap:8px}.case-description dd{font-size:12px}.issue-heading{gap:10px}.issue-heading a{font-size:14px}.issue-result{font-size:10px;flex-shrink:0}.step-title{display:block}.kind{display:block}.step-heading{gap:7px}.step.nested{margin-left:8px}.step .duration{min-width:44px}.screenshot img{height:150px}footer{gap:10px;flex-wrap:wrap}}
@media print{:root,:root.dark{--bg:#fff;--card:#fff;--ink:#171717;--muted:#555;--line:#ddd;--fill:#f4f4f5;color-scheme:light}body{font-size:12px}.report-toolbar,#print,.toolbar,#expand,.chevron,.visible-count{display:none}main{width:100%;margin:0;padding:0;max-width:none}h1{font-size:22px}.review-decision{break-inside:avoid}.test-card>summary,.issue-heading{break-after:avoid}.test-body{display:block}.gallery{flex-wrap:wrap;overflow:visible}.screenshot{break-inside:avoid}pre{max-height:none;overflow:visible}dialog{display:none}footer{margin-top:18px}.cases{margin-top:20px}a{color:inherit}}
`;

export const reportScript = String.raw`
(() => {
  const cards = Array.from(document.querySelectorAll('.test-card'));
  const search = document.getElementById('search');
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  let status = 'all';
  function filter() {
    const query = search.value.trim().toLowerCase();
    let count = 0;
    cards.forEach(card => {
      card.hidden = !((status === 'all' || card.dataset.status === status) && card.dataset.name.includes(query));
      if (!card.hidden) count++;
    });
    document.getElementById('visible-count').textContent = '显示 ' + count + ' / ' + cards.length + ' 个用例';
    document.getElementById('no-results').hidden = count !== 0;
    document.querySelectorAll('[data-issue-group]').forEach(group => {
      group.hidden = !Array.from(group.querySelectorAll('.test-card')).some(card => !card.hidden);
    });
  }
  filters.forEach(button => button.addEventListener('click', () => {
    status = button.dataset.filter;
    filters.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    filter();
  }));
  search.addEventListener('input', filter);
  document.getElementById('theme').addEventListener('click', event => {
    const dark = document.documentElement.classList.toggle('dark');
    const label = dark ? '切换浅色主题' : '切换深色主题';
    event.currentTarget.setAttribute('aria-pressed', String(dark));
    event.currentTarget.setAttribute('aria-label', label);
    event.currentTarget.title = label;
  });
  document.getElementById('expand').addEventListener('click', event => {
    const visible = cards.filter(card => !card.hidden);
    const open = visible.some(card => !card.open);
    visible.forEach(card => { card.open = open; });
    event.currentTarget.textContent = open ? '收起全部用例' : '展开全部用例';
  });
  const dialog = document.getElementById('image-dialog');
  document.querySelectorAll('.screenshot').forEach(button => button.addEventListener('click', () => {
    const image = button.querySelector('img');
    document.getElementById('preview-image').src = image.src;
    document.getElementById('preview-image').alt = image.alt;
    document.getElementById('image-caption').textContent = image.alt;
    dialog.showModal();
  }));
  document.getElementById('close-image').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  let printState;
  let printVisibility;
  window.addEventListener('beforeprint', () => {
    printState = Array.from(document.querySelectorAll('details')).map(element => [element, element.open]);
    printState.forEach(([element]) => { element.open = true; });
    printVisibility = Array.from(document.querySelectorAll('.test-card,[data-issue-group],#no-results')).map(element => [element, element.hidden]);
    printVisibility.forEach(([element]) => { element.hidden = element.id === 'no-results'; });
  });
  window.addEventListener('afterprint', () => {
    if (printState) printState.forEach(([element, open]) => { element.open = open; });
    if (printVisibility) printVisibility.forEach(([element, hidden]) => { element.hidden = hidden; });
  });
  document.getElementById('print').addEventListener('click', () => window.print());
})();
`;
