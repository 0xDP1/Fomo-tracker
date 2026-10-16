// Worker alerts (docs/features/worker-alerts.md): every 5 minutes the Worker prices the last day's calls and messages a
// Telegram bot on 2×, 4× and big moves, so you hear about a runner while the app is closed. Pure helpers, no network:
// the rules are the app's own (recent.js), so a Worker alert and an app alert agree.
(function (root) {
  'use strict';
  const Recent = typeof module !== 'undefined' && module.exports ? require('../recent.js') : root.Recent;
  const Calls = typeof module !== 'undefined' && module.exports ? require('../calls.js') : root.Calls;
  const MAX_AGE_MS = 24 * 3600000;   // calls older than this are not priced by the Worker
  const BATCH = 30;                  // DexScreener addresses per request
  const SENT_KEEP = 50;

  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const money = (v) => (v == null ? '?' : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
  const ago = (ms) => (ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}m` : ms < 86400000 ? `${Math.round(ms / 3600000)}h` : `${Math.round(ms / 86400000)}d`);

  // The Worker's stored calls -> the queue shape recent.js prices: one entry per address, first poster and call price.
  function queueFrom(calls, now, maxAgeMs = MAX_AGE_MS) {
    const q = {};
    for (const c of (calls || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0))) {
      if (!c || !c.address || !c.at || now - c.at > maxAgeMs) continue;
      const price = n(c.mcap) || n(c.snap && c.snap.fdv);
      const e = q[c.address] || (q[c.address] = { address: c.address, chainId: c.chain || 'solana', firstAt: c.at, firstPoster: c.poster || '', symbol: '', channels: [], sources: [], callMcap: null });
      if (!e.symbol && c.symbol) e.symbol = c.symbol;
      if (e.callMcap == null && price > 0) e.callMcap = price;
      if (c.channel && !e.channels.includes(c.channel)) e.channels.push(c.channel);
      if (c.source && !e.sources.includes(c.source)) e.sources.push(c.source);
    }
    return q;
  }

  const batches = (addrs, size = BATCH) => { const out = []; for (let i = 0; i < addrs.length; i += size) out.push(addrs.slice(i, i + size)); return out; };

  // DexScreener's pairs -> the deepest pool per token address.
  function bestPairs(pairs) {
    const out = {};
    for (const p of pairs || []) {
      const a = p && p.baseToken && p.baseToken.address;
      if (!a) continue;
      const liq = n(p.liquidity && p.liquidity.usd) || 0;
      if (!out[a] || liq > (n(out[a].liquidity && out[a].liquidity.usd) || 0)) out[a] = p;
    }
    return out;
  }

  // One pricing round: the app's level alerts (2×, 4×) and move / volume alerts, one per coin per round.
  function round(track, queue, pairs, now) {
    const mcaps = {};
    for (const [a, p] of Object.entries(pairs || {})) { const m = n(p.marketCap) || n(p.fdv); if (m) mcaps[a] = m; }
    const u = Recent.update(track || {}, queue, mcaps, now);
    const rest = Object.fromEntries(Object.entries(pairs || {}).filter(([a]) => !u.alerts.some((x) => x.address === a)));
    const mv = Recent.moves(u.track, rest, now);
    return { track: mv.track, alerts: u.alerts.concat(mv.alerts) };
  }

  // What matters for storage: a new base, peak or alert. "last" moves every round and is not worth a write.
  const key = (t) => JSON.stringify(Object.fromEntries(Object.entries(t || {}).map(([a, r]) => [a, [r.base, r.peak, r.alerted, r.moveAlertAt, r.server && r.server.messageId]])));
  const changed = (before, after) => key(before) !== key(after);

  // The Telegram text for one alert. Plain text, no markup to escape.
  function message(al, rec, entry, now) {
    const sym = al.symbol || (entry && entry.symbol) || (al.address || '').slice(0, 6);
    const who = entry && entry.firstPoster ? ` · ${entry.firstPoster}${entry.channels && entry.channels[0] ? ' in ' + entry.channels[0] : ''}` : '';
    const when = entry && entry.firstAt ? `, called ${ago(now - entry.firstAt)} ago` : '';
    let head;
    if (al.level) head = `🚀 ${sym} ${al.level}× since the call (${money(rec && rec.base)} → ${money(rec && rec.last)})`;
    else if (al.kind === 'move') head = `📈 ${sym} +${Math.round(al.change)}% in 5 min on ${money(al.vol5)} · mcap ${money(al.mcap)}`;
    else head = `📊 ${sym} ${money(al.vol5)} traded in 5 min, ${al.pace.toFixed(1)}× the hour's pace · mcap ${money(al.mcap)}`;
    return `${head}${who}${when}\n${al.address}`;
  }

  // The chat to message: the newest private message the bot received (the owner sends it anything once).
  function chatIdFrom(updates) {
    const list = Array.isArray(updates) ? updates : (updates && updates.result) || [];
    let id = null;
    for (const u of list) { const c = u && u.message && u.message.chat; if (c && c.id != null && (c.type === 'private' || !c.type)) id = String(c.id); }
    return id;
  }

  const remember = (sent, item) => (sent || []).concat(item).slice(-SENT_KEEP);

  // ---- Price-move alerts (docs/features/price-move-alerts.md): the alert bot's own "price move" channel ----
  // One message from that channel -> { address, symbol, x, ath, base, now, caller, group, calledAt, messageId } or null.
  // x is the bot's "Now: 3.9x" line, else the current FDV over the first call's market cap, one decimal.
  const isMoveChannel = (label) => /price[\s_-]*move/i.test(String(label || ''));
  const round1 = (v) => Math.round(v * 10) / 10;
  function priceMove(m, channelLabel) {
    if (!isMoveChannel(channelLabel) || !Calls) return null;
    const a = Calls.parseAlert(m);
    if (!a || !a.address) return null;
    const text = ((m && m.embeds) || []).map((e) => e.description || '').join('\n');
    const nowX = text.match(/Now:\s*([\d.]+)x/i);
    const athX = text.match(/ATH:\s*([\d.]+)x/i);
    const base = a.first && n(a.first.mcap) > 0 ? n(a.first.mcap) : null;
    const now = n(a.snap && a.snap.fdv);
    const x = nowX ? n(nowX[1]) : base && now ? round1(now / base) : null;
    if (!x || x <= 1) return null;
    return {
      address: a.address, symbol: a.symbol || '', x, ath: athX ? n(athX[1]) : null, base, now,
      caller: a.first ? a.first.caller : '', group: a.first ? a.first.group : '', calledAt: a.first ? a.first.ts : null,
      messageId: String((m && m.id) || ''),
    };
  }

  // The Telegram text for a price-move alert: the bot's multiple, the call and who made it.
  function moveMessage(mv, now) {
    const sym = mv.symbol || mv.address.slice(0, 6);
    const who = mv.caller ? ` · ${mv.caller}${mv.group ? ' in ' + mv.group : ''}` : '';
    const when = mv.calledAt ? `, called ${ago(now - mv.calledAt)} ago` : '';
    const ath = mv.ath ? ` · ATH ${mv.ath}×` : '';
    return `🚀 ${sym} ${mv.x}× since the call (${money(mv.base)} → ${money(mv.now)})${who}${when}${ath}\n${mv.address}`;
  }

  // Folds a price-move alert into the alert state { track, sent }: the coin counts as covered by the channel (2× and
  // 4× marked done, so the pricing round stays quiet on it), its base is the call, its peak at least the bot's figure.
  // -> { al, send }: send is false when this message was already handled.
  function applyMove(al, mv, now) {
    const track = Object.assign({}, (al && al.track) || {});
    const prev = track[mv.address];
    if (prev && prev.server && prev.server.messageId === mv.messageId) return { al, send: false };
    const r = prev ? Object.assign({}, prev, { alerted: (prev.alerted || []).slice() }) : { at: mv.calledAt || now, base: null, baseAt: null, last: null, lastAt: null, peak: null, peakAt: null, alerted: [], symbol: mv.symbol, chain: 'solana', poster: mv.caller || '', channels: mv.group ? [mv.group] : [], sources: ['discord'] };
    if (!r.symbol && mv.symbol) r.symbol = mv.symbol;
    if (mv.base > 0) { r.base = mv.base; r.baseAt = mv.calledAt || r.baseAt || now; r.baseFrom = 'call'; }
    if (mv.now > 0) { r.last = mv.now; r.lastAt = now; if (r.peak == null || mv.now > r.peak) { r.peak = mv.now; r.peakAt = now; } }
    for (const lv of Recent.ALERT_X) if (!r.alerted.includes(lv)) r.alerted.push(lv);
    r.server = { x: mv.x, ath: mv.ath, at: now, messageId: mv.messageId };
    track[mv.address] = r;
    return { al: Object.assign({}, al, { track }), send: true };
  }

  const api = { MAX_AGE_MS, BATCH, SENT_KEEP, queueFrom, batches, bestPairs, round, changed, message, chatIdFrom, remember, money, isMoveChannel, priceMove, moveMessage, applyMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlertsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
