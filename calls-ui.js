/* global Calls, Scanner, Check, store, state, gatherFacts, runCheck, dexPairs, shrinkImage, showTab, ago, verdictClass, $, esc */
'use strict';
// Call queue card (Check tab): contract addresses from Discord (pasted text, screenshot, ?calls= link or the
// Discord feed Worker) -> DexScreener age filter -> rug and holder check -> ranked list, plus a paper score per caller.

const CALL_H = 3600000;
const CALL_AGES = [['1h', 1], ['6h', 6], ['24h', 24], ['3d', 72]];
const CALL_CHECK_MAX = 20;          // rug and holder checks per batch
const CALL_KEEP_MS = 72 * CALL_H;   // forget calls after 3 days
const CALL_BOOK_WINDOW = 30 * 60000; // only score calls priced within 30 min of being posted
const CALL_FEED_MS = 60000;
const callState = {
  queue: store.get('callQueue', {}), book: store.get('callBook', []), maxAgeH: store.get('callAgeH', 24),
  since: store.get('callSince', 0), feed: null, busy: false, again: false, progress: '', note: '',
};
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
      // A coin posted before the age window can't have launched inside it, so skip the lookup.
      const look = Object.values(q).filter((e) => !e.dexAt && now - e.lastAt <= callState.maxAgeH * CALL_H).map((e) => e.address);
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
      const maxAge = callState.maxAgeH * CALL_H;
      const toCheck = Object.values(q).filter((e) => Calls.isFresh(e, now, maxAge) && !e.verdict && !e.checkError).sort((a, b) => b.launchedAt - a.launchedAt).slice(0, CALL_CHECK_MAX);
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
  try {
    const r = await fetch(feedUrl.replace(/\/+$/, '') + '/calls?since=' + callState.since, { headers: { 'x-feed-key': feedKey }, cache: 'no-store' });
    if (r.status === 401) { callState.feed = { error: 'the feed key doesn\'t match FEED_KEY in Cloudflare.' }; return renderCalls(); }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    callState.feed = { status: j.status, checkedAt: j.checkedAt || 0, at: Date.now() };
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
  if (!f) return '<p class="muted small">Discord feed: connecting…</p>';
  if (f.error) return `<p class="small neg">Discord feed: ${esc(f.error)}</p>`;
  const stale = f.checkedAt && Date.now() - f.checkedAt > 5 * 60000;
  if (f.status === 'ok' && stale) return `<p class="small neg">Discord feed: no read since ${ago(f.checkedAt)} ago — check the Worker's Cron Trigger.</p>`;
  if (f.status === 'ok') return `<p class="muted small">Discord feed: ok · read Discord ${f.checkedAt && Date.now() - f.checkedAt >= 60000 ? ago(f.checkedAt) + ' ago' : 'just now'}</p>`;
  return `<p class="small ${f.status === 'starting' ? 'muted' : 'neg'}">Discord feed: ${esc(FEED_MSG[f.status] || f.status)}</p>`;
}

const CALL_CHAINS = { solana: 'Solana', base: 'Base', bsc: 'BNB', ethereum: 'Ethereum', evm: 'EVM' };
const callMoney = (v) => (v == null ? '–' : Check.fmtMcap(v));
const callRet = (m) => (!m.n ? '–' : `<span class="${m.avg > 0 ? 'pos' : m.avg < 0 ? 'neg' : ''}">${m.avg > 0 ? '+' : ''}${(m.avg * 100).toFixed(0)}%</span> <span class="muted">${m.up}/${m.n}</span>`);

