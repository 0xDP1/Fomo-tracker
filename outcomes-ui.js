/* global Outcomes, Strength, callState, callerOf, readSolBalances, dexPairs, getJson, saveCalls, store, state, renderCalls, esc */
'use strict';
// Call lessons (Calls tab): a snapshot of every call's facts at the call, its true outcome from GeckoTerminal's
// 5-minute candles (read 1 h and 4 h after the call, also for hours the app was closed), the facts that separate
// runners from the rest, an optional plain-English read by Claude Haiku, and a "like past winners" pill on new calls.

const LESSON_TICK_MS = 60000;
const LESSON_GECKO = 'https://api.geckoterminal.com/api/v2/networks/';
const LESSON_READS_PER_TICK = 6; // GeckoTerminal's free limit is about 30 a minute; Recent calls uses up to 10
const LESSON_MODEL = 'claude-haiku-5-5';
const lessonState = { recs: store.get('callLessons', {}), busy: false, ai: store.get('callLessonsAi', null), aiBusy: false, aiError: '', cmp: null };
const H1 = Outcomes.WINDOWS.h1, H4 = Outcomes.WINDOWS.h4;

const lessonCmp = () => lessonState.cmp || (lessonState.cmp = Outcomes.compare(Object.values(lessonState.recs)));

// The top wallets' SOL for a coin the queue checked automatically: { emptyPct, fundedN } or null.
async function callWalletBalances(dex, facts) {
  if (!dex || dex.chainId !== 'solana' || typeof readSolBalances !== 'function' || !facts) return null;
  const hs = (facts._holders || []).filter((h) => !h.tags.some((t) => ['Pool', 'Burned', 'Contract'].includes(t)));
  const addrs = [...new Set(hs.map((h) => h.addr))];
  if (addrs.length < 3) return null;
  try {
    const w = Strength.walletBalances(hs, await readSolBalances(addrs));
    return w && w.n >= 3 ? { emptyPct: w.emptyPct, fundedN: w.fundedN } : null;
  } catch { return null; }
}

// The outcome so far from the candles. (Recent calls reads its own candle highs for its peak.)
function applyOutcome(r, o, now) {
  const done = now >= r.at + H4;
  const out = { m15: o.m15 || null, h1: o.h1 || null, h4: o.h4 || null, base: o.base || null };
  return Object.assign({}, r, { out, label: o.label, fast: !!o.fast, noPool: !!o.noPool, read1h: true, read4h: done, final: done });
}

async function lessonTick() {
  if (lessonState.busy) return;
  lessonState.busy = true;
  let changed = false;
  try {
    const now = Date.now();
    const recs = Object.assign({}, lessonState.recs);
    // 1. Snapshots: new calls, and facts that arrive within 30 minutes of the call.
    for (const e of Object.values(callState.queue)) {
      if (!e.dexAt || !e.address) continue;
      const prev = recs[e.address];
      const s = Outcomes.snapshot(prev, e, callerOf(e.firstPoster), now);
      if (s && s !== prev) { recs[e.address] = Object.assign({}, s, { pool: (prev && prev.pool) || e.pool || '' }); changed = true; }
      // The pill is set while the call is fresh, from calls whose outcome is already known (never its own).
      const r = recs[e.address];
      if (r && e.like === undefined && now - r.at <= Outcomes.SNAP_FILL_MS) {
        const like = Outcomes.likeRunners(r.facts, lessonCmp());
        if (like) { callState.queue[e.address] = Object.assign({}, e, { like }); saveCalls(); }
      }
    }
    // 2. Outcomes due: 1 h and 4 h after the call.
    const due = Object.entries(recs).filter(([, r]) => !r.final && ((now >= r.at + H1 && !r.read1h) || now >= r.at + H4)).sort((x, y) => x[1].at - y[1].at).slice(0, LESSON_READS_PER_TICK);
    const noPool = due.filter(([a, r]) => !r.pool && !(callState.queue[a] && callState.queue[a].pool)).map(([a]) => a);
    const pairs = noPool.length ? await dexPairs(noPool) : {};
    for (const [a, r0] of due) {
      let r = r0;
      const pool = r.pool || (callState.queue[a] && callState.queue[a].pool) || (pairs[a] && pairs[a].pairAddress) || '';
      if (!pool) {
        if (pairs[a] === null) { recs[a] = applyOutcome(r, Outcomes.outcome([], r.at, null, now, { noPool: true }), now); changed = true; }
        continue; // undefined: DexScreener didn't answer, try next minute
      }
      if (pool !== r.pool) r = Object.assign({}, r, { pool });
      const net = Outcomes.GECKO_NET[r.chain];
      if (!net) { recs[a] = Object.assign({}, r, { final: true, read1h: true, read4h: true, label: null, skipped: 'chain' }); changed = true; continue; }
      const before = Math.ceil(Math.min(now, r.at + H4 + 5 * 60000) / 1000);
      try {
        const j = await getJson(`${LESSON_GECKO}${net}/pools/${encodeURIComponent(pool)}/ohlcv/minute?aggregate=5&limit=60&currency=usd&token=base&before_timestamp=${before}`, { timeout: 15000 });
        recs[a] = applyOutcome(r, Outcomes.outcome(Outcomes.candlesFrom(j), r.at, r.price, now), now);
        changed = true;
      } catch (err) {
        if (/429/.test(err.message)) break; // GeckoTerminal says slow down: the rest wait for the next minute
      }
    }
    if (changed) {
      lessonState.recs = Outcomes.prune(recs);
      lessonState.cmp = null;
      store.set('callLessons', lessonState.recs);
    }
  } finally {
    lessonState.busy = false;
  }
  if (changed && typeof renderCalls === 'function') renderCalls();
}

