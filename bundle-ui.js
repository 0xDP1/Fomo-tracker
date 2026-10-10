/* global Bundle, Check, checkState, renderCheck, $, esc */
'use strict';
// Bundle check (isitbundled.com, free, no key): a block on the Check tab for Solana coins, and one batch request
// for the Call queue so every row shows how much of the coin was bundled at launch.

const IB_API = 'https://isitbundled.com/api/v1/';
const IB_TTL = 10 * 60000;  // results are reused for 10 minutes
const ibCache = {};         // mint -> { b, at }

async function ibJson(url, opts) {
  let r;
  try { r = await fetch(url, opts); } catch { throw new Error('isitbundled.com did not answer (network or CORS)'); }
  if (r.status === 429) throw new Error('isitbundled.com rate limit hit, try again in a minute');
  if (!r.ok) throw new Error('isitbundled.com HTTP ' + r.status);
  return r.json();
}

async function ibOne(mint) {
  const c = ibCache[mint];
  if (c && Date.now() - c.at < IB_TTL) return c.b;
  const b = Bundle.parse(await ibJson(IB_API + 'token/' + encodeURIComponent(mint)));
  ibCache[mint] = { b, at: Date.now() };
  return b;
}

// mint -> parsed result for every Solana mint, one request per 100 (cached ones are not asked again).
async function ibMany(mints) {
  const out = {};
  const ask = [];
  for (const m of mints) { const c = ibCache[m]; if (c && Date.now() - c.at < IB_TTL) out[m] = c.b; else ask.push(m); }
  for (const batch of Bundle.solanaBatches(ask)) {
    const j = await ibJson(IB_API + 'tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mints: batch }) });
    for (const t of (j && j.tokens) || []) { const b = Bundle.parse(t); if (b) { out[b.mint] = b; ibCache[b.mint] = { b, at: Date.now() }; } }
  }
  return out;
}

const ibCls = (b) => (!b || !b.scanned ? 'muted' : b.bundledPct >= 30 || b.serial ? 'neg' : b.bundledPct >= 15 ? 'warn-text' : 'pos');

async function autoBundle() {
  const ca = checkState.ca, dex = checkState.dex;
  if (!dex || dex.chainId !== 'solana') return;
  checkState.bundle = { loading: true };
  renderCheck();
  try {
    const b = await ibOne(ca);
    if (checkState.ca !== ca) return; // the user moved on to another coin
    checkState.bundle = { b };
    if (b && b.scanned) { Object.assign(checkState.facts, Bundle.facts(b)); checkState.risk = Check.assessRisk(checkState.facts); }
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.bundle = { error: e.message };
  }
  renderCheck();
}

function bundleBlock() {
  const dex = checkState.dex;
  if (!dex || dex.chainId !== 'solana') return '';
  const head = '<div class="flow-block bundle-block"><div class="row between wrap"><b>Bundle check</b>';
  const s = checkState.bundle;
  if (!s || s.loading) return head + '</div><p class="muted small">Asking isitbundled.com…</p></div>';
  if (s.error) return head + `<button type="button" class="btn mini" id="bundleBtn">Retry</button></div><p class="neg small">${esc(s.error)}</p></div>`;
  const b = s.b;
  if (!b || !b.scanned) return head + '</div><p class="small">Not scanned yet by isitbundled.com. That is not the same as clean.</p></div>';
  const pct = (v) => (v == null ? '–' : Math.round(v * 10) / 10 + '%');
  return head + `<span class="flow-label ${ibCls(b)}">${esc(Bundle.label(b))}</span></div>
    <p class="small">${pct(b.bundledPct)} of supply bundled at launch${b.wallets ? ` by ${b.wallets} wallet${b.wallets === 1 ? '' : 's'}` : ''} · ${pct(b.firstSecondPct)} bought in the first second · dev bought ${pct(b.devBoughtPct)}${b.risk ? ` · risk ${esc(b.risk)}` : ''}</p>
    ${b.devLaunches7d != null ? `<p class="small ${b.serial ? 'neg' : ''}">Dev launched ${b.devLaunches7d} coin${b.devLaunches7d === 1 ? '' : 's'} in 7 days, ${b.devBundled7d || 0} bundled.</p>` : ''}
    <p class="muted small">Data: <a href="${esc(b.report)}" target="_blank" rel="noopener">isitbundled.com report</a>. Their reading of on-chain launches; not checked by this app.</p></div>`;
}

document.addEventListener('click', (e) => { if (e.target.closest('#bundleBtn')) { delete ibCache[checkState.ca]; autoBundle(); } });
