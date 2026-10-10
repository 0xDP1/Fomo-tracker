/* global learnWallets, scanQueueWallets, walletMemLine, fomoLink, Calls, Signals, Bundle, ibMany, IB_TTL, Scanner, Check, store, state, gatherFacts, runCheck, dexPairs, shrinkImage, showTab, ago, verdictClass, $, esc */
'use strict';
// Call queue card (Check tab): contract addresses from Discord (pasted text, screenshot, ?calls= link or the
// Discord feed Worker) -> DexScreener age filter -> rug and holder check -> ranked list, plus a paper score per caller.

const CALL_H = 3600000;
const CALL_AGES = [['15m', 0.25], ['30m', 0.5], ['1h', 1], ['6h', 6], ['24h', 24], ['3d', 72]];
const CALL_WITHIN = [['any', 0], ['15m', 15], ['30m', 30], ['1h', 60]]; // minutes since the coin was first called
const CALL_CHECK_MAX = 10;          // rug and holder checks per batch (each costs several requests)
const CALL_TOP5_MAX = 45;           // alerts whose top 5 wallets hold more than this are not auto-checked
const CALL_KEEP_MS = 72 * CALL_H;   // forget calls after 3 days
const CALL_BOOK_WINDOW = 30 * 60000; // only score calls priced within 30 min of being posted
const CALL_FEED_MS = 60000;
const callState = {
  queue: store.get('callQueue', {}), book: store.get('callBook', []), maxAgeH: store.get('callAgeH', 24),
  since: store.get('callSince', 0), csince: store.get('callCSince', 0), callers: store.get('callCallers', {}),
  minLiq: store.get('callMinLiq', 5000), minWin: store.get('callMinWin', 0), channel: '', paused: store.get('callPaused', false), maxBundle: store.get('callMaxBundle', 100), lbMin: store.get('callLbMin', 10), callerFilter: '', open: store.get('callOpen', {}), view: store.get('callView', 'best'), calledWithin: store.get('callWithin', 0), minScore: store.get('callMinScore', 60),
  feed: null, busy: false, again: false, progress: '', note: '',
};
const MEDAL = { gold: '🥇', silver: '🥈', bronze: '🥉', new: '🌱' };
const callerOf = (name) => callState.callers[String(name || '').toLowerCase()] || null;
// Alert snapshots already carry age, market cap and liquidity, so those coins need no DexScreener lookup.
const hasSnap = (e) => !!(e.snap && e.snap.ageMs != null && e.snapAt);
function applySnap(e) {
  return Object.assign({}, e, { dexAt: Date.now(), fromAlert: true, snapUsed: e.snapAt, symbol: e.symbol || '', chainId: e.chain, launchedAt: e.snapAt - e.snap.ageMs, mcap: e.snap.fdv, liq: e.snap.liq, price: e.snap.priceUsd });
}
// Filters: liquidity floor, minimum caller win rate (alert data) and the channel chip.
function callPasses(e) {
  if (callState.channel && !(e.channels || []).includes(callState.channel)) return false;
  if (callState.calledWithin && Date.now() - (e.firstAt || 0) > callState.calledWithin * 60000) return false;
  if (callState.callerFilter && !Signals.postedBy(e, callState.callerFilter)) return false;
  if (e.liq != null && e.liq < callState.minLiq) return false;
  if (callState.maxBundle < 100 && e.bundle && e.bundle.bundledPct != null && e.bundle.bundledPct > callState.maxBundle) return false;
  if (callState.minWin > 0) { const w = (callerOf(e.firstPoster) || {}).winRate; if (w == null || w < callState.minWin) return false; }
  return true;
}
const FEED_MSG = {
  ok: 'ok',
  starting: 'starting — the first read happens within a minute.',
  token_invalid: 'Discord token expired or was rejected — paste a new DISCORD_TOKEN in Cloudflare.',
  no_access: 'your Discord account can\'t read that channel.',
  channel_not_found: 'channel not found — check CHANNEL_ID in Cloudflare.',
  rate_limited: 'Discord is slowing the feed down; it retries every minute.',
  discord_error: 'Discord or network trouble; the feed retries every minute.',
};

function saveCalls() {
  const now = Date.now();
  if (typeof Signals !== 'undefined') callState.book = Signals.fillSignals(callState.book, callState.queue, callState.callers);
  store.set('callCallers', callState.callers);
  for (const [a, e] of Object.entries(callState.queue)) if (now - e.lastAt > CALL_KEEP_MS) delete callState.queue[a];
  store.set('callQueue', callState.queue);
  store.set('callBook', callState.book);
}

