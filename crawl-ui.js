/* global CrawlCore, Check, state, checkState, renderCheck, callState, saveCalls, renderCalls, runCheck, ago, esc, $ */
'use strict';
// CrawlScan (docs/features/crawlscan.md): crawlscan.fun's scan on demand, through the Discord feed Worker (their API has
// no CORS). A block on the Check tab for Solana coins and a button on each Call queue row. Approach and data credit:
// CrawlScan (crawlscan.fun). Never run automatically: each scan runs on their servers.

const crawlState = { cache: {}, busy: {} }; // cache: ca -> summary (the Worker remembers 30 min too); busy: queue coins scanning
const crawlAvailable = () => !!(state.settings.feedUrl && state.settings.feedKey);
const CRAWL_RETRIES = 3; // a scan still running after the Worker's wait: ask again this many times

async function crawlFetch(ca, fresh) {
  const { feedUrl, feedKey } = state.settings;
  for (let i = 0; i <= CRAWL_RETRIES; i++) {
    let r;
    try { r = await fetch(feedUrl.replace(/\/+$/, '') + '/crawl?' + new URLSearchParams(Object.assign({ ca }, fresh && i === 0 ? { fresh: '1' } : {})), { headers: { 'x-feed-key': feedKey }, cache: 'no-store' }); } catch { throw new Error('Can\'t reach the Worker.'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 202 && j.pending) continue; // the scan is still running: the Worker resumes the wait
    if (r.status === 401) throw new Error('The Worker rejected the feed key.');
    if (r.status === 404) throw new Error('The Worker is older than this app: redeploy it (worker/README.md).');
    if (j.error === 'paused') throw new Error('CrawlScan has Solana scans paused right now. Try later.');
    if (!r.ok || !j.data) throw new Error(j.error ? 'CrawlScan: ' + j.error : 'CrawlScan didn\'t answer (HTTP ' + r.status + ').');
    crawlState.cache[ca] = j.data;
    return j.data;
  }
  throw new Error('CrawlScan is still crawling this coin. Tap again in a minute.');
}

// ---- Check tab ----
function crawlShow(s) {
  checkState.crawl = { s };
  Object.assign(checkState.facts, CrawlCore.facts(s));
  checkState.risk = Check.assessRisk(checkState.facts);
}
// When a Check loads: a scan from the last 30 minutes (here or from the Call queue) shows straight away.
function autoCrawl() {
  const s = crawlState.cache[checkState.ca];
  if (CrawlCore.fresh(s)) { crawlShow(s); renderCheck(); }
}
async function runCrawl(fresh) {
  const ca = checkState.ca;
  if (!crawlAvailable() || !CrawlCore.isSolana(ca)) return;
  checkState.crawl = { loading: true };
  renderCheck();
  try {
    const s = await crawlFetch(ca, fresh);
    if (checkState.ca !== ca) return; // the user moved on to another coin
    crawlShow(s);
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.crawl = { error: e.message };
  }
  renderCheck();
}

const crawlBandCls = (band) => (band === 'CLEAN' || band === 'OK' ? 'pos' : band === 'RISKY' ? 'warn-text' : band === 'DANGER' ? 'neg' : 'muted');
const crawlPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

function crawlBlock() {
  const dex = checkState.dex;
  if (!dex || dex.chainId !== 'solana') return '';
  const c = checkState.crawl;
  const s = c && c.s;
  const head = `<div class="flow-block crawl-block"><div class="row between wrap"><b>CrawlScan</b>${s ? `<span class="flow-label ${crawlBandCls(s.band)}">${esc(CrawlCore.label(s))}</span>` : ''}`;
  const btn = (label) => `<button type="button" class="btn mini" id="crawlBtn">${label}</button>`;
  if (!crawlAvailable()) return head + '</div><p class="muted small">Needs the Discord feed Worker (Settings → Advanced): CrawlScan\'s scans go through it.</p></div>';
  if (!c) return head + btn('Run CrawlScan') + '</div><p class="muted small">crawlscan.fun\'s 0–100: who really operates the top wallets and what their exit would do to the price, virgin wallets, supply received by transfer, snipers and concentration. About 10 seconds on their servers, so it runs only when you ask.</p></div>';
  if (c.loading) return head + '</div><p class="muted small">Crawling the holders on crawlscan.fun… (about 10 seconds)</p></div>';
  if (c.error) return head + btn('Retry') + `</div><p class="neg small">${esc(c.error)}</p></div>`;
  const bar = (p) => { const r = p.value == null ? 0 : p.value / p.max; const cls = p.value == null ? 'muted' : r >= 0.8 ? 'pos' : r >= 0.4 ? 'warn-text' : 'neg'; return `<div class="crawl-part"><span>${p.key === 'operator' ? 'operator (dump impact)' : p.key}</span><span class="num ${cls}">${p.value == null ? '—' : Number(p.value.toFixed(1))} / ${p.max}</span><div class="crawl-bar"><div class="crawl-fill ${cls}" style="width:${Math.round(r * 100)}%"></div></div></div>`; };
  const ops = s.operators.length ? `<div class="table-wrap"><table class="crawl-table"><thead><tr><th>Operator</th><th class="num">Float</th><th class="num hide-m">Supply</th><th>Status</th></tr></thead><tbody>
      ${s.operators.map((o) => `<tr><td>${o.wallets.length} wallet${o.wallets.length === 1 ? '' : 's'} <code>${esc((o.wallets[0] || '').slice(0, 4) + '…' + (o.wallets[0] || '').slice(-4))}</code></td><td class="num">${crawlPct(o.share)}</td><td class="num hide-m">${crawlPct(o.shareSupply)}</td><td class="${/SOLD|DUMP/.test(o.tag) ? 'neg' : ''}">${esc(o.tag.toLowerCase() || '–')}${o.sold ? ` (${Math.round(o.sold * 100)}% sold)` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '';
  return head + btn('Refresh') + `</div>
    <div class="crawl-score"><span class="crawl-num ${crawlBandCls(s.band)}">${Math.round(s.score)}</span><span class="muted">/100</span></div>
    <p class="small">${esc(s.headline)}</p>${s.reason ? `<p class="small warn-text">${esc(s.reason)}</p>` : ''}${s.notes.length ? `<p class="small muted">${esc(s.notes.join(' · '))}</p>` : ''}
    <div class="crawl-parts">${s.parts.map(bar).join('')}</div>
    ${ops}
    <p class="muted small">${s.holders != null ? `${s.holders} holders read` : ''}${s.operatorsN != null ? ` · ${s.operatorsN} operators` : ''}${s.partial ? ' · partial scan' : ''}${s.limited ? ' · limited' : ''} · scanned ${ago(s.at)} ago, remembered 30 min. Data and method: <a href="${esc('https://crawlscan.fun/?ca=' + s.ca)}" target="_blank" rel="noopener">crawlscan.fun ↗</a>. A scan is their reading of the chain at that moment, not checked by this app.</p></div>`;
}

// ---- Call queue rows ----
function crawlRowHtml(e) {
  if (!crawlAvailable() || !CrawlCore.isSolana(e.address)) return '';
  if (crawlState.busy[e.address]) return '<span class="muted small">CrawlScan…</span>';
  if (e.crawl && e.crawl.score != null) return `<span class="tag ${e.crawl.band === 'DANGER' || e.crawl.band === 'RISKY' ? 'bad' : e.crawl.band === 'CLEAN' ? 'good' : ''} click" data-call-ca="${esc(e.address)}" title="Open the full CrawlScan result on the Check tab">${esc(CrawlCore.label(e.crawl))}</span>`;
  return `${e.crawlError ? `<span class="neg small">CrawlScan: ${esc(e.crawlError)}</span> ` : ''}<button type="button" class="btn mini" data-call-crawl="${esc(e.address)}">CrawlScan</button>`;
}

async function callCrawl(addr) {
  const e = callState.queue[addr];
  if (!e || crawlState.busy[addr]) return;
  crawlState.busy[addr] = true;
  renderCalls();
  let patch;
  try {
    const s = await crawlFetch(addr, false);
    patch = { crawl: { score: s.score, band: s.band, impact: s.impact, at: s.at }, crawlError: '' };
  } catch (err) {
    patch = { crawlError: err.message };
  } finally {
    delete crawlState.busy[addr];
  }
  if (callState.queue[addr]) { callState.queue[addr] = Object.assign({}, callState.queue[addr], patch); saveCalls(); }
  renderCalls();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#crawlBtn')) { runCrawl(!!(checkState.crawl && checkState.crawl.s)); return; }
  const b = e.target.closest('[data-call-crawl]');
  if (b) callCrawl(b.dataset.callCrawl);
});
