/* global Wallets, WalletMem, wmState, Gmgn, Calls, gmgnAvailable, gmgnGet, rpc, paperState, paperSave, renderPaper, callState, callerOf, saveCalls, checkState, renderCheck, store, esc, ago */
'use strict';
// Wallet tracker: on the Check tab, a "Wallets worth tracking" block with a card for each of the coin's top
// profit-takers (GMGN stats, recent trades, balance) and a good-wallet checklist; Track adds the wallet to the one
// tracked list that Paper trades → Copy a wallet also uses. Tracked wallets are then spotted on every Check and on the
// best Call queue coins (a conviction line and call score points).

const WT_CARD_TTL = 3600000;          // a wallet's card is reused for an hour
const WT_DAILY_MS = 24 * 3600000;     // tracked wallets' 30-day stats are refreshed at most once a day
const WT_GAP_MS = 700;                // between GMGN reads: GMGN's free plan allows about 1–2 of these a second
const WT_ACT_LIMIT = 100;             // recent trades read per wallet (one page)
const WT_SCAN_PER_RUN = 5;            // Call queue coins matched per refresh (shared top-holders read)
const WT_SCAN_TTL = 30 * 60000;
const wtState = { cards: store.get('walletCards', {}), daily: store.get('walletDaily', {}), worth: null };
const wtSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wtTracked = () => (typeof paperState !== 'undefined' ? paperState.wallets : []);
const wtFind = (a) => wtTracked().find((w) => w.address === a);
const wtShort = (a) => esc(a.slice(0, 4) + '…' + a.slice(-4));
const wtUsd = (v) => (v == null ? '–' : `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(v))}`);
const wtSigned = (v) => (v == null ? '–' : `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${wtUsd(v)}</span>`);
const wtPct = (v) => (v == null ? '–' : Math.round(v * 100) + '%');
// Changes whenever the tracked list does, so queue coins are matched again.
const wtVersion = () => { let h = 0; for (const c of wtTracked().map((w) => w.address).sort().join(',')) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

// ---- One wallet's card: 7 d and 30 d stats, recent trades, holdings value and SOL balance ----
async function wtLoadCard(chain, address) {
  const key = chain + ':' + address;
  const hit = wtState.cards[key];
  if (hit && Date.now() - hit.at < WT_CARD_TTL) return hit;
  const q = { chain, wallet_address: address };
  const read = async (endpoint, params) => { const d = await gmgnGet(endpoint, Object.assign({}, q, params)); await wtSleep(WT_GAP_MS); return d; };
  const s7 = Wallets.fromStats(await read('user/wallet_stats', { period: '7d' }));
  const s30 = Wallets.fromStats(await read('user/wallet_stats', { period: '30d' }));
  const act = Wallets.fromActivity(await read('user/wallet_activity', { limit: String(WT_ACT_LIMIT) }), Date.now(), WT_ACT_LIMIT);
  let heldUsd = null, holdNote = '';
  // GMGN lists holdings as a signed request; with only an API key it may be refused, which the card then says.
  try { const h = Wallets.fromHoldings(await read('user/wallet_holdings', { limit: '50', order_by: 'usd_value', direction: 'desc' })); heldUsd = h ? h.usd : null; } catch (e) { holdNote = e.message; }
  let sol = null;
  if (chain === 'sol') { try { const r = await rpc('getBalance', [address]); sol = Number(r && r.value != null ? r.value : r) / 1e9; if (!Number.isFinite(sol)) sol = null; } catch { sol = null; } }
  const card = { at: Date.now(), chain, address, s7, s30, act, sol, heldUsd, holdNote };
  wtState.cards[key] = card;
  for (const [k, c] of Object.entries(wtState.cards)) if (Date.now() - c.at >= WT_CARD_TTL) delete wtState.cards[k];
  store.set('walletCards', wtState.cards);
  return card;
}

// Loads when the block is opened: the coin's top traders (shared read), then the cards one at a time.
async function wtLoadWorth() {
  const ca = checkState.ca, dex = checkState.dex;
  const chain = dex && Gmgn.toGmgnChain(dex.chainId);
  if (!chain || !gmgnAvailable() || (wtState.worth && wtState.worth.ca === ca)) return;
  wtState.worth = { ca, chain, loading: true, rows: [] };
  renderCheck();
  try {
    const d = await gmgnGet('market/token_top_traders', { chain, address: ca, limit: '100', order_by: 'profit' });
    if (checkState.ca !== ca) return;
    const mem = (typeof wmState !== 'undefined' && wmState.mem.wallets) || {};
    wtState.worth = { ca, chain, rows: Wallets.candidates((d && d.list) || [], (a) => WalletMem.grade(mem[a]) === 'bot').map((c) => Object.assign(c, { card: null })) };
  } catch (e) {
    if (checkState.ca === ca) { wtState.worth = { ca, chain, error: e.message }; renderCheck(); }
    return;
  }
  renderCheck();
  const w = wtState.worth;
  for (const r of w.rows) {
    if (wtState.worth !== w) return; // another coin was checked
    try { r.card = await wtLoadCard(chain, r.address); } catch (e) { r.error = e.message; }
    if (wtState.worth === w) renderCheck();
  }
}

// Cards cost about 32 GMGN reads, so they load only when you open this block yourself (or left it open), not on
// "Open all": then the block offers a Load button.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d instanceof HTMLDetailsElement && d.dataset.fold === 'track' && d.open && store.get('foldOpen', {}).track === true) wtLoadWorth();
}, true);