function addCalls(calls, source) {
  const fresh = (calls || []).filter((c) => c && c.address);
  if (!fresh.length) { callState.note = source === 'feed' ? '' : 'No contract addresses found.'; renderCalls(); return 0; }
  callState.queue = Calls.addToQueue(callState.queue, fresh);
  const coins = new Set(fresh.map((c) => c.address)).size;
  if (source !== 'feed') callState.note = `Added ${coins} coin${coins === 1 ? '' : 's'}.`;
  saveCalls();
  researchCalls();
  return coins;
}

// 1) DexScreener for everything not looked up yet, 2) rug and holder check for the fresh ones, 3) paper prices.
async function researchCalls() {
  if (callState.busy) { callState.again = true; return; }
  callState.busy = true;
  try {
    do {
      callState.again = false;
      const now = Date.now();
      const q = callState.queue;
      for (const a of Object.keys(q)) {
        const e = q[a];
        if (hasSnap(e) && (!e.dexAt || (e.fromAlert && e.snapUsed !== e.snapAt))) q[a] = applySnap(e);
      }
      // A coin posted before the age window can't have launched inside it, so skip the lookup.
      const look = Object.values(q).filter((e) => !e.dexAt && !hasSnap(e) && now - e.lastAt <= callState.maxAgeH * CALL_H).map((e) => e.address);
      if (look.length) {
        callProgress(`Looking up ${look.length} coin${look.length === 1 ? '' : 's'} on DexScreener…`);
        const pairs = await dexPairs(look);
        for (const a of look) {
          const p = pairs[a];
          if (p === undefined || !q[a]) continue; // DexScreener didn't answer; retry next time
          q[a] = Object.assign({}, q[a], p
            ? { dexAt: now, symbol: (p.baseToken && p.baseToken.symbol) || '', chainId: p.chainId, launchedAt: p.pairCreatedAt || 0, mcap: p.marketCap || p.fdv || null, liq: (p.liquidity && p.liquidity.usd) || null, price: Number(p.priceUsd) || null }
            : { dexAt: now, launchedAt: 0, noPool: true });
          const e = q[a];
          if (e.price > 0 && now - e.firstAt <= CALL_BOOK_WINDOW && !callState.book.some((x) => x.address === a)) {
            callState.book = callState.book.concat({ symbol: e.symbol, address: a, chain: e.chainId || e.chain, poster: e.firstPoster, at: now, price: e.price, ret: {} }).slice(-300);
          }
        }
        saveCalls();
      }
      for (const e of Object.values(q)) {
        const priced = e.fromAlert && e.price > 0 && now - e.snapAt <= CALL_BOOK_WINDOW;
        if (priced && !callState.book.some((x) => x.address === e.address)) {
          callState.book = callState.book.concat({ symbol: e.symbol, address: e.address, chain: e.chainId || e.chain, poster: e.firstPoster, at: e.snapAt, price: e.price, ret: {} }).slice(-300);
        }
      }
      const maxAge = callState.maxAgeH * CALL_H;
      // One free request per 100 coins tells which were bundled at launch, before any slower check runs.
      if (typeof ibMany === 'function') {
        const want = Object.values(q).filter((e) => Calls.isFresh(e, now, maxAge) && (e.chainId || e.chain) === 'solana' && (!e.bundleAt || now - e.bundleAt > IB_TTL)).map((e) => e.address);
        if (want.length) {
          callProgress(`Checking bundles for ${want.length} coin${want.length === 1 ? '' : 's'}…`);
          try {
            const got = await ibMany(want);
            for (const a of want) if (q[a] && got[a]) q[a] = Object.assign({}, q[a], { bundle: got[a], bundleAt: now });
            callState.bundleNote = '';
            saveCalls();
          } catch (err) { callState.bundleNote = err.message; }
        }
      }
      // Only the best few get the full rug and holder check; the rest wait until you tap Check.
      const worth = (e) => Calls.callScore(e, callerOf(e.firstPoster), now).score;
      const toCheck = Object.values(q).filter((e) => Calls.isFresh(e, now, maxAge) && !e.verdict && !e.checkError && callPasses(e) && !(e.snap && e.snap.top5Pct != null && e.snap.top5Pct > CALL_TOP5_MAX) && !(typeof Bundle !== 'undefined' && Bundle.skipAutoCheck(e.bundle))).sort((a, b) => worth(b) - worth(a) || b.launchedAt - a.launchedAt).slice(0, CALL_CHECK_MAX);
      for (let i = 0; i < toCheck.length; i++) {
        const e = toCheck[i];
        callProgress(`Checking holders ${i + 1} of ${toCheck.length} (${e.symbol || e.address.slice(0, 6)})…`);
        try {
          const { risk } = await gatherFacts(e.address);
          const top = risk.findings[0];
          q[e.address] = Object.assign({}, q[e.address], { verdict: risk.verdict, score: risk.score, top: top ? top.title : '', topSev: top ? top.sev : '' });
        } catch (err) {
          q[e.address] = Object.assign({}, q[e.address], { checkError: err.message });
        }
        saveCalls();
      }
    } while (callState.again);
    await priceCallBook();
    if (typeof learnWallets === 'function') { await learnWallets(); await scanQueueWallets(Date.now()); }
  } finally {
    callState.busy = false;
    callState.progress = '';
    renderCalls();
  }
}

