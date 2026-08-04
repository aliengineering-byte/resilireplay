export function studioHtml(csrfToken: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="resilireplay-csrf" content="${csrfToken}">
  <title>ResiliReplay Studio</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <a class="skip" href="#workspace">Skip to workspace</a>
  <header class="topbar">
    <div><span class="eyebrow">LOCAL RELIABILITY LAB</span><strong>ResiliReplay Studio</strong></div>
    <div class="status"><span class="pulse" aria-hidden="true"></span><span>127.0.0.1 · no telemetry</span></div>
  </header>
  <div class="shell">
    <nav aria-label="Studio workflow">
      <button class="nav-item active" data-screen="welcome"><span>01</span>Quick start</button>
      <button class="nav-item" data-screen="target"><span>02</span>Target</button>
      <button class="nav-item" data-screen="builder"><span>03</span>Campaign</button>
      <button class="nav-item" data-screen="live"><span>04</span>Live run</button>
      <button class="nav-item" data-screen="timeline"><span>05</span>Timeline</button>
      <button class="nav-item" data-screen="findings"><span>06</span>Findings</button>
      <button class="nav-item" data-screen="baseline"><span>07</span>Baseline</button>
      <button class="nav-item" data-screen="regression"><span>08</span>Regression</button>
      <button class="nav-item" data-screen="evidence"><span>09</span>Evidence</button>
    </nav>
    <main id="workspace" tabindex="-1">
      <section class="screen active" data-panel="welcome" aria-labelledby="welcome-title">
        <p class="kicker">FAILURE IS A TEST INPUT</p>
        <h1 id="welcome-title">Prove the recovery.<br><em>Keep the evidence.</em></h1>
        <p class="lede">Import a reviewed MCP configuration, inject a deterministic fault, watch the causal chain, and gate the fix against a local baseline.</p>
        <div class="hero-grid">
          <article class="hero-card"><span class="card-index">A</span><h2>Bounded by design</h2><p>Seeds, deadlines, retry budgets, allowlists, and cancellation are part of the campaign—not hidden settings.</p></article>
          <article class="hero-card accent"><span class="card-index">B</span><h2>No judge required</h2><p>Recovery, duplicate calls, safety policy, and regression deltas are calculated from verifiable events.</p></article>
          <article class="hero-card"><span class="card-index">C</span><h2>Local evidence</h2><p>HTML, JSON, JUnit, SARIF, traces, and executable regressions stay on this machine.</p></article>
        </div>
        <button class="primary" data-go="target">Start the five-minute workflow <span>→</span></button>
      </section>

      <section class="screen" data-panel="target" aria-labelledby="target-title">
        <p class="kicker">STEP 02 · REVIEW</p><h1 id="target-title">Review the exact target</h1>
        <p class="lede small">Studio reads a repository-contained campaign. Environment and header values are always redacted.</p>
        <form id="review-form" class="form-card">
          <label for="campaign-path">Campaign file</label>
          <div class="field-row"><input id="campaign-path" name="campaignPath" value="examples/studio/campaign.yml" autocomplete="off" required><button class="primary" type="submit">Review target</button></div>
        </form>
        <div id="review-empty" class="empty"><span>⌁</span><h2>No target reviewed yet</h2><p>Load the bundled local fixture campaign or create one in the Campaign screen.</p></div>
        <div id="review-result" class="hidden" aria-live="polite"></div>
      </section>

      <section class="screen" data-panel="builder" aria-labelledby="builder-title">
        <p class="kicker">STEP 03 · DECLARE</p><h1 id="builder-title">Build a bounded campaign</h1>
        <p class="lede small">Builder accepts a reviewed Inspector-shaped config—not an arbitrary shell command.</p>
        <form id="builder-form" class="form-card grid-form">
          <label>Save campaign<input name="output" value="campaign.yml" required></label>
          <label>Inspector config<input name="inspectorConfig" value="examples/studio/mcp.json" required></label>
          <label>Server name<input name="server" value="resilient-stdio" required></label>
          <label>Fault<select name="fault"><option>mcp-tool-error</option><option>mcp-tool-timeout</option><option>mcp-malicious-canary-instruction</option><option>none</option></select></label>
          <label>Seed<input name="seed" type="number" value="42" min="-2147483648" max="2147483647"></label>
          <label>Recovery<select name="recovery"><option>retry</option><option>none</option></select></label>
          <label class="wide">Safe tool allowlist (comma-separated)<input name="allowTools" value="reliability_probe" autocomplete="off"></label>
          <button class="primary wide" type="submit">Create and review campaign</button>
        </form>
        <div id="builder-message" role="status"></div>
      </section>

      <section class="screen" data-panel="live" aria-labelledby="live-title">
        <p class="kicker">STEP 04 · EXECUTE</p><h1 id="live-title">Run under pressure</h1>
        <div id="confirmation" class="warning hidden">
          <strong>Tool calls require confirmation</strong><p>The reviewed allowlist may invoke real tools. Confirm only targets you own and understand.</p>
          <label class="check"><input id="ack" type="checkbox"> I reviewed the target, arguments policy, tool allowlist, and side-effect risk.</label>
        </div>
        <div class="run-console">
          <div class="run-head"><span>CAMPAIGN STATE</span><span id="run-state" class="badge idle">IDLE</span></div>
          <div class="meter" aria-label="Campaign progress"><span id="run-meter"></span></div>
          <p id="run-detail">Review a campaign to enable execution.</p>
          <div class="button-row"><button id="run-button" class="primary" disabled>Run reviewed campaign</button><button id="cancel-button" class="secondary" disabled>Cancel</button></div>
        </div>
        <div id="result-summary" class="metric-grid"></div>
      </section>

      <section class="screen" data-panel="timeline" aria-labelledby="timeline-title">
        <p class="kicker">STEP 05 · EXPLAIN</p><h1 id="timeline-title">Causal event timeline</h1>
        <div id="timeline-empty" class="empty"><span>↯</span><h2>No run evidence yet</h2><p>Events will appear here in sequence with their fault and cause links.</p></div>
        <ol id="timeline-list" class="timeline"></ol>
      </section>

      <section class="screen" data-panel="findings" aria-labelledby="findings-title">
        <p class="kicker">STEP 06 · DECIDE</p><h1 id="findings-title">Run detail and findings</h1>
        <div id="findings-list" class="empty"><span>✓</span><h2>Awaiting evidence</h2><p>Assertion failures, safety findings, and the first critical step will be shown here.</p></div>
      </section>

      <section class="screen" data-panel="baseline" aria-labelledby="baseline-title">
        <p class="kicker">STEP 07 · COMPARE</p><h1 id="baseline-title">Make reliability reviewable</h1>
        <div class="form-card">
          <label for="baseline-path">Baseline file</label><input id="baseline-path" value="baselines/studio-main.json">
          <div class="button-row"><button id="approve-button" class="secondary" disabled>Approve current run</button><button id="compare-button" class="primary" disabled>Compare with baseline</button></div>
        </div>
        <div id="comparison-result" class="empty"><span>Δ</span><h2>No comparison yet</h2><p>Invalid or incomplete evidence can never appear as a pass.</p></div>
      </section>

      <section class="screen" data-panel="regression" aria-labelledby="regression-title">
        <p class="kicker">STEP 08 · LOCK THE FIX</p><h1 id="regression-title">Executable regression export</h1>
        <p class="lede small">Failed traces are causally reduced, hashed, and executed before being marked generated.</p>
        <div id="regression-list" class="empty"><span>⌘</span><h2>No generated regression yet</h2><p>A failing target or negative control will create a minimized fixture and Node test.</p></div>
      </section>

      <section class="screen" data-panel="evidence" aria-labelledby="evidence-title">
        <p class="kicker">STEP 09 · PRESERVE</p><h1 id="evidence-title">Sanitized evidence downloads</h1>
        <p class="lede small">Downloads are allowlisted from this run only. Authorization headers and secret environment values are never persisted.</p>
        <div id="evidence-list" class="empty"><span>↓</span><h2>No evidence bundle yet</h2><p>Run a campaign to produce trace, report, comparison, and regression artifacts.</p></div>
      </section>
    </main>
  </div>
  <div id="toast" role="status" aria-live="polite"></div>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

export const STUDIO_CSS = `
:root{--ink:#14212b;--muted:#52616b;--line:#dce1df;--paper:#f4f3ed;--white:#fff;--acid:#d8ff62;--teal:#075e5a;--red:#bd3b2d;--shadow:0 24px 70px rgba(20,33,43,.1);font-family:Inter,"Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--paper)}*{box-sizing:border-box}body{margin:0;min-width:320px}.skip{position:absolute;left:-9999px;top:8px;background:#fff;padding:10px;z-index:20}.skip:focus{left:8px}.topbar{height:76px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:var(--ink);color:#fff;border-bottom:1px solid #30404b}.topbar strong{font-size:1.15rem;display:block;letter-spacing:-.02em}.eyebrow,.kicker{font-size:.68rem;letter-spacing:.18em;font-weight:800;color:#91a0aa}.status{display:flex;gap:8px;align-items:center;color:#cbd4d8;font-size:.78rem}.pulse{width:8px;height:8px;border-radius:50%;background:var(--acid);box-shadow:0 0 0 4px rgba(216,255,98,.14)}.shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:calc(100vh - 76px)}nav{background:#1b2a34;padding:26px 14px;display:flex;flex-direction:column;gap:4px}.nav-item{border:0;background:transparent;color:#9eacb4;text-align:left;padding:12px 13px;border-radius:8px;cursor:pointer;font:600 .78rem inherit;letter-spacing:.02em}.nav-item span{font:700 .62rem ui-monospace,monospace;margin-right:9px;color:#667781}.nav-item:hover,.nav-item:focus-visible{background:#263945;color:#fff;outline:2px solid transparent}.nav-item.active{background:var(--acid);color:var(--ink)}.nav-item.active span{color:#52611d}main{padding:58px clamp(26px,7vw,108px) 80px;max-width:1380px;width:100%}.screen{display:none;animation:rise .24s ease}.screen.active{display:block}@keyframes rise{from{transform:translateY(7px)}to{transform:none}}h1{font:750 clamp(2.1rem,4.8vw,4.8rem)/.98 Georgia,serif;letter-spacing:-.055em;margin:8px 0 24px;max-width:900px}h1 em{color:var(--teal);font-weight:500}.kicker{color:var(--teal);margin:0}.lede{font-size:1.18rem;line-height:1.65;color:var(--muted);max-width:770px}.lede.small{font-size:1rem}.hero-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:42px 0 30px}.hero-card,.form-card,.run-console,.finding,.comparison-card{background:var(--white);border:1px solid var(--line);padding:24px;border-radius:3px;box-shadow:0 10px 30px rgba(20,33,43,.04)}.hero-card.accent{background:var(--acid);border-color:#bfdf55;transform:translateY(-10px)}.hero-card h2{font-size:1.05rem;margin:22px 0 8px}.hero-card p{color:#53616a;line-height:1.55;font-size:.9rem}.card-index{font:800 .7rem ui-monospace;color:var(--teal)}button,input,select{font:inherit}.primary,.secondary{border:0;border-radius:2px;padding:13px 18px;font-weight:750;cursor:pointer}.primary{background:var(--ink);color:#fff}.primary:hover,.primary:focus-visible{background:var(--teal);outline:3px solid rgba(7,94,90,.2)}.primary:disabled,.secondary:disabled{opacity:.45;cursor:not-allowed}.secondary{background:#e8ecea;color:var(--ink)}.form-card{margin:30px 0;max-width:900px}.form-card label,.grid-form label{display:flex;flex-direction:column;gap:7px;font-size:.78rem;font-weight:800;letter-spacing:.03em}.field-row,.button-row{display:flex;gap:10px}.field-row input{flex:1}input,select{border:1px solid #bfc8c8;background:#fff;border-radius:2px;padding:12px;color:var(--ink);min-width:0}input:focus,select:focus{outline:3px solid rgba(7,94,90,.17);border-color:var(--teal)}.grid-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.grid-form .wide{grid-column:1/-1}.empty{border:1px dashed #bdc7c5;padding:45px;text-align:center;color:var(--muted);max-width:900px}.empty>span{font-size:2rem;color:var(--teal)}.empty h2{color:var(--ink);margin:10px 0 6px}.hidden{display:none!important}.plan{border-left:4px solid var(--teal);background:#fff;padding:20px;margin:12px 0}.plan pre{white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,monospace;color:#35434d}.warning{max-width:900px;background:#fff5d6;border:1px solid #e6ca72;padding:20px;margin:24px 0}.check{display:flex;gap:9px;align-items:flex-start}.check input{min-width:auto}.run-console{max-width:900px}.run-head{display:flex;justify-content:space-between;font:800 .68rem ui-monospace;letter-spacing:.12em}.badge{padding:5px 8px;background:#e7ecea}.badge.running{background:#fff0bd}.badge.pass{background:#dff6d9;color:#176d36}.badge.fail{background:#ffe0dc;color:#902b20}.meter{height:7px;background:#e7ebe9;margin:22px 0;overflow:hidden}.meter span{display:block;height:100%;width:0;background:var(--teal);transition:width .3s}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;max-width:900px;margin-top:14px}.metric{background:#fff;padding:18px;border:1px solid var(--line)}.metric strong{display:block;font-size:1.7rem}.metric span{font-size:.72rem;color:var(--muted)}.timeline{list-style:none;padding:0;max-width:980px}.event{display:grid;grid-template-columns:56px 12px minmax(0,1fr);gap:12px;padding:10px 0}.event-index{font:700 .72rem ui-monospace;color:var(--muted);padding-top:12px}.event-dot{width:10px;height:10px;border:2px solid var(--teal);border-radius:50%;margin-top:13px;position:relative}.event:not(:last-child) .event-dot:after{content:"";position:absolute;width:1px;background:#aebbb9;top:9px;bottom:-34px;left:3px}.event-body{background:#fff;border:1px solid var(--line);padding:12px 15px}.event-body strong{font:800 .73rem ui-monospace;text-transform:uppercase}.event-body p{margin:6px 0;color:var(--muted);font-size:.86rem}.event.fault .event-dot{border-color:var(--red);background:var(--red)}.finding{max-width:900px;margin:10px 0;border-left:4px solid var(--red)}.finding.pass{border-color:var(--teal)}.finding code{font-size:.75rem}.download-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-width:950px}.download{background:#fff;border:1px solid var(--line);padding:13px;text-decoration:none;color:var(--ink);display:flex;justify-content:space-between;gap:10px}.download:hover,.download:focus{border-color:var(--teal);outline:2px solid rgba(7,94,90,.15)}#toast{position:fixed;right:18px;bottom:18px;background:var(--ink);color:#fff;padding:12px 16px;max-width:420px;opacity:0;transform:translateY(8px);transition:.2s;pointer-events:none}#toast.show{opacity:1;transform:none}@media(max-width:850px){.shell{grid-template-columns:1fr}nav{position:sticky;top:0;z-index:5;flex-direction:row;overflow:auto;padding:8px}.nav-item{white-space:nowrap}.hero-grid,.metric-grid{grid-template-columns:1fr}.hero-card.accent{transform:none}.grid-form{grid-template-columns:1fr}.grid-form .wide{grid-column:auto}main{padding:36px 20px}.download-list{grid-template-columns:1fr}.topbar{padding:0 16px}.status span:last-child{display:none}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

.nav-item:not(.active) span{color:#a8b4ba}
`;

export const STUDIO_JS = String.raw`
const csrf = document.querySelector('meta[name="resilireplay-csrf"]').content;
let reviewed = null;
let confirmationToken = null;
let currentRunId = null;
let pollTimer = null;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 3000);
}
function show(screen) {
  $$('.screen').forEach((node) => node.classList.toggle('active', node.dataset.panel === screen));
  $$('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.screen === screen));
  $('#workspace').focus();
}
$$('.nav-item').forEach((node) => node.addEventListener('click', () => show(node.dataset.screen)));
$$('[data-go]').forEach((node) => node.addEventListener('click', () => show(node.dataset.go)));

async function api(path, body) {
  const options = body === undefined ? {} : {method:'POST',headers:{'content-type':'application/json','x-resilireplay-csrf':csrf},body:JSON.stringify(body)};
  const response = await fetch(path, options);
  const value = await response.json().catch(() => ({error:'Invalid Studio response'}));
  if (!response.ok) throw new Error(value.error || ('HTTP ' + response.status));
  return value;
}
function esc(value) { const node = document.createElement('span'); node.textContent = String(value); return node.innerHTML; }

async function review(path) {
  const result = await api('/api/review', {campaignPath:path}); reviewed = result; confirmationToken = null;
  $('#review-empty').classList.add('hidden'); const host = $('#review-result'); host.classList.remove('hidden');
  host.innerHTML = '<div class="plan"><strong>Reviewed campaign · ' + esc(result.campaign.id) + '</strong><p>Hash <code>' + esc(result.campaignHash) + '</code></p><pre>' + esc(JSON.stringify(result.plans, null, 2)) + '</pre></div>';
  $('#confirmation').classList.toggle('hidden', !result.requiresToolConfirmation);
  $('#run-button').disabled = false; $('#run-detail').textContent = result.campaign.scenarios.length + ' bounded scenario(s) ready.';
  show('target'); toast('Reviewed target; secrets remain redacted.');
}
$('#review-form').addEventListener('submit', async (event) => { event.preventDefault(); try { await review(new FormData(event.currentTarget).get('campaignPath')); } catch(error) { toast(error.message); } });

$('#builder-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  try {
    const result = await api('/api/campaigns', {
      output:data.get('output'), inspectorConfig:data.get('inspectorConfig'), server:data.get('server'),
      fault:data.get('fault'), seed:Number(data.get('seed')), recovery:data.get('recovery'),
      allowTools:String(data.get('allowTools') || '').split(',').map((v)=>v.trim()).filter(Boolean)
    });
    $('#builder-message').textContent = 'Created ' + result.path + ' · ' + result.campaignHash;
    $('#campaign-path').value = result.path; await review(result.path);
  } catch(error) { toast(error.message); }
});

$('#run-button').addEventListener('click', async () => {
  if (!reviewed) return;
  try {
    if (reviewed.requiresToolConfirmation) {
      if (!$('#ack').checked) throw new Error('Confirm the reviewed tool-call risk first.');
      const confirmed = await api('/api/confirm', {campaignHash:reviewed.campaignHash, acknowledgement:'reviewed-and-authorized'});
      confirmationToken = confirmed.confirmationToken;
    }
    const started = await api('/api/run', {campaignHash:reviewed.campaignHash, confirmationToken});
    currentRunId = started.runId; $('#run-button').disabled = true; $('#cancel-button').disabled = false; $('#run-state').textContent = 'RUNNING'; $('#run-state').className = 'badge running';
    show('live'); poll();
  } catch(error) { toast(error.message); }
});

async function poll() {
  clearTimeout(pollTimer);
  try {
    const state = await api('/api/runs/' + encodeURIComponent(currentRunId));
    const progress = state.progress || {completed:0,total:1};
    $('#run-meter').style.width = Math.round((progress.completed / Math.max(1, progress.total)) * 100) + '%';
    $('#run-detail').textContent = progress.scenarioId ? ('Running ' + progress.scenarioId + ' · ' + progress.completed + '/' + progress.total) : (progress.completed + '/' + progress.total);
    if (state.state === 'running') { pollTimer = setTimeout(poll, 350); return; }
    if (state.state === 'error') throw new Error(state.error || 'Campaign failed to execute');
    renderRun(state); $('#run-button').disabled = false; $('#cancel-button').disabled = true;
  } catch(error) { $('#run-state').textContent='ERROR'; $('#run-state').className='badge fail'; toast(error.message); $('#run-button').disabled=false; $('#cancel-button').disabled=true; }
}

$('#cancel-button').addEventListener('click', async()=>{ if(!currentRunId)return; try{ await api('/api/runs/'+encodeURIComponent(currentRunId)+'/cancel',{}); $('#run-detail').textContent='Cancellation requested; cleaning up target processes.'; }catch(error){toast(error.message);} });

function renderRun(state) {
  const run = state.run; const pass = run.summary.passed;
  $('#run-state').textContent = pass ? 'PASS' : 'FAIL'; $('#run-state').className = 'badge ' + (pass ? 'pass' : 'fail');
  $('#run-detail').textContent = run.summary.passedCount + '/' + run.summary.total + ' scenarios matched expectations · ' + run.runHash.slice(0,12);
  $('#result-summary').innerHTML = [
    ['Outcome', pass ? 'PASS':'FAIL'], ['Scenarios', run.summary.passedCount + '/' + run.summary.total],
    ['Fault coverage', run.summary.faultCoverage === null ? 'n/a' : Math.round(run.summary.faultCoverage*100)+'%'], ['Duration', run.durationMs+'ms']
  ].map((item)=>'<div class="metric"><strong>'+esc(item[1])+'</strong><span>'+esc(item[0])+'</span></div>').join('');
  $('#approve-button').disabled = !pass; $('#compare-button').disabled = false;
  renderFindings(run); renderEvidence(state.artifacts || []); renderRegressions(run, state.artifacts || []); loadTimeline();
}
function renderFindings(run) {
  const host = $('#findings-list'); host.className = '';
  host.innerHTML = run.results.map((result) => {
    const reasons = result.assertionFailures.concat(result.error ? [result.error] : [], result.metrics ? result.metrics.reasons : []);
    return '<article class="finding '+(result.status==='passed'?'pass':'')+'"><strong>'+esc(result.status.toUpperCase())+' · '+esc(result.id)+'</strong><p>'+esc(reasons.join(' ') || 'All declared expectations matched.')+'</p><code>first critical: '+esc(result.firstCriticalStep || 'none')+'</code></article>';
  }).join('');
}
async function loadTimeline() {
  try {
    const value = await api('/api/runs/' + encodeURIComponent(currentRunId) + '/timeline'); const list = $('#timeline-list');
    $('#timeline-empty').classList.add('hidden');
    list.innerHTML = value.events.map((event) => '<li class="event '+(event.fault?'fault':'')+'"><span class="event-index">#'+String(event.sequence).padStart(3,'0')+'</span><span class="event-dot" aria-hidden="true"></span><div class="event-body"><strong>'+esc(event.type)+(event.fault?' · '+esc(event.fault):'')+'</strong><p>'+esc(event.actor)+(event.tool?' → '+esc(event.tool):'')+'</p><small>'+esc(event.stepId)+'</small></div></li>').join('');
  } catch(error) { toast(error.message); }
}
function renderEvidence(artifacts) {
  const host=$('#evidence-list'); host.className='download-list'; host.innerHTML=artifacts.map((item)=>'<a class="download" href="/api/runs/'+encodeURIComponent(currentRunId)+'/downloads/'+encodeURIComponent(item.id)+'"><span>'+esc(item.path)+'</span><small>'+esc(item.bytes)+' B</small></a>').join('');
}
function renderRegressions(run, artifacts) {
  const relevant=artifacts.filter((item)=>item.path.includes('/regression/')); const host=$('#regression-list');
  if(!relevant.length) return; host.className='download-list'; host.innerHTML=relevant.map((item)=>'<a class="download" href="/api/runs/'+encodeURIComponent(currentRunId)+'/downloads/'+encodeURIComponent(item.id)+'"><span>'+esc(item.path)+'</span><small>verified export</small></a>').join('');
}

$('#approve-button').addEventListener('click', async()=>{ try { const value=await api('/api/baseline/approve',{runId:currentRunId,path:$('#baseline-path').value}); toast('Baseline approved: '+value.path); } catch(error){toast(error.message);} });
$('#compare-button').addEventListener('click', async()=>{ try { const value=await api('/api/baseline/compare',{runId:currentRunId,path:$('#baseline-path').value}); const c=value.comparison; const host=$('#comparison-result'); host.className='comparison-card'; host.innerHTML='<h2>'+esc(c.status.toUpperCase())+'</h2><p>'+esc(c.differences.length)+' difference(s)</p>'+c.differences.map((d)=>'<p><strong>'+esc(d.scenarioId||'campaign')+' · '+esc(d.metric)+'</strong><br>'+esc(d.message)+'</p>').join(''); } catch(error){toast(error.message);} });
`;
