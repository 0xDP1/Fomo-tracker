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

  // Discord API message objects (content plus embeds, which alert bots use), oldest first.
  function fromDiscordMessages(messages) {
    const calls = [];
    for (const m of (messages || []).slice().sort((x, y) => snowflakeCmp(String(x.id), String(y.id)))) {
      const parts = [m.content];
      for (const e of m.embeds || []) { parts.push(e.title, e.description, e.url); for (const f of e.fields || []) parts.push(f.name, f.value); }
      const poster = (m.author && (m.author.global_name || m.author.username)) || 'unknown';
      const at = Date.parse(m.timestamp) || 0;
      const seen = new Set();
      for (const a of addressesIn(parts.filter(Boolean).join('\n'))) {
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
      const e = q[c.address] ? Object.assign({}, q[c.address], { posters: q[c.address].posters.slice() }) : { address: c.address, chain: c.chain, mentions: 0, posters: [], firstPoster: c.poster, firstAt: c.at, lastAt: c.at };
      e.mentions += 1;
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

  const api = { addressesIn, extractCalls, fromDiscordMessages, addToQueue, isFresh, rank, callerStats, snowflakeCmp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calls = api;
})(typeof window !== 'undefined' ? window : globalThis);