async function priceCallBook() {
  const now = Date.now();
  const due = Scanner.due(callState.book, now);
  const prices = {};
  if (due.length) {
    const pairs = await dexPairs(due);
    for (const a of due) if (pairs[a]) prices[a] = Number(pairs[a].priceUsd);
  }
  callState.book = Scanner.applyPrices(callState.book, prices, now);
  saveCalls();
}

function callProgress(t) { callState.progress = t; renderCalls(); }

// ---- screenshot -> addresses (Claude reads the image with your Anthropic key) ----
const SHOT_SCHEMA = { type: 'object', additionalProperties: false, required: ['calls'], properties: { calls: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['address', 'poster'], properties: { address: { type: 'string' }, poster: { type: 'string' } } } } } };
async function callsFromScreenshot(file) {
  const key = state.settings.anthropicKey;
  if (!key) { callState.note = 'Reading a screenshot needs an Anthropic API key (Settings). You can paste the messages instead.'; return renderCalls(); }
  callProgress('Reading the screenshot…');
  try {
    const data = await shrinkImage(file);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      body: JSON.stringify({
        model: 'claude-opus-5-5', max_tokens: 3000, fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SHOT_SCHEMA } },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: 'This is a screenshot of a Discord channel where people post crypto contract addresses. List every contract address exactly as written (Solana base58 or 0x EVM), with the display name of the person who posted it ("unknown" if you can\'t tell). Copy addresses character by character; skip any that are cut off. Return an empty list if there are none.' },
        ] }],
      }),
    });
    if (r.status === 401) throw new Error('Anthropic rejected the API key.');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Anthropic HTTP ${r.status}`);
    if (j.stop_reason === 'refusal') throw new Error('Claude declined to read this image.');
    let got = [];
    try { got = JSON.parse((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')).calls || []; } catch { throw new Error('The reply was not readable.'); }
    const now = Date.now();
    // Keep only strings that are real addresses, so a misread character can't sneak in as garbage.
    const calls = [];
    for (const c of got) for (const a of Calls.addressesIn(c.address)) calls.push(Object.assign(a, { poster: String(c.poster || 'unknown').slice(0, 40), at: now }));
    callState.progress = '';
    addCalls(calls, 'screenshot');
  } catch (e) {
    callState.progress = '';
    callState.note = `<span class="neg">${esc(e.message)}</span>`;
    renderCalls();
  }
}

// ---- Discord feed (Cloudflare Worker) ----
async function pollFeed() {
  const { feedUrl, feedKey } = state.settings;
  if (!feedUrl || !feedKey) { callState.feed = null; return; }
  if (callState.paused) return;
  try {
    const r = await fetch(feedUrl.replace(/\/+$/, '') + '/calls?since=' + callState.since + '&csince=' + callState.csince, { headers: { 'x-feed-key': feedKey }, cache: 'no-store' });
    if (r.status === 401) { callState.feed = { error: 'the feed key doesn\'t match FEED_KEY in Cloudflare.' }; return renderCalls(); }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    callState.feed = { status: j.status, checkedAt: j.checkedAt || 0, channels: Array.isArray(j.channels) ? j.channels : [], at: Date.now() };
    if (j.callers && typeof j.callers === 'object') {
      Object.assign(callState.callers, j.callers);
      if (j.now) { callState.csince = j.now; store.set('callCSince', j.now); }
      if (Object.keys(j.callers).length) store.set('callCallers', callState.callers);
    }
    const calls = Array.isArray(j.calls) ? j.calls : [];
    if (calls.length) {
      callState.since = Math.max(callState.since, ...calls.map((c) => c.at || 0));
      store.set('callSince', callState.since);
      addCalls(calls, 'feed');
    }
  } catch (e) {
    callState.feed = { error: `can't reach the feed (${e.message}). Check the URL in Settings.` };
  }
  renderCalls();
}