function renderCalls() {
  const card = $('#callsCard');
  if (!card) return;
  const now = Date.now();
  const all = Object.values(callState.queue);
  const maxAge = callState.maxAgeH * CALL_H;
  const fresh = Calls.rank(all.filter((e) => Calls.isFresh(e, now, maxAge)));
  const pending = all.filter((e) => !e.dexAt).length;
  const hidden = all.length - fresh.length - pending;
  const sum = $('#callsSummary');
  if (sum) sum.textContent = callState.busy ? 'researching…' : all.length ? `${fresh.length} new coin${fresh.length === 1 ? '' : 's'} under ${CALL_AGES.find(([, h]) => h === callState.maxAgeH)?.[0] || callState.maxAgeH + 'h'}` : 'contract addresses from Discord';
  const head = `<form id="callsForm" class="calls-form"><textarea id="callsText" rows="3" placeholder="Paste Discord messages with contract addresses…" spellcheck="false"></textarea>
    <div class="row gap wrap"><button class="btn primary mini" type="submit">Add</button><button type="button" class="btn mini" id="callsPaste">Paste calls</button>
      <label class="btn mini" title="Read addresses from a Discord screenshot">Screenshot<input type="file" id="callsShot" accept="image/*" hidden /></label>
      <label class="small">Launched within <select id="callsAge">${CALL_AGES.map(([l, h]) => `<option value="${h}" ${h === callState.maxAgeH ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${all.length ? '<button type="button" class="btn mini" id="callsClear">Clear</button>' : ''}</div></form>`;
  let body = feedLine();
  if (callState.progress) body += `<p class="muted small">${esc(callState.progress)}</p>`;
  if (callState.note) body += `<p class="small">${callState.note}</p>`;
  if (fresh.length) {
    body += fresh.map((e) => {
      const posters = e.posters.slice(0, 3).map((p) => (p === e.firstPoster ? `<b>${esc(p)}</b>` : esc(p))).join(', ') + (e.posters.length > 3 ? ` +${e.posters.length - 3}` : '');
      const v = e.verdict ? `<span class="v-pill ${verdictClass[e.verdict] || ''}">${esc(e.verdict)}</span>` : e.checkError ? '<span class="muted small">check failed</span>' : '<span class="muted small">checking…</span>';
      return `<div class="recent-item call-row"><span><span><b>${esc(e.symbol || e.address.slice(0, 6))}</b> <span class="tag">${esc(CALL_CHAINS[e.chainId || e.chain] || e.chainId || e.chain)}</span> ${v}</span>
        <span class="muted small">age ${ago(e.launchedAt)} · mcap ${callMoney(e.mcap)} · liq ${callMoney(e.liq)} · ${e.mentions} mention${e.mentions === 1 ? '' : 's'} · ${posters}</span>
        ${e.top ? `<span class="small">${esc(e.top)}</span>` : ''}</span>
        <button type="button" class="btn mini" data-call-ca="${esc(e.address)}">Check</button></div>`;
    }).join('');
  } else if (all.length && !callState.busy) body += `<p class="muted small">No coin in the queue launched within ${CALL_AGES.find(([, h]) => h === callState.maxAgeH)?.[0]}.</p>`;
  if (!all.length) body += '<p class="muted small">Paste a run of Discord messages, read a screenshot, or connect the Discord feed. Every Solana and 0x address is looked up; only coins launched inside your window are checked and ranked, safest and newest first.</p>';
  if (hidden > 0) body += `<p class="muted small">${hidden} older or not trading coin${hidden === 1 ? '' : 's'} hidden.</p>`;
  const callers = Calls.callerStats(callState.book);
  if (callers.length) {
    body += `<h4 class="sub-head">Callers</h4><div class="table-wrap"><table class="calls-score"><thead><tr><th>Caller</th><th class="num">Calls</th><th class="num hide-m">1h</th><th class="num">6h</th><th class="num">24h</th></tr></thead><tbody>
      ${callers.slice(0, 15).map((c) => `<tr><td>${esc(c.poster)}</td><td class="num">${c.calls}</td><td class="num hide-m">${callRet(c.h1)}</td><td class="num">${callRet(c.h6)}</td><td class="num">${callRet(c.h24)}</td></tr>`).join('')}
      </tbody></table></div><p class="muted small">Average return from the price when the call was first seen, with wins/priced. Credit goes to the first person to post a coin. Prices are read only while the app is open; missed marks don't count.</p>`;
  }
  const typed = $('#callsText') ? $('#callsText').value : '';
  card.innerHTML = head + body;
  if (typed) $('#callsText').value = typed;
}

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
  const b = e.target.closest('[data-call-ca]');
  if (b) { runCheck(b.dataset.callCa); setTimeout(() => window.scrollTo({ top: $('#checkForm').offsetTop - 70, behavior: 'smooth' }), 50); }
});
$('#callsCard').addEventListener('change', (e) => {
  if (e.target.id === 'callsShot') { const f = e.target.files[0]; e.target.value = ''; if (f) callsFromScreenshot(f); }
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
setInterval(() => { if (document.visibilityState === 'visible' && !callState.busy) priceCallBook().then(renderCalls); }, 10 * 60000);
$('#settingsForm').addEventListener('submit', () => setTimeout(pollFeed, 0));