const fmtFact = (v, fmt) => {
  if (v == null) return '–';
  if (fmt === 'usd') return v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
  if (fmt === 'pct') return `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`;
  if (fmt === 'x') return `${v.toFixed(1)}×`;
  if (fmt === 'min') return v >= 120 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`;
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10);
};

// The "like past winners" pill on a queue row.
function likePill(e) {
  const l = e && e.like;
  if (!l || !l.of) return '';
  const cls = l.n / l.of >= 0.8 ? 'hi' : l.n / l.of >= 0.4 ? 'ok' : 'lo';
  return ` <span class="like-pill ${cls}" title="At the call it shared ${l.n} of the ${l.of} facts that best separate past runners (2× within 4 h) from the rest">${l.n}/${l.of} like runners</span>`;
}

// The Call lessons section.
function lessonsHtml() {
  const recs = Object.values(lessonState.recs);
  if (!recs.length) return '';
  const c = lessonCmp();
  const pending = recs.filter((r) => !r.final && !r.label).length;
  const rows = c.rows.slice(0, 10);
  const table = rows.length
    ? `<div class="table-wrap"><table class="calls-score lessons-table"><thead><tr><th>At the call</th><th class="num">Runners</th><th class="num">Rest</th><th class="num">Separates</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${fmtFact(r.runnerMedian, r.fmt)}</td><td class="num">${fmtFact(r.restMedian, r.fmt)}</td><td class="num"><b class="${r.sep >= 0.4 ? 'pos' : ''}">${Math.round(r.sep * 100)}%</b> <span class="muted">${r.higher ? 'higher' : 'lower'}</span></td></tr>`).join('')}
      </tbody></table></div>`
    : `<p class="muted small">Needs 3+ runners and 3+ other calls with a known outcome to compare (so far ${c.runners} runner${c.runners === 1 ? '' : 's'}, ${c.rest} other${c.rest === 1 ? '' : 's'}).</p>`;
  const key = state.settings && state.settings.anthropicKey;
  const ai = lessonState.ai;
  const aiBlock = lessonState.aiBusy ? '<p class="muted small">Claude is reading the patterns…</p>'
    : lessonState.aiError ? `<p class="neg small">${esc(lessonState.aiError)}</p>`
    : ai ? `<div class="lessons-ai small"><p class="muted">Claude's read (${new Date(ai.at).toLocaleString()}, ${ai.runners} runners of ${ai.calls} calls):</p>${ai.text.split(/\n+/).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : '';
  const aiBtn = c.runners >= 3 && key ? `<button type="button" class="btn mini" id="lessonsAiBtn" ${lessonState.aiBusy ? 'disabled' : ''}>Read the patterns</button> <span class="muted small">Claude Haiku, about 1¢</span>` : c.runners >= 3 ? '<span class="muted small">Add an Anthropic key in Settings for a plain-English read of the patterns.</span>' : '';
  return `<details class="adv calls-sec" data-sec="lessons" ${callState.open.lessons === false ? '' : 'open'}><summary>Call lessons (${c.runners} runner${c.runners === 1 ? '' : 's'} of ${c.runners + c.rest} calls)</summary>
    <p class="muted small">What coins looked like at the call: runners (2× within 4 h${c.fast ? `, ${c.fast} of them within 1 h` : ''}) against the rest (${c.dead} dead: under 0.3× at 4 h). Outcomes come from 5-minute price candles 1 h and 4 h after each call, so moves while the app was closed count.${pending ? ` ${pending} call${pending === 1 ? '' : 's'} still waiting for an outcome.` : ''}</p>
    ${table}
    ${rows.length ? '<p class="muted small">Separates: how often a runner\'s value beat another call\'s (0% = no difference, 100% = always). Few runners means these can be luck.</p>' : ''}
    <div class="row gap wrap">${aiBtn}</div>${aiBlock}
    <p class="muted small">The "like runners" pill on new calls appears after ${Outcomes.MIN_RUNNERS} runners (now ${c.runners}) and has its own row in the Signal scorecard.</p></details>`;
}

// Claude Haiku explains the table and the best and worst calls, from these numbers only.
async function readLessons() {
  const key = state.settings.anthropicKey;
  if (!key || lessonState.aiBusy) return;
  const c = lessonCmp();
  const done = Object.values(lessonState.recs).filter((r) => r.label && r.out);
  const peakOf = (r) => Math.max(...[r.out.m15, r.out.h1, r.out.h4].filter(Boolean).map((w) => w.peak), 0);
  const brief = (r) => ({ symbol: r.symbol, outcome: r.label + (r.fast ? ' (fast)' : ''), peakX: +peakOf(r).toFixed(2), facts: r.facts });
  const sorted = done.slice().sort((x, y) => peakOf(y) - peakOf(x));
  const evidence = {
    runners: c.runners, others: c.rest, dead: c.dead,
    facts: c.rows.slice(0, 12).map((r) => ({ fact: r.label, runnersMedian: r.runnerMedian, restMedian: r.restMedian, separates: +r.sep.toFixed(2), runnersHigher: r.higher, nRunners: r.nRunners, nRest: r.nRest })),
    best: sorted.slice(0, 5).map(brief), worst: sorted.slice(-5).map(brief),
  };
  Object.assign(lessonState, { aiBusy: true, aiError: '' });
  renderCalls();
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: LESSON_MODEL, max_tokens: 800,
        system: 'You explain to a memecoin trader which facts at the moment a coin was called separated the runners (2x within 4 hours) from the rest, using only the numbers given. "separates" is how often a runner\'s value beat another call\'s, rescaled so 0 is no difference and 1 is always. Write 3 to 6 short plain-English lines, no headings, no markdown: the patterns that look real (strong separation with enough calls), the ones that look like noise or small-sample luck, and one line on what to watch for in new calls. Say plainly when there are too few runners to trust anything. Never invent numbers or facts that are not in the evidence.',
        messages: [{ role: 'user', content: 'Evidence (JSON):\n' + JSON.stringify(evidence) }],
      }),
    });
    if (r.status === 401) throw new Error('Anthropic rejected the API key.');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || `Anthropic HTTP ${r.status}`);
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) throw new Error('The read came back empty. Try again.');
    lessonState.ai = { text, at: Date.now(), runners: c.runners, calls: c.runners + c.rest };
    store.set('callLessonsAi', lessonState.ai);
  } catch (e) {
    lessonState.aiError = e.message;
  } finally {
    lessonState.aiBusy = false;
    renderCalls();
  }
}

document.addEventListener('click', (e) => { if (e.target.closest('#lessonsAiBtn')) readLessons(); });
setTimeout(lessonTick, 8000);
setInterval(() => { if (document.visibilityState === 'visible') lessonTick(); }, LESSON_TICK_MS);