function worthBlock() {
  if (!checkState.dex || !Gmgn.toGmgnChain(checkState.dex.chainId) || !gmgnAvailable()) return '';
  const w = wtState.worth && wtState.worth.ca === checkState.ca ? wtState.worth : null;
  const n = wtTracked().length;
  const foot = `<p class="muted small">From this coin's top traders by profit, leaving out GMGN's dev, bundler, insider and sniper wallets and bots. Each card reads GMGN 4 times and is kept for an hour. ${n ? `You track ${n} wallet${n === 1 ? '' : 's'}; manage them in Calls → Paper trades → Copy a wallet.` : 'Tracked wallets also go into Calls → Paper trades → Copy a wallet.'} The checklist thresholds are first guesses.</p>`;
  const passing = w && w.rows ? w.rows.filter((r) => r.card && Wallets.checklist(wtCardInput(r.card)).pass).length : 0;
  const label = w && w.rows && w.rows.length && w.rows.every((r) => r.card || r.error) ? `<span class="flow-label ${passing ? 'pos' : 'muted'}">${passing} of ${w.rows.length} pass</span>` : '';
  const head = `<div class="flow-block worth-block"><div class="row between wrap"><b>Wallets worth tracking</b>${label}</div>`;
  if (!w) return head + `<p class="muted small">Cards for up to ${Wallets.MAX_CARDS} of the wallets that made the most on this coin. <button type="button" class="btn mini" id="wtLoadBtn">Load wallet cards</button></p>${foot}</div>`;
  if (w.loading) return head + '<p class="muted small">Asking GMGN who made the most on this coin…</p></div>';
  if (w.error) return head + `<p class="neg small">${esc(w.error)}</p></div>`;
  if (!w.rows.length) return head + `<p class="muted small">No wallet worth a look: every profit-taker GMGN lists is a pool, dev, bundler, insider, sniper or bot, or none took profit yet.</p>${foot}</div>`;
  return head + w.rows.map((r) => wtCardHtml(r, w.chain)).join('') + foot + '</div>';
}

const wtCardInput = (c) => ({ chain: c.chain, now: Date.now(), s7: c.s7, s30: c.s30, act: c.act, sol: c.sol, heldUsd: c.heldUsd });
const WT_MARK = { pass: '✓', fail: '✗', unknown: '?', skip: '–' };

