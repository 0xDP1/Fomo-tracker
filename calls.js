// Call queue: pure helpers (no DOM, no network). Pull contract addresses and posters out of Discord text
// or Discord API messages, keep one queue entry per coin, rank by safety and age, and score callers.
// Used by the app and by the Discord feed Worker.
(function (root) {
  'use strict';
  const B58 = '1-9A-HJ-NP-Za-km-z';
  const ADDR = new RegExp(`(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])|(?<![${B58}])([${B58}]{32,44})(?![${B58}])`, 'g');
  const IGNORE = new Set([
    'So11111111111111111111111111111111111111112', 'So11111111111111111111111111111111111111111', // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDC, USDT
  ]);
  // "name — Today at 2:41 PM", "name — 10/08/2026 2:41 PM", "name — Yesterday at …"
  const HEADER = /^(.{1,40}?)\s+[—–-]\s+(Today at|Yesterday at|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]+ \d{1,2},? \d{4})/;
  // "[3:04 PM] name: message"
  const BRACKET = /^\[[^\]]{3,20}\]\s*([^:]{1,40}):\s*(.*)$/;

  function addressesIn(text) {
    const out = [];
    for (const m of String(text || '').matchAll(ADDR)) {
      if (m[1]) out.push({ address: m[1].toLowerCase(), chain: 'evm' });
      else if (m[2] && !IGNORE.has(m[2])) out.push({ address: m[2], chain: 'solana' });
    }
    return out;
  }

  // Pasted or shared text, e.g. a copied run of Discord messages.
  function extractCalls(text, now) {
    const calls = [];
    let poster = 'unknown';
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const h = line.match(HEADER);
      if (h && !addressesIn(line).length) { poster = h[1].trim(); continue; }
      const b = line.match(BRACKET);
      const who = b ? b[1].trim() : poster;
      for (const a of addressesIn(b ? b[2] : line)) calls.push(Object.assign(a, { poster: who, at: now }));
    }
    return calls;
  }

  const snowflakeCmp = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);

  // ---- alert bot messages (market snapshot embed + "Last mentions" / "First scan" embed) ----
  const MEDALS = { '🥇': 'gold', '🥈': 'silver', '🥉': 'bronze', '🌱': 'new' };
  const KMB = { K: 1e3, M: 1e6, B: 1e9 };
  const num = (t) => {
    const m = String(t == null ? '' : t).trim().replace(/,/g, '').match(/^([\d.]+)\s*([KMB])?$/i);
    return m ? Number(m[1]) * (m[2] ? KMB[m[2].toUpperCase()] : 1) : null;
  };
  const AGE_UNIT = { m: 60000, h: 3600000, d: 86400000 };
  const ageMs = (t) => { const m = String(t || '').trim().match(/^(\d+(?:\.\d+)?)\s*([mhd])$/i); return m ? Number(m[1]) * AGE_UNIT[m[2].toLowerCase()] : null; };
  const HEAD = /^\*\*\[([^\]]+)\]\([^)]*\)\s*\[([^/\]]+)\/([^\]]*)\]\s*-\s*([^*]+?)\*\*/;
  const MENTION = /^\**\s*(→\s*)?<t:(\d+):[A-Za-z]>\s*[⋅·]\s*(?:<a?:[^>]+>\s*)?(\S{1,8})\s*[⋅·]\s*\[([^\]]+)\]\([^)]*\)\s*@\s*([\d.,]+\s*[KMBkmb]?)\**\s*(?:[⋅·]\s*(🥇|🥈|🥉|🌱)\s*(?:[⋅·]\s*(\d+(?:\.\d+)?)%\s*[⋅·]\s*(\d+)d)?)?/u;
  const STATS = /(🥇|🥈|🥉|🌱)?\s*[⋅·]?\s*[\d.]+x\+\s*hits:\s*\**(\d+(?:\.\d+)?)%\**\s*7d\s*[⋅·]\s*\**(\d+(?:\.\d+)?)%\**\s*30d\s*\((\d+)\s*calls\)\s*[⋅·]\s*30d median\s*\**([\d.]+)x/u;
  const tick = (d, label) => { const m = d.match(new RegExp(label + ':\\s*`([^`]+)`')); return m ? m[1] : null; };

  // One alert -> { address, chain, name, symbol, snap, trigger, first, mentions } or null when it is not an alert.
  function parseAlert(m) {
    const embeds = (m && m.embeds) || [];
    const market = embeds.map((e) => e.description || '').find((d) => /FDV:/.test(d) && /Liq:/.test(d));
    if (!market) return null;
    const ca = market.match(/^`([^`\s]{32,44})`\s*$/m);
    const addr = ca && addressesIn(ca[1])[0];
    if (!addr) return null;
    const head = String(m.content || '').match(HEAD);
    const one = market.match(/1H:\s*`([-+\d.,]+)%?`\s*\S+\s*`([^`]+)`\s*\S+\s*`([^`]+)`/u);
    const th = market.match(/TH:([^\n]*)/);
    const top5 = th ? [...th[1].matchAll(/\[(\d+(?:\.\d+)?)\]\(/g)].map((x) => Number(x[1])) : [];
    const top5Pct = th ? (th[1].match(/`\[(\d+(?:\.\d+)?)%\]`/) || [])[1] : undefined;
    const snap = {
      priceUsd: Number((market.match(/USD:\s*`([\d.eE+-]+)`/) || [])[1]) || null,
      fdv: num(tick(market, 'FDV')), liq: num(tick(market, 'Liq')), vol: num(tick(market, 'Vol')), ageMs: ageMs(tick(market, 'Age')),
      change1h: one ? Number(one[1].replace(/,/g, '')) : null, buys: one ? num(one[2]) : null, sells: one ? num(one[3]) : null,
      holders: num(tick(market, 'Total')), top5, top5Pct: top5Pct === undefined ? null : Number(top5Pct),
    };
    const detail = embeds.map((e) => e.description || '').find((d) => /Last mentions|First scan/.test(d)) || '';
    /** @type {any[]} */
    const mentions = [];
    for (const line of detail.split(/\r?\n/)) {
      const x = line.trim().match(MENTION);
      if (!x) continue;
      mentions.push({ arrow: !!x[1], ts: Number(x[2]) * 1000, group: x[3], caller: x[4], mcap: num(x[5].replace(/\s+/g, '')), medal: x[6] ? MEDALS[x[6]] : null, winRate: x[7] === undefined ? null : Number(x[7]), window: x[8] ? Number(x[8]) : null });
    }
    const st = detail.match(STATS);
    const trigger = mentions.find((x) => x.arrow) || mentions[0] || null;
    if (trigger && st) {
      trigger.stats = { medal: st[1] ? MEDALS[st[1]] : null, hit7: Number(st[2]), hit30: Number(st[3]), calls30: Number(st[4]), median: Number(st[5]) };
      trigger.winRate = trigger.stats.hit30;
      if (trigger.stats.medal) trigger.medal = trigger.stats.medal;
    }
    const first = mentions.length ? mentions.reduce((a, b) => (b.ts < a.ts ? b : a)) : null;
    return { address: addr.address, chain: addr.chain, name: head ? head[1] : '', symbol: head ? head[4].split('/')[0].trim() : '', snap, trigger, first, mentions };
  }

  // Caller profile updates from alert messages: every mention line is a fresh look at that caller's record.
  function callerUpdates(messages) {
    const out = [];
    for (const m of messages || []) {
      const a = parseAlert(m);
      if (!a) continue;
      for (const x of a.mentions) {
        const u = { caller: x.caller, group: x.group, medal: x.medal, winRate: x.winRate, ts: x.ts };
        if (x.stats) Object.assign(u, { hit7: x.stats.hit7, calls30: x.stats.calls30, median: x.stats.median });
        out.push(u);
      }
    }
    return out;
  }

  // profiles: { lowercase name: { name, group, medal, winRate, hit7, calls30, median, calls, updatedAt, lastTs } }.
  // The newest sighting wins; a mention already counted (same or older time) changes nothing; "no data" never erases a rate.
  function applyCallerUpdates(profiles, updates, max = 3000) {
    const out = Object.assign({}, profiles);
    for (const u of (updates || []).slice().sort((a, b) => a.ts - b.ts)) {
      const key = String(u.caller).toLowerCase();
      const cur = out[key];
      if (!cur) {
        out[key] = { name: u.caller, group: u.group || '', medal: u.medal || 'new', winRate: u.winRate == null ? null : u.winRate, hit7: u.hit7 == null ? null : u.hit7, calls30: u.calls30 == null ? null : u.calls30, median: u.median == null ? null : u.median, calls: 1, updatedAt: u.ts, lastTs: u.ts };
        continue;
      }
      if (!(u.ts > cur.lastTs)) continue;
      const next = Object.assign({}, cur, { name: u.caller, group: u.group || cur.group, calls: cur.calls + 1, lastTs: u.ts, updatedAt: u.ts });
      if (u.winRate != null) { next.winRate = u.winRate; next.medal = u.medal || cur.medal; }
      else if (u.medal && cur.winRate == null) next.medal = u.medal;
      if (u.hit7 != null) next.hit7 = u.hit7;
      if (u.calls30 != null) next.calls30 = u.calls30;
      if (u.median != null) next.median = u.median;
      out[key] = next;
    }
    const keys = Object.keys(out);
    if (keys.length > max) {
      keys.sort((a, b) => out[b].updatedAt - out[a].updatedAt);
      return Object.fromEntries(keys.slice(0, max).map((k) => [k, out[k]]));
    }
    return out;
  }

  // Links to a wallet page or a pool page carry addresses that are not coins.
  const stripNoise = (t) => String(t || '').replace(/https?:\/\/(?:www\.)?(?:solscan\.io|dexscreener\.com|birdeye\.so\/(?:profile|wallet))[^\s)>\]]*/gi, ' ');

  // Discord API message objects (content plus embeds, which alert bots use), oldest first.
  function fromDiscordMessages(messages) {
    const calls = [];
    for (const m of (messages || []).slice().sort((x, y) => snowflakeCmp(String(x.id), String(y.id)))) {
      const alert = parseAlert(m);
      if (alert) {
        // The bot that posts alerts is not the caller: credit the caller on the arrow line, and take only the real contract.
        const t = alert.trigger;
        calls.push({ address: alert.address, chain: alert.chain, poster: t ? t.caller : ((m.author && (m.author.global_name || m.author.username)) || 'unknown'), at: t ? t.ts : (Date.parse(m.timestamp) || 0), messageId: String(m.id), symbol: alert.symbol, name: alert.name, mcap: t && t.mcap ? t.mcap : alert.snap.fdv, group: t ? t.group : '', callerWin: t ? t.winRate : null, callerMedal: t ? t.medal : null, snap: alert.snap, first: alert.first ? { caller: alert.first.caller, ts: alert.first.ts, mcap: alert.first.mcap, group: alert.first.group } : null });
        continue;
      }
      const parts = [m.content];
      for (const e of m.embeds || []) { parts.push(e.title, e.description, e.url); for (const f of e.fields || []) parts.push(f.name, f.value); }
      const poster = (m.author && (m.author.global_name || m.author.username)) || 'unknown';
      const at = Date.parse(m.timestamp) || 0;
      const seen = new Set();
      for (const a of addressesIn(stripNoise(parts.filter(Boolean).join('\n')))) {
        if (seen.has(a.address)) continue;
        seen.add(a.address);
        calls.push(Object.assign(a, { poster, at, messageId: String(m.id) }));
      }
    }
    return calls;
  }

  // queue: { address: { address, chain, mentions, posters, firstPoster, firstAt, lastAt, ...research } }
  function addToQueue(queue, calls) {
    const q = Object.assign({}, queue);
    for (const c of calls || []) {
      const e = q[c.address] ? Object.assign({}, q[c.address], { posters: q[c.address].posters.slice(), channels: (q[c.address].channels || []).slice() }) : { address: c.address, chain: c.chain, mentions: 0, posters: [], channels: [], firstPoster: c.poster, firstAt: c.at, lastAt: c.at };
      e.mentions += 1;
      if (c.channel && !e.channels.includes(c.channel)) e.channels.push(c.channel);
      if (c.symbol && !e.symbol) e.symbol = c.symbol;
      if (c.snap && c.at >= (e.snapAt || 0)) { e.snap = c.snap; e.snapAt = c.at; }
      if (c.mcap && e.callMcap == null) e.callMcap = c.mcap;
      // The alert lists every earlier mention: the earliest one is the real first caller and the price they got.
      if (c.first && c.first.ts < e.firstAt) {
        e.firstAt = c.first.ts; e.firstPoster = c.first.caller; if (c.first.mcap) e.callMcap = c.first.mcap;
        if (!e.posters.includes(c.first.caller)) e.posters.push(c.first.caller);
      }
      if (!e.posters.includes(c.poster)) e.posters.push(c.poster);
      if (c.at < e.firstAt) { e.firstAt = c.at; e.firstPoster = c.poster; }
      if (c.at > e.lastAt) e.lastAt = c.at;
      q[c.address] = e;
    }
    return q;
  }

  const isFresh = (item, now, maxAgeMs) => item.launchedAt > 0 && now - item.launchedAt <= maxAgeMs;

  const VERDICT_ORDER = { 'Looks OK': 0, Caution: 1, 'High risk': 3, 'Walk away': 4 };
  const vRank = (v) => (v in VERDICT_ORDER ? VERDICT_ORDER[v] : 2);
  const rank = (items) => (items || []).slice().sort((a, b) => (vRank(a.verdict) - vRank(b.verdict)) || ((b.launchedAt || 0) - (a.launchedAt || 0)));

  // Call score, 0-100, from what the queue already knows (no extra requests). profile: the first caller's alert
  // profile { winRate, medal }. Points: caller up to 30, traction 25, clean launch 25, not pumped 10, fresh 10;
  // red flags take points off. Reasons are the best few plus every red flag.
  const SCORE_FRESH_MS = 2 * 3600000;
  const MEDAL_PTS = { gold: 6, silver: 4, bronze: 2 };
  const MEDAL_ICON = { gold: '🥇', silver: '🥈', bronze: '🥉' };
  function callScore(e, profile, now) {
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const good = [], flags = [];
    const prof = profile || {};
    // Caller: 30-day win rate (20% -> 0, 70%+ -> 24) plus the medal.
    const win = num(prof.winRate);
    const caller = Math.min(30, (win == null ? 0 : Math.max(0, Math.min(1, (win - 20) / 50)) * 24) + (MEDAL_PTS[prof.medal] || 0));
    if (win != null && caller >= 12) good.push({ pts: caller, text: `${MEDAL_ICON[prof.medal] ? MEDAL_ICON[prof.medal] + ' ' : ''}${Math.round(win)}% caller` });
    // Traction: several callers, or the "traction" channel.
    const posters = (e.posters || []).length;
    const tractionCh = (e.channels || []).find((c) => /traction/i.test(c));
    const traction = Math.min(25, (posters >= 4 ? 20 : posters === 3 ? 15 : posters === 2 ? 10 : 0) + (tractionCh ? 10 : 0));
    if (posters >= 2) good.push({ pts: posters >= 4 ? 20 : posters === 3 ? 15 : 10, text: `${posters} callers` });
    if (tractionCh) good.push({ pts: 10, text: `in ${tractionCh}` });
    // Clean launch: bundled %, top 5 wallets, liquidity for its size. Unknowns get a little, never full marks.
    const b = e.bundle && e.bundle.scanned ? num(e.bundle.bundledPct) : null;
    const top5 = e.snap ? num(e.snap.top5Pct) : null;
    const liq = num(e.liq), mcap = num(e.mcap);
    const bPts = b == null ? 5 : b < 15 ? 10 : b < 30 ? 5 : 0;
    const tPts = top5 == null ? 3 : top5 < 20 ? 8 : top5 < 30 ? 5 : 0;
    const ratio = liq != null && mcap ? liq / mcap : null;
    const lPts = ratio == null ? 0 : ratio >= 0.1 ? 7 : ratio >= 0.05 ? 4 : 0;
    const clean = bPts + tPts + lPts;
    if (b != null && b < 15) good.push({ pts: bPts, text: `${Math.round(b)}% bundled` });
    if (top5 != null && top5 < 20) good.push({ pts: tPts, text: `top 5 hold ${Math.round(top5)}%` });
    // Not already pumped since the first call.
    const x = mcap && num(e.callMcap) ? mcap / e.callMcap : null;
    const pumped = x == null ? 5 : x <= 1.5 ? 10 : x <= 3 ? 5 : 0;
    // Fresh: first called within 2 hours (half marks within 6).
    const age = now - (num(e.firstAt) || 0);
    const fresh = age <= SCORE_FRESH_MS ? 10 : age <= 3 * SCORE_FRESH_MS ? 5 : 0;
    // Red flags.
    let minus = 0;
    const flag = (pts, text) => { minus += pts; flags.push(text); };
    if (e.verdict === 'Walk away') flag(50, 'Walk away');
    else if (e.verdict === 'High risk') flag(30, 'High risk');
    if (b != null && b > 40) flag(25, `${Math.round(b)}% bundled`);
    if (top5 != null && top5 > 45) flag(25, `top 5 hold ${Math.round(top5)}%`);
    if (e.bundle && e.bundle.serial) flag(15, 'serial bundler dev');
    if (prof.medal === 'new' && win == null) flag(10, 'caller has no record');
    if (x != null && x > 3) flags.push(`already ${x.toFixed(1)}× since the call`);
    // Wallet memory (filled in for the best coins when GMGN is set up): known rug or runner wallets holding it.
    const wm = e.wm || {};
    if (wm.rug >= 2) flag(25, `${wm.rug} rug wallets in`);
    const bonus = wm.runner >= 2 ? 10 : 0;
    if (bonus) good.push({ pts: bonus, text: `${wm.runner} runner wallets in` });
    const score = Math.max(0, Math.min(100, Math.round(caller + traction + clean + pumped + fresh + bonus - minus)));
    return { score, parts: { caller: Math.round(caller), traction, clean, pumped, fresh, bonus, minus }, reasons: good.sort((a, z) => z.pts - a.pts).slice(0, 3).map((r) => r.text), flags };
  }

  // book: paper calls { poster, ret: { '1h' | '6h' | '24h': number | 'missed' } }
  function callerStats(book) {
    const by = new Map();
    for (const x of book || []) {
      if (!by.has(x.poster)) by.set(x.poster, []);
      by.get(x.poster).push(x);
    }
    const mark = (list, k) => { const rs = list.map((x) => (x.ret || {})[k]).filter((r) => typeof r === 'number'); return { n: rs.length, up: rs.filter((r) => r > 0).length, avg: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null }; };
    const rows = [...by.entries()].map(([poster, list]) => ({ poster, calls: list.length, h1: mark(list, '1h'), h6: mark(list, '6h'), h24: mark(list, '24h') }));
    const avg6 = (r) => (r.h6.avg == null ? -Infinity : r.h6.avg);
    return rows.sort((a, b) => (b.calls - a.calls) || (avg6(b) - avg6(a)) || a.poster.localeCompare(b.poster));
  }

  const api = { addressesIn, extractCalls, fromDiscordMessages, parseAlert, callerUpdates, applyCallerUpdates, addToQueue, isFresh, rank, callerStats, callScore, snowflakeCmp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calls = api;
})(typeof window !== 'undefined' ? window : globalThis);
