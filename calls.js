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

  // ---- Rick's Telegram alerts (plain text: "💎 FDV: 886K ⇨ 1.2M [13m]", "💨 You are first @ 886.7K", "└ caller ⋅ 2x: …") ----
  // -> { address, chain, name, symbol, snap, caller, mcap } or null when the text is not an alert.
  const RICK_NUM = '\\$?([\\d.,]+\\s*[KMB]?)';
  const rickField = (t, label) => { const m = t.match(new RegExp('(?:^|[\\s⋅·])' + label + ':\\s*' + RICK_NUM, 'imu')); return m ? num(m[1].replace(/\s+/g, '')) : null; };
  function parseRickText(text) {
    const t = String(text || '');
    if (!/^\W*\s*USD:\s*\$?[\d.]/m.test(t) || !/FDV:\s*\$?[\d.]/.test(t) || !/Liq:/.test(t)) return null;
    const addr = addressesIn(stripNoise(t))[0];
    if (!addr) return null;
    const head = t.split(/\r?\n/)[0].match(/^\W*\s*(.*?)\s*\[[^\]]*\]\s*\$([A-Za-z0-9_.-]+)/u);
    const one = t.match(/1H:\s*\$?[\d.,]+\s*[KMB]?\s*[⋅·]\s*([-+]?[\d.,]+)%/iu);
    const th = t.match(/TH:\s*([\d.]+(?:\s*[⋅·]\s*[\d.]+)*)\s*(?:\[(\d+(?:\.\d+)?)%\])?/u);
    const age = t.match(/Age:\s*(\d+(?:\.\d+)?\s*[mhd])\b/i);
    const first = t.match(/You are first @\s*\$?([\d.,]+\s*[KMB]?)[^\n]*\n\s*└\s*@?([^\s⋅·]+)/iu);
    const snap = {
      priceUsd: Number((t.match(/USD:\s*\$?([\d.eE+-]+)/) || [])[1]) || null,
      fdv: rickField(t, 'FDV'), liq: rickField(t, 'Liq'), vol: rickField(t, 'Vol'), ageMs: age ? ageMs(age[1].replace(/\s+/g, '')) : null,
      change1h: one ? Number(one[1].replace(/,/g, '')) : null, buys: null, sells: null,
      holders: rickField(t, 'Total'), top5: th ? th[1].split(/[⋅·]/).map((x) => Number(x.trim())) : [], top5Pct: th && th[2] ? Number(th[2]) : null,
    };
    return { address: addr.address, chain: addr.chain, name: head ? head[1] : '', symbol: head ? head[2] : '', snap, caller: first ? first[2] : null, mcap: first ? num(first[1].replace(/\s+/g, '')) : snap.fdv };
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
      const rick = !(m.embeds || []).length ? parseRickText(m.content) : null;
      if (rick) {
        const who = rick.caller || (m.author && (m.author.global_name || m.author.username)) || 'unknown';
        calls.push({ address: rick.address, chain: rick.chain, poster: who, at: Date.parse(m.timestamp) || 0, messageId: String(m.id), symbol: rick.symbol, name: rick.name, mcap: rick.mcap, snap: rick.snap });
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

  // Where a call came from: 'telegram' (marked by the feed Worker), 'discord' (any other feed channel), or '' (pasted).
  const sourceOf = (c) => (c && c.source === 'telegram' ? 'telegram' : c && c.channel ? 'discord' : '');
  // A queue entry's sources; entries saved before sources were kept came from Discord when they have a channel.
  const sourcesOf = (e) => (e && Array.isArray(e.sources) ? e.sources : e && (e.channels || []).length ? ['discord'] : []);

  // Telegram groups a coin was posted in. groups is kept since v75; older entries (and Recent calls records) only have
  // channels, so a channel named like one of the feed's Telegram groups (tgLabels) counts too.
  function groupsOf(e, tgLabels) {
    const out = e && Array.isArray(e.groups) ? e.groups.slice() : [];
    const known = new Set(tgLabels || []);
    for (const c of (e && e.channels) || []) if (known.has(c) && !out.includes(c)) out.push(c);
    return out;
  }
  // The name on the tag ("The Man Cave" -> "Man Cave"), and its colour: the group's place in the Worker's TG_CHAT list
  // (so two groups never share one), or a hash of the name for a group not in the list.
  const GROUP_COLORS = 6;
  const groupShort = (label) => String(label || '').replace(/^the\s+(?=\S)/i, '').trim() || String(label || '');
  function groupColor(label, tgLabels) {
    const i = (tgLabels || []).indexOf(label);
    if (i >= 0) return i % GROUP_COLORS;
    let h = 0;
    for (const ch of String(label || '').toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % GROUP_COLORS;
  }

  // queue: { address: { address, chain, mentions, posters, channels, sources, groups, firstPoster, firstAt, lastAt, ...research } }
  function addToQueue(queue, calls) {
    const q = Object.assign({}, queue);
    for (const c of calls || []) {
      const e = q[c.address] ? Object.assign({}, q[c.address], { posters: q[c.address].posters.slice(), channels: (q[c.address].channels || []).slice(), sources: sourcesOf(q[c.address]).slice(), groups: (q[c.address].groups || []).slice() }) : { address: c.address, chain: c.chain, mentions: 0, posters: [], channels: [], sources: [], groups: [], firstPoster: c.poster, firstAt: c.at, lastAt: c.at };
      e.mentions += 1;
      if (c.channel && !e.channels.includes(c.channel)) e.channels.push(c.channel);
      const src = sourceOf(c);
      if (src && !e.sources.includes(src)) e.sources.push(src);
      if (src === 'telegram' && c.channel && !e.groups.includes(c.channel)) e.groups.push(c.channel);
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

  // DexScreener pair -> market cap on the alert's basis: FDV first (the alert and its caller mentions give FDV).
  const liveMcap = (p) => (p ? Number(p.fdv) || Number(p.marketCap) || null : null);
  // Move since the call from the newest reading: a live refresh (e.live { mcap, at }) or the alert / first lookup
  // (e.mcap, read at snapAt for an alert, dexAt for a lookup). { from, to, pct, x, at } or null.
  function moveSince(e) {
    const from = Number(e && e.callMcap) || 0;
    if (!from) return null;
    const baseAt = (e.fromAlert ? e.snapAt : e.dexAt) || 0;
    const live = e.live && Number(e.live.mcap) > 0 && (e.live.at || 0) >= baseAt ? e.live : null;
    const to = live ? Number(live.mcap) : Number(e.mcap) || 0;
    if (!to) return null;
    return { from, to, pct: (to / from - 1) * 100, x: to / from, at: live ? live.at : baseAt };
  }

  // The market cap at the call (docs/features/call-price.md): the call's own (alert, Rick's "first @"), else Recent calls'
  // base when it came from the candle at the call or a read within 5 minutes of it, else the first price seen.
  // -> { mcap, late, lateMin } (late: first seen more than 5 minutes after the call) or null.
  const CALL_LATE_MS = 5 * 60000;
  function callPrice(e, rec) {
    const own = Number(e && e.callMcap);
    if (own > 0) return { mcap: own, late: false, lateMin: 0 };
    const seen = (mcap, delay) => (delay > CALL_LATE_MS ? { mcap, late: true, lateMin: Math.round(delay / 60000) } : { mcap, late: false, lateMin: 0 });
    if (rec && Number(rec.base) > 0) return seen(Number(rec.base), rec.baseFrom === 'candles' || !rec.baseAt || !rec.at ? 0 : rec.baseAt - rec.at);
    if (e && Number(e.mcap) > 0) return seen(Number(e.mcap), e.dexAt && e.firstAt ? e.dexAt - e.firstAt : 0);
    return null;
  }

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
    // Clean launch: bundle, top 5 wallets, liquidity for its size. Unknowns get a little, never full marks.
    // The bundle counts what is still held when a check or a Dev check has read it, else what was bundled at launch.
    const b = e.bundle && e.bundle.scanned ? num(e.bundle.bundledPct) : null;
    const held = num(e.deep && e.deep.heldPct) ?? num(e.facts && e.facts.insiderPct);
    const top5 = e.snap ? num(e.snap.top5Pct) : null;
    const liq = num(e.liq), mcap = num(e.mcap);
    const bv = held ?? b;
    const bPts = bv == null ? 5 : bv < 15 ? 10 : bv < 30 ? 5 : 0;
    const tPts = top5 == null ? 3 : top5 < 20 ? 8 : top5 < 30 ? 5 : 0;
    const ratio = liq != null && mcap ? liq / mcap : null;
    const lPts = ratio == null ? 0 : ratio >= 0.1 ? 7 : ratio >= 0.05 ? 4 : 0;
    const clean = bPts + tPts + lPts;
    if (held != null && held < 15) good.push({ pts: bPts, text: `${Math.round(held)}% bundle held` });
    else if (held == null && b != null && b < 15) good.push({ pts: bPts, text: `${Math.round(b)}% bundled` });
    if (top5 != null && top5 < 20) good.push({ pts: tPts, text: `top 5 hold ${Math.round(top5)}%` });
    // Not already pumped since the first call.
    const mv = moveSince(e);
    const x = mv ? mv.x : null;
    const pumped = x == null ? 5 : x <= 1.5 ? 10 : x <= 3 ? 5 : 0;
    // Fresh: first called within 2 hours (half marks within 6).
    const age = now - (num(e.firstAt) || 0);
    const fresh = age <= SCORE_FRESH_MS ? 10 : age <= 3 * SCORE_FRESH_MS ? 5 : 0;
    // Red flags.
    let minus = 0;
    const flag = (pts, text) => { minus += pts; flags.push(text); };
    if (e.verdict === 'Walk away') flag(50, 'Walk away');
    else if (e.verdict === 'High risk') flag(30, 'High risk');
    if (held != null) { if (held >= 30) flag(25, `${Math.round(held)}% bundle still held`); } else if (b != null && b > 40) flag(25, `${Math.round(b)}% bundled`);
    if (top5 != null && top5 > 45) flag(25, `top 5 hold ${Math.round(top5)}%`);
    if (e.bundle && e.bundle.serial) flag(15, 'serial bundler dev');
    if (prof.medal === 'new' && win == null) flag(10, 'caller has no record');
    if (x != null && x > 3) flags.push(`already ${x.toFixed(1)}× since the call`);
    // Wallet memory (filled in for the best coins when GMGN is set up): known rug or runner wallets holding it.
    const wm = e.wm || {};
    if (wm.rug >= 2) flag(25, `${wm.rug} rug wallets in`);
    let bonus = wm.runner >= 2 ? 10 : 0;
    if (bonus) good.push({ pts: bonus, text: `${wm.runner} runner wallets in` });
    // Dev check (devrecord.js): a dev whose coins run earns points; one whose coins never get anywhere loses them.
    const dev = e.deep && e.deep.verdict;
    if (dev === 'proven') { bonus += 10; good.push({ pts: 10, text: 'proven dev' }); }
    if (dev === 'never') flag(15, 'dev\'s coins never get anywhere');
    const score = Math.max(0, Math.min(100, Math.round(caller + traction + clean + pumped + fresh + bonus - minus)));
    return { score, parts: { caller: Math.round(caller), traction, clean, pumped, fresh, bonus, minus }, reasons: good.sort((a, z) => z.pts - a.pts).slice(0, 3).map((r) => r.text), flags };
  }

  // Turnover (docs/features/turnover.md): 24h volume over market cap. Volume well above market cap means the supply has
  // changed hands; volume under it is mostly buys and few sells, the bundle or team-launch pattern (credit: @bigwarzeth).
  // -> { x, band: 'good' (2x+) | 'ok' (1-2x) | 'low' (under 1x), text } or null when either number is missing.
  const TURNOVER = { good: 2, ok: 1 };
  function turnover(vol, mcap) {
    if (vol == null || vol === '' || mcap == null || mcap === '') return null;
    const v = Number(vol), m = Number(mcap);
    if (!Number.isFinite(v) || v < 0 || !(m > 0)) return null;
    const x = v / m;
    const band = x >= TURNOVER.good ? 'good' : x >= TURNOVER.ok ? 'ok' : 'low';
    return { x, band, text: `${x >= 10 ? Math.round(x) : x.toFixed(1)}× mcap` };
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

  const api = { addressesIn, extractCalls, fromDiscordMessages, parseAlert, callerUpdates, applyCallerUpdates, addToQueue, sourceOf, sourcesOf, groupsOf, groupShort, groupColor, GROUP_COLORS, isFresh, rank, callerStats, callScore, liveMcap, moveSince, callPrice, snowflakeCmp, turnover, TURNOVER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calls = api;
})(typeof window !== 'undefined' ? window : globalThis);