function wtCardHtml(r, chain) {
  const tracked = wtFind(r.address);
  const head = `<div class="row between wrap"><span><code>${wtShort(r.address)}</code> <span class="muted small">took ${wtUsd(r.profit)} on this coin</span></span><a class="small" href="https://gmgn.ai/${esc(chain)}/address/${esc(r.address)}" target="_blank" rel="noopener">GMGN ↗</a></div>`;
  if (r.error) return `<div class="wcard" data-wallet="${esc(r.address)}">${head}<p class="neg small">${esc(r.error)}</p></div>`;
  if (!r.card) return `<div class="wcard" data-wallet="${esc(r.address)}">${head}<p class="muted small">Loading…</p></div>`;
  const c = r.card, a = c.act, s7 = c.s7 || {}, s30 = c.s30 || {};
  const res = Wallets.checklist(wtCardInput(c));
  const part = (x) => (x.partial ? ' <span class="muted small">partial</span>' : '');
  const ranges = [['1 day', a.d1.profit, a.d1.winRate, part(a.d1)], ['3 days', a.d3.profit, a.d3.winRate, part(a.d3)], ['7 days', s7.profit, s7.winRate, ''], ['30 days', s30.profit, s30.winRate, '']];
  const vol = (s, name) => `${name}: ${wtUsd(s.spent)} spent · ${s.buys ?? '–'} buys / ${s.sells ?? '–'} sells`;
  const bal = [c.chain === 'sol' ? (c.sol == null ? 'SOL balance not read' : `${c.sol.toFixed(2)} SOL`) : '', c.heldUsd != null ? `holdings ${wtUsd(c.heldUsd)}` : 'holdings value not available'].filter(Boolean).join(' · ');
  const failed = res.checks.filter((x) => x.status === 'fail').map((x) => x.name.toLowerCase());
  const unknown = res.checks.filter((x) => x.status === 'unknown').length;
  const action = tracked ? `<span class="pos small">Tracked${tracked.anyway ? ' (anyway)' : ''} ✓</span>`
    : res.pass ? `<button type="button" class="btn mini primary" data-wt-track="${esc(r.address)}">Track</button>`
      : `<p class="warn-text small">${failed.length ? `Fails ${failed.length} check${failed.length === 1 ? '' : 's'} (${esc(failed.join(', '))})` : 'Not every check could be read'}${failed.length && unknown ? `, ${unknown} unknown` : ''}. Its buys and sells will still move your call scores if you track it.</p><button type="button" class="btn mini" data-wt-track="${esc(r.address)}" data-wt-anyway="1">Track anyway</button>`;
  return `<div class="wcard ${res.pass ? 'wcard-pass' : 'wcard-fail'}" data-wallet="${esc(r.address)}">${head}
    <div class="table-wrap"><table class="wt-ranges"><thead><tr><th>Range</th><th class="num">Profit</th><th class="num">Win rate</th></tr></thead><tbody>
      ${ranges.map(([l, p, wr, note]) => `<tr><td>${l}${note}</td><td class="num">${wtSigned(p)}</td><td class="num">${wtPct(wr)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small">${vol(s7, '7d')}<br>${vol(s30, '30d')}</p>
    <p class="small">Typical hold ${a.holdMs == null ? '–' : Wallets.fmtHold(a.holdMs)}${a.holdN ? ` (${a.holdN} round trip${a.holdN === 1 ? '' : 's'})` : ''} · ${bal}${!a.complete ? ` · <span class="muted">trades read reach back ${Wallets.fmtHold(a.reachMs)}</span>` : ''}</p>
    ${a.last.length ? `<ul class="wt-trades small">${a.last.map((t) => `<li><span class="${t.type === 'buy' ? 'pos' : 'neg'}">${t.type === 'buy' ? 'Buy' : 'Sell'}</span> ${esc(t.symbol || wtShort(t.address))} ${wtUsd(t.usd)}${t.profit != null ? ` (${wtSigned(t.profit)})` : ''} · ${ago(t.at)} ago</li>`).join('')}</ul>` : '<p class="muted small">No trades in what GMGN returned.</p>'}
    <ul class="wt-checks small">${res.checks.map((x) => `<li class="wt-${x.status}" title="${esc(x.rule)}">${WT_MARK[x.status]} ${esc(x.name)} <span class="muted">${esc(x.detail)}</span></li>`).join('')}</ul>
    ${action}</div>`;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#wtLoadBtn')) return wtLoadWorth();
  const t = e.target.closest('[data-wt-track]');
  if (t) {
    const address = t.dataset.wtTrack, w = wtState.worth;
    if (!w || wtFind(address) || typeof paperState === 'undefined') return;
    const row = (w.rows || []).find((r) => r.address === address);
    paperState.wallets.push({ address, chain: w.chain, label: '', since: Date.now(), anyway: !!t.dataset.wtAnyway });
    if (row && row.card && row.card.s30) { wtState.daily[address] = { at: row.card.at, s30: row.card.s30 }; store.set('walletDaily', wtState.daily); }
    paperSave(); renderPaper(); renderCheck(); autoTracked();
    return;
  }
  const rn = e.target.closest('[data-wt-rename]');
  if (rn) {
    const w = wtFind(rn.dataset.wtRename);
    const v = w && window.prompt('Name for this wallet', w.label || '');
    if (v == null || !w) return;
    w.label = v.trim().slice(0, 20); paperSave(); renderPaper();
  }
});

// ---- Tracked wallets on a coin ----
async function autoTracked() {
  const ca = checkState.ca, dex = checkState.dex;
  const chain = dex && Gmgn.toGmgnChain(dex.chainId);
  if (!chain || !wtTracked().length || !gmgnAvailable()) return;
  try {
    // The same requests as Early traders, Holder labels and Wallet memory, so these are shared, not extra.
    const [h, t] = await Promise.all([
      gmgnGet('market/token_top_holders', { chain, address: ca, limit: '100' }),
      gmgnGet('market/token_top_traders', { chain, address: ca, limit: '100', order_by: 'profit' }),
    ]);
    if (checkState.ca !== ca) return;
    const now = Date.now();
    const m = Wallets.matchTracked(wtTracked(), (h && h.list) || [], (t && t.list) || [], now);
    checkState.tracked = m;
    const q = callState.queue[ca];
    if (q) { callState.queue[ca] = Object.assign({}, q, { tw: { buying: m.buying, selling: m.selling, holding: m.holding, line: m.line, at: now, v: wtVersion() } }); saveCalls(); }
  } catch { return; } // GMGN refusing: the other GMGN blocks say why
  renderCheck();
}

function trackedLine() {
  const m = checkState.tracked;
  if (!m || !m.n) return '';
  const names = [].concat(m.rows.buying, m.rows.selling, m.rows.holding).map((r) => esc(r.label || r.address.slice(0, 4) + '…' + r.address.slice(-4)));
  return `<div class="tracked-line small ${m.selling ? 'neg' : m.buying ? 'pos' : ''}">👛 ${esc(m.line)} <span class="muted">(${names.join(', ')})</span></div>`;
}

// The best-scoring queue coins: are tracked wallets among their top holders, buying or selling?
async function scanQueueTracked(now) {
  const list = wtTracked();
  if (!list.length || !gmgnAvailable()) return;
  const v = wtVersion(), q = callState.queue;
  const due = Object.values(q).filter((e) => Calls.isFresh(e, now, callState.maxAgeH * 3600000) && Gmgn.toGmgnChain(e.chainId || e.chain) && (!e.tw || e.tw.v !== v || now - e.tw.at > WT_SCAN_TTL))
    .sort((a, b) => Calls.callScore(b, callerOf(b.firstPoster), now).score - Calls.callScore(a, callerOf(a.firstPoster), now).score).slice(0, WT_SCAN_PER_RUN);
  for (const e of due) {
    try {
      const d = await gmgnGet('market/token_top_holders', { chain: Gmgn.toGmgnChain(e.chainId || e.chain), address: e.address, limit: '100' });
      const m = Wallets.matchTracked(list, (d && d.list) || [], [], now);
      if (q[e.address]) q[e.address] = Object.assign({}, q[e.address], { tw: { buying: m.buying, selling: m.selling, holding: m.holding, line: m.line, at: now, v } });
    } catch { break; }
  }
  if (due.length) saveCalls();
}

// ---- The tracked list (shown in Paper trades → Copy a wallet) ----
function wtListHtml() {
  const list = wtTracked();
  if (!list.length) return '';
  return `<div class="wt-list">${list.map((w) => {
    const d = wtState.daily[w.address], s = d && d.s30;
    const sum = s ? `30d: ${wtPct(s.winRate)} win · ${wtUsd(s.profit)} realized · ${s.buys ?? '–'} buys · checked ${ago(d.at)} ago` : 'stats not read yet';
    return `<div class="recent-item"><span><b>${esc(w.label || wtShort(w.address))}</b> <span class="tag">${esc(w.chain)}</span>${w.anyway ? ' <span class="warn-text small">tracked anyway</span>' : ''}<br><span class="muted small">${sum}</span></span><span class="row gap"><button type="button" class="btn mini" data-wt-rename="${esc(w.address)}">Rename</button><button type="button" class="btn mini" data-paper-unfollow="${esc(w.address)}" title="Stop tracking">✕</button></span></div>`;
  }).join('')}</div>`;
}

// Tracked wallets' 30-day stats, at most once a day each.
async function wtRefreshTracked() {
  if (!wtTracked().length || !gmgnAvailable()) return;
  let changed = false;
  for (const w of wtTracked().slice()) {
    const d = wtState.daily[w.address];
    if (d && Date.now() - d.at < WT_DAILY_MS) continue;
    try { wtState.daily[w.address] = { at: Date.now(), s30: Wallets.fromStats(await gmgnGet('user/wallet_stats', { chain: w.chain, wallet_address: w.address, period: '30d' })) }; changed = true; } catch { break; }
    await wtSleep(WT_GAP_MS);
  }
  if (changed) { store.set('walletDaily', wtState.daily); renderPaper(); }
}

if (typeof renderPaper === 'function') renderPaper(); // Paper trades drew its list before this file loaded
setTimeout(wtRefreshTracked, 8000);
setInterval(() => { if (document.visibilityState === 'visible') wtRefreshTracked(); }, 3600000);