function feedLine() {
  const f = callState.feed;
  if (!state.settings.feedUrl || !state.settings.feedKey) return '<p class="muted small">Discord feed: off. Set it up with the Worker in <code>worker/README.md</code>, then add its URL and key in Settings → Advanced.</p>';
  if (callState.paused) return '<p class="small">Discord feed: <b>paused</b>. Nothing is read from Discord until you turn the pause off.</p>';
  if (!f) return '<p class="muted small">Discord feed: connecting…</p>';
  if (f.error) return `<p class="small neg">Discord feed: ${esc(f.error)}</p>`;
  const stale = f.checkedAt && Date.now() - f.checkedAt > 5 * 60000;
  if (f.status === 'ok' && stale) return `<p class="small neg">Discord feed: the Worker last read Discord ${ago(f.checkedAt)} ago and couldn't read it just now. Check the Worker in Cloudflare.</p>`;
  if (f.status === 'ok') return `<p class="muted small">Discord feed: ok${(f.channels || []).length > 1 ? ' · ' + f.channels.length + ' channels' : ''} · read Discord ${f.checkedAt && Date.now() - f.checkedAt >= 60000 ? ago(f.checkedAt) + ' ago' : 'just now'}</p>`;
  const bad = (f.channels || []).filter((c) => c.status && c.status !== 'ok');
  if (bad.length && f.status !== 'token_invalid') return `<p class="small neg">Discord feed: ${bad.map((c) => `<b>${esc(c.label)}</b>: ${esc(FEED_MSG[c.status] || c.status)}`).join('<br>')}</p>`;
  return `<p class="small ${f.status === 'starting' ? 'muted' : 'neg'}">Discord feed: ${esc(FEED_MSG[f.status] || f.status)}</p>`;
}

const CALL_CHAINS = { solana: 'Solana', base: 'Base', bsc: 'BNB', ethereum: 'Ethereum', evm: 'EVM' };
const callShort = (a) => (a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-6) : a);
const callMoney = (v) => (v == null ? '–' : Check.fmtMcap(v));
const callRet = (m) => (!m.n ? '–' : `<span class="${m.avg > 0 ? 'pos' : m.avg < 0 ? 'neg' : ''}">${m.avg > 0 ? '+' : ''}${(m.avg * 100).toFixed(0)}%</span> <span class="muted">${m.up}/${m.n}</span>`);

function renderCalls() {
  const card = $('#callsCard');
  if (!card) return;
  // Keep folded panels as they are on screen right now; the toggle event can arrive after a quick re-render.
  card.querySelectorAll('details[data-sec]').forEach((d) => { callState.open[d.dataset.sec] = d.open; });
  const now = Date.now();
  const all = Object.values(callState.queue);
  const maxAge = callState.maxAgeH * CALL_H;
  const inWindow = all.filter((e) => Calls.isFresh(e, now, maxAge));
  const passing = inWindow.filter(callPasses);
  const scores = new Map(passing.map((e) => [e.address, Calls.callScore(e, callerOf(e.firstPoster), now)]));
  const sc = (e) => scores.get(e.address).score;
  const best = passing.filter((e) => sc(e) >= callState.minScore).sort((a, b) => sc(b) - sc(a) || (b.launchedAt || 0) - (a.launchedAt || 0));
  const bestView = callState.view !== 'all';
  const fresh = bestView ? best : Calls.rank(passing);
  const belowScore = passing.length - best.length;
  const pending = all.filter((e) => !e.dexAt).length;
  const hidden = all.length - inWindow.length - pending;
  const filtered = inWindow.length - passing.length;
  const labels = [...new Set([].concat(...inWindow.map((e) => e.channels || []), ((callState.feed && callState.feed.channels) || []).map((c) => c.label)))].filter((l) => l && !/^\d+$/.test(l));
  const sum = $('#callsSummary');
  if (sum) sum.textContent = callState.busy ? 'researching…' : all.length ? `${fresh.length} ${bestView ? 'best' : 'new'} coin${fresh.length === 1 ? '' : 's'} under ${CALL_AGES.find(([, h]) => h === callState.maxAgeH)?.[0] || callState.maxAgeH + 'h'}` : 'contract addresses from Discord';
  const head = `<form id="callsForm" class="calls-form"><textarea id="callsText" rows="3" placeholder="Paste Discord messages with contract addresses…" spellcheck="false"></textarea>
    <div class="row gap wrap"><button class="btn primary mini" type="submit">Add</button><button type="button" class="btn mini" id="callsPaste">Paste calls</button>
      <label class="btn mini" title="Read addresses from a Discord screenshot">Screenshot<input type="file" id="callsShot" accept="image/*" hidden /></label>
      <label class="small">Launched within <select id="callsAge">${CALL_AGES.map(([l, h]) => `<option value="${h}" ${h === callState.maxAgeH ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="small">Called within <select id="callsWithin">${CALL_WITHIN.map(([l, m]) => `<option value="${m}" ${m === callState.calledWithin ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${all.length ? '<button type="button" class="btn mini" id="callsClear">Clear</button>' : ''}</div>
    <div class="row gap wrap small calls-filters"><label>Min liquidity $ <input type="number" id="callsMinLiq" min="0" step="500" value="${callState.minLiq}" /></label>
      <label>Min caller win % <input type="number" id="callsMinWin" min="0" max="100" step="5" value="${callState.minWin}" /></label>
      <label>Max bundled % <input type="number" id="callsMaxBundle" min="0" max="100" step="5" value="${callState.maxBundle}" /></label>
      <label>Best: score ≥ <input type="number" id="callsMinScore" min="0" max="100" step="5" value="${callState.minScore}" /></label>
      ${state.settings.feedUrl && state.settings.feedKey ? `<label><input type="checkbox" id="callsPause" ${callState.paused ? 'checked' : ''} /> Pause feed</label>` : ''}</div></form>
    ${passing.length ? `<div class="tag-chips calls-view"><button type="button" class="${bestView ? 'on' : ''}" data-call-view="best">Best ${best.length}</button><button type="button" class="${bestView ? '' : 'on'}" data-call-view="all">All scores ${passing.length}</button></div>` : ''}
    ${labels.length > 1 ? `<div class="tag-chips calls-chips">${['', ...labels].map((l) => { const n = l ? inWindow.filter((e) => (e.channels || []).includes(l)).length : inWindow.length; return `<button type="button" class="${callState.channel === l ? 'on' : ''}" data-call-channel="${esc(l)}">${esc(l || 'All')} ${n}</button>`; }).join('')}</div>` : ''}
    ${callState.callerFilter ? `<div class="tag-chips calls-chips"><button type="button" class="on" data-call-caller="">caller: ${esc(callState.callerFilter)} ✕</button></div>` : ''}`;
  let body = feedLine();
  if (callState.progress) body += `<p class="muted small">${esc(callState.progress)}</p>`;
  if (callState.note) body += `<p class="small">${callState.note}</p>`;
  if (callState.bundleNote) body += `<p class="muted small">Bundle check skipped: ${esc(callState.bundleNote)}</p>`;
  if (fresh.length) {
    body += fresh.map((e) => {
      const prof = callerOf(e.firstPoster);
      const caller = prof ? `<b>${esc(e.firstPoster)}</b> ${MEDAL[prof.medal] || ''}${prof.winRate != null ? ` ${prof.winRate}% win (30d)` : ' no record yet'}${prof.group ? ' · ' + esc(prof.group) : ''}${e.posters.length > 1 ? ` · ${e.posters.length} callers` : ''}` : `<b>${esc(e.firstPoster)}</b>${e.posters.length > 1 ? ` +${e.posters.length - 1}` : ''}`;
      const since = e.callMcap && e.mcap ? ` · called at ${callMoney(e.callMcap)}${e.mcap > e.callMcap * 1.05 || e.mcap < e.callMcap * 0.95 ? ` → ${callMoney(e.mcap)} (${(e.mcap / e.callMcap).toFixed(1)}×)` : ''}` : '';
      const snapBits = e.snap ? `${e.snap.holders != null ? ' · ' + e.snap.holders.toLocaleString() + ' holders' : ''}${e.snap.top5Pct != null ? ' · top 5 hold ' + e.snap.top5Pct + '%' : ''}` : '';
      const cs = scores.get(e.address);
      const why = cs.reasons.map(esc).concat(cs.flags.map((f) => `<span class="neg">${esc(f)}</span>`)).join(' · ');
      const v = e.verdict ? `<span class="v-pill ${verdictClass[e.verdict] || ''}">${esc(e.verdict)}</span>` : e.checkError ? '<span class="muted small">check failed</span>' : '<span class="muted small">checking…</span>';
      return `<div class="recent-item call-row"><span><span><span class="score-pill ${cs.score >= 70 ? 'hi' : cs.score >= callState.minScore ? 'ok' : 'lo'}" title="Call score out of 100">${cs.score}</span> <b>${esc(e.symbol || e.address.slice(0, 6))}</b> <span class="tag">${esc(CALL_CHAINS[e.chainId || e.chain] || e.chainId || e.chain)}</span> ${v}${e.bundle ? ` <span class="tag ${e.bundle.scanned && (e.bundle.bundledPct >= 30 || e.bundle.serial) ? 'bad' : e.bundle.scanned && e.bundle.bundledPct < 15 ? 'good' : ''}">${esc(Bundle.label(e.bundle))}${e.bundle.serial ? ' · serial dev' : ''}</span>` : ''}</span>
        ${why ? `<span class="small call-why">${why}</span>` : ''}
        <span class="muted small">age ${ago(e.launchedAt)} · mcap ${callMoney(e.mcap)}${e.fromAlert ? ' at alert' : ''} · liq ${callMoney(e.liq)}${snapBits}</span>
        <span class="small">${caller}${since}</span>
        <span class="muted small">${e.mentions} mention${e.mentions === 1 ? '' : 's'}${(e.channels || []).length ? ' · in ' + e.channels.map(esc).join(', ') : ''}</span>
        <span class="small call-ca"><code>${esc(callShort(e.address))}</code> <button type="button" class="btn mini" data-call-copy="${esc(e.address)}">Copy</button> ${fomoLink(e.chainId || e.chain, e.address)}</span>
        ${e.top ? `<span class="small">${esc(e.top)}</span>` : ''}</span>
        <button type="button" class="btn mini" data-call-ca="${esc(e.address)}">Check</button></div>`;
    }).join('');
  } else if (bestView && passing.length && !callState.busy) body += `<p class="muted small">No coin scores ${callState.minScore} or more right now.</p>`;
  else if (all.length && !callState.busy) body += `<p class="muted small">No coin in the queue launched within ${CALL_AGES.find(([, h]) => h === callState.maxAgeH)?.[0]}.</p>`;
  if (!all.length) body += '<p class="muted small">Paste a run of Discord messages, read a screenshot, or connect the Discord feed. Every Solana and 0x address is looked up; only coins launched inside your window are checked and ranked, safest and newest first.</p>';
  if (hidden > 0) body += `<p class="muted small">${hidden} older or not trading coin${hidden === 1 ? '' : 's'} hidden.</p>`;
  if (bestView && belowScore > 0) body += `<p class="muted small">${belowScore} more score under ${callState.minScore}. <button type="button" class="btn mini" data-call-view="all">Show all</button></p>`;
  if (filtered > 0) body += `<p class="muted small">${filtered} more hidden by your filters (liquidity, caller win rate, bundled %, called within, channel or caller).</p>`;
  const callers = Calls.callerStats(callState.book);
  if (callers.length) {
    body += `<h4 class="sub-head">Callers</h4><div class="table-wrap"><table class="calls-score"><thead><tr><th>Caller</th><th class="num">30d win</th><th class="num">Calls</th><th class="num hide-m">1h</th><th class="num">6h</th><th class="num">24h</th></tr></thead><tbody>
      ${callers.slice(0, 15).map((c) => `<tr><td>${esc(c.poster)}</td><td class="num">${(() => { const p = callerOf(c.poster); return p && p.winRate != null ? `${MEDAL[p.medal] || ''} ${p.winRate}%` : '–'; })()}</td><td class="num">${c.calls}</td><td class="num hide-m">${callRet(c.h1)}</td><td class="num">${callRet(c.h6)}</td><td class="num">${callRet(c.h24)}</td></tr>`).join('')}
      </tbody></table></div><p class="muted small">Average return from the price when the call was first seen, with wins/priced. Credit goes to the first person to post a coin. Prices are read only while the app is open; missed marks don't count.</p>`;
  }
  body += leaderboardHtml(callers) + scorecardHtml() + (typeof walletMemLine === 'function' ? walletMemLine() : '');
  const typed = $('#callsText') ? $('#callsText').value : '';
  card.innerHTML = head + body;
  if (typed) $('#callsText').value = typed;
}

const pctCell = (v) => (v == null ? '–' : `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${Math.round(v * 100)}%</span>`);

function leaderboardHtml(own) {
  const all = Signals.leaderboard(callState.callers, own, 0);
  if (!all.length) return '';
  const rows = all.filter((r) => r.samples >= callState.lbMin);
  return `<details class="adv calls-sec" data-sec="board" ${callState.open.board ? 'open' : ''}><summary>Leaderboard (${rows.length} of ${all.length} callers)</summary>
    <label class="small calls-lbmin">Min calls <input type="number" id="callsLbMin" min="0" step="5" value="${callState.lbMin}" /></label>
    ${rows.length ? `<div class="table-wrap"><table class="calls-board"><thead><tr><th>Caller</th><th class="num">30d win</th><th class="num">Calls</th><th class="num hide-m">7d</th><th class="num hide-m">Median</th><th class="num">App 6h</th><th class="num hide-m">Seen</th></tr></thead><tbody>
      ${rows.slice(0, 50).map((r) => `<tr class="click" data-call-caller="${esc(r.name)}"><td>${MEDAL[r.medal] || ''} ${esc(r.name)} <span class="muted small">${esc(r.group)}</span></td><td class="num">${r.winRate}%</td><td class="num">${r.samples}</td><td class="num hide-m">${r.hit7 == null ? '–' : r.hit7 + '%'}</td><td class="num hide-m">${r.median == null ? '–' : r.median + '×'}</td><td class="num">${r.own && r.own.h6.n ? pctCell(r.own.h6.avg) + ` <span class="muted">${r.own.h6.n}</span>` : '–'}</td><td class="num hide-m">${r.updatedAt ? ago(r.updatedAt) : '–'}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted small">No caller has that many calls yet. Lower the minimum.</p>'}
    <p class="muted small">Win rate, calls, 7-day rate and median come from the alert bot (1.5×+ hits over 30 days) and update every time a caller shows up again. App 6h is this app's own average 6-hour return on their calls, with how many were priced. Tap a caller to see only their coins.</p></details>`;
}

function scorecardHtml() {
  const rows = Signals.scorecard(callState.book);
  if (!rows.length) return '';
  return `<details class="adv calls-sec" data-sec="score" ${callState.open.score ? 'open' : ''}><summary>Signal scorecard (${callState.book.length} priced call${callState.book.length === 1 ? '' : 's'})</summary>
    <div class="table-wrap"><table class="calls-scorecard"><thead><tr><th>Signal</th><th class="num">Priced 6h</th><th class="num">Up</th><th class="num hide-m">Avg 1h</th><th class="num">Avg 6h</th><th class="num hide-m">Avg 24h</th></tr></thead><tbody>
      ${rows.map((r, i) => `${i === 0 || rows[i - 1].signal !== r.signal ? `<tr class="sec-row"><td colspan="6"><b>${esc(r.signal)}</b></td></tr>` : ''}<tr><td>${esc(r.group)}</td><td class="num">${r.h6.n}</td>${r.enough ? `<td class="num">${Math.round((100 * r.h6.up) / r.h6.n)}%</td><td class="num hide-m">${pctCell(r.h1.avg)}</td><td class="num">${pctCell(r.h6.avg)}</td><td class="num hide-m">${pctCell(r.h24.avg)}</td>` : `<td class="muted small" colspan="4">too few · ${r.calls} seen</td>`}</tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">For each signal a call had when it was first priced: how many were priced 6 hours later, the share that were up, and the average return. Groups need ${Signals.MIN_GROUP}+ priced calls before the numbers mean anything. Prices are read only while the app is open, so this fills up over days.</p></details>`;
}

$('#callsCard').addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.dataset && d.dataset.sec) { callState.open[d.dataset.sec] = d.open; store.set('callOpen', callState.open); }
}, true);

$('#callsCard').addEventListener('submit', (e) => {
  if (e.target.id !== 'callsForm') return;
  e.preventDefault();
  const t = $('#callsText');
  const calls = Calls.extractCalls(t.value, Date.now());
  if (calls.length) t.value = '';
  addCalls(calls, 'paste');
});
$('#callsCard').addEventListener('click', async (e) => {
  if (e.target.closest('#callsPaste')) {
    try { addCalls(Calls.extractCalls(await navigator.clipboard.readText(), Date.now()), 'paste'); }
    catch { callState.note = 'This browser didn\'t allow reading the clipboard. Paste into the box instead.'; renderCalls(); }
    return;
  }
  if (e.target.closest('#callsClear')) {
    if (!confirm('Clear the call queue? Caller scores stay.')) return;
    callState.queue = {}; callState.note = ''; saveCalls(); return renderCalls();
  }
  const who = e.target.closest('[data-call-caller]');
  if (who) { callState.callerFilter = callState.callerFilter === who.dataset.callCaller ? '' : who.dataset.callCaller; renderCalls(); if (callState.callerFilter) $('#callsCard').scrollIntoView({ behavior: 'smooth' }); return; }
  const view = e.target.closest('[data-call-view]');
  if (view) { callState.view = view.dataset.callView; store.set('callView', callState.view); renderCalls(); return; }
  const chip = e.target.closest('[data-call-channel]');
  if (chip) { callState.channel = chip.dataset.callChannel; renderCalls(); researchCalls(); return; }
  const cp = e.target.closest('[data-call-copy]');
  if (cp) {
    const addr = cp.dataset.callCopy;
    try { await navigator.clipboard.writeText(addr); cp.textContent = 'Copied'; }
    catch { window.prompt('Copy this address:', addr); cp.textContent = 'Copy'; }
    setTimeout(() => { if (cp.isConnected) cp.textContent = 'Copy'; }, 1500);
    return;
  }
  const b = e.target.closest('[data-call-ca]');
  if (b) { runCheck(b.dataset.callCa); setTimeout(() => window.scrollTo({ top: $('#checkForm').offsetTop - 70, behavior: 'smooth' }), 50); }
});
$('#callsCard').addEventListener('change', (e) => {
  if (e.target.id === 'callsShot') { const f = e.target.files[0]; e.target.value = ''; if (f) callsFromScreenshot(f); }
  if (e.target.id === 'callsPause') { callState.paused = e.target.checked; store.set('callPaused', callState.paused); renderCalls(); if (!callState.paused) pollFeed(); }
  if (e.target.id === 'callsLbMin') { callState.lbMin = Math.max(0, Number(e.target.value) || 0); store.set('callLbMin', callState.lbMin); renderCalls(); }
  if (e.target.id === 'callsMaxBundle') { callState.maxBundle = Math.min(100, Math.max(0, Number(e.target.value) || 0)); store.set('callMaxBundle', callState.maxBundle); renderCalls(); researchCalls(); }
  if (e.target.id === 'callsMinLiq') { callState.minLiq = Math.max(0, Number(e.target.value) || 0); store.set('callMinLiq', callState.minLiq); renderCalls(); researchCalls(); }
  if (e.target.id === 'callsMinScore') { callState.minScore = Math.min(100, Math.max(0, Number(e.target.value) || 0)); store.set('callMinScore', callState.minScore); renderCalls(); researchCalls(); }
  if (e.target.id === 'callsMinWin') { callState.minWin = Math.min(100, Math.max(0, Number(e.target.value) || 0)); store.set('callMinWin', callState.minWin); renderCalls(); researchCalls(); }
  if (e.target.id === 'callsWithin') { callState.calledWithin = Number(e.target.value) || 0; store.set('callWithin', callState.calledWithin); renderCalls(); return; }
  if (e.target.id === 'callsAge') { callState.maxAgeH = Number(e.target.value); store.set('callAgeH', callState.maxAgeH); renderCalls(); researchCalls(); }
});

renderCalls();
// ?calls=<text> (an iPhone Shortcut can share copied Discord messages here).
const _callsParam = new URLSearchParams(location.search).get('calls');
if (_callsParam) {
  showTab('check');
  const sec = $('#callsSection'); if (sec) sec.open = true;
  addCalls(Calls.extractCalls(_callsParam, Date.now()), 'link');
  history.replaceState(null, '', location.pathname); // a reload shouldn't count the calls twice
} else researchCalls();
pollFeed();
setInterval(() => { if (document.visibilityState === 'visible') pollFeed(); }, CALL_FEED_MS);
// The Worker reads Discord only when asked, so opening the app is what starts the catch-up.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollFeed(); });
setInterval(() => { if (document.visibilityState === 'visible' && !callState.busy) priceCallBook().then(async () => { if (typeof learnWallets === 'function') { await learnWallets(); await scanQueueWallets(Date.now()); } renderCalls(); }); }, 10 * 60000);
$('#settingsForm').addEventListener('submit', () => setTimeout(pollFeed, 0));
