/* global Stats, Chart */
'use strict';

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('ft_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ft_' + k, JSON.stringify(v)); } catch (e) { console.warn('save failed', e); } },
};

// Per-wallet data lives under ft_w_<wallet>_<key> so each FOMO user keeps separate trades/history.
const WALLET_DEFAULTS = {
  trades: [],   // closed trades (manual + synced)
  swaps: {},    // sig -> parsed swap (accumulates across syncs)
  hidden: [],   // synced trade ids the user deleted
  open: [],     // open positions from last sync
  history: [],  // [{t, sol, usd}]
  unit: 'SOL',  // trade amounts: 'SOL' (Solana sync / manual) or 'USD' (FOMO API)
};
const wstore = {
  key: (k) => 'w_' + (state.settings.wallet || 'none') + '_' + k,
  get: (k) => store.get(wstore.key(k), JSON.parse(JSON.stringify(WALLET_DEFAULTS[k]))),
  set: (k, v) => store.set(wstore.key(k), v),
};

const state = {
  settings: Object.assign({ wallet: '', username: '', heliusKey: '', rpc: '', refreshSec: 60, syncPages: 5, lookupUrl: '', lookupHeader: 'x-api-key', lookupKey: '', anthropicKey: '', feedUrl: '', feedKey: '', lossLimit: '', maxLossStreak: 3, dustUsd: 20 }, store.get('settings', {})),
  profiles: store.get('profiles', {}),    // fomo username -> wallet address
  symbols: store.get('symbols', {}),      // mint -> symbol
  wallet: null,                           // last balance snapshot
  sort: { key: 'closedAt', dir: -1 },
  charts: {},
};

// One-time migration from the single-wallet layout (global ft_trades etc.).
if (state.settings.wallet) {
  for (const k of Object.keys(WALLET_DEFAULTS)) {
    const legacy = store.get(k, null);
    if (legacy != null && store.get(wstore.key(k), null) == null) wstore.set(k, legacy);
    try { localStorage.removeItem('ft_' + k); } catch { /* ignore */ }
  }
}

function loadWalletData() {
  for (const k of Object.keys(WALLET_DEFAULTS)) state[k] = wstore.get(k);
  state.wallet = null;
  state.fomo = null;
  state.cal = null;
  state.calDay = null;
}
loadWalletData();

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const STABLES = { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC', Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT' };

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) }) : '–');
const sol = (n, d = 3) => (Number.isFinite(n) ? fmt(n, d) + ' SOL' : '–');
const signed = (n, d = 3) => (n > 0 ? '+' : '') + fmt(n, d);
const isUsd = () => state.unit === 'USD';
// Amount in the current wallet's trade unit (SOL for Solana-synced data, USD for FOMO accounts).
const amt = (n, d = 3) => (isUsd() ? usd(n) : sol(n, d));
const sgnAmt = (n, d = 3) => (isUsd() ? (Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '-' : '') + usd(Math.abs(n)) : '–') : signed(n, d) + ' SOL');
const usd = (n) => (Number.isFinite(n) ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '–');
const pct = (n, d = 1) => (Number.isFinite(n) ? (n * 100).toFixed(d) + '%' : '–');
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const short = (s) => (s && s.length > 12 ? s.slice(0, 4) + '…' + s.slice(-4) : s);
const tokenName = (t) => state.symbols[t.mint || t.token] || (t.mint ? short(t.mint) : t.token);
// Short local date/time: "Oct 3, 4:52 PM"; fmtT gives just the time.
const fmtDT = (iso) => { const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const fmtT = (iso) => { const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
// Chart colors come from the CSS tokens so a theme change needs no JS edits.
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const THEME = { accent: cssVar('--accent'), green: cssVar('--green'), red: cssVar('--red'), muted: cssVar('--muted'), border: cssVar('--border') };
const dur = (ms) => {
  if (!(ms > 0)) return '–';
  const m = ms / 60000;
  if (m < 60) return Math.round(m) + 'm';
  if (m < 1440) return (m / 60).toFixed(1) + 'h';
  return (m / 1440).toFixed(1) + 'd';
};
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const lastN = (trades, n) => {
  const s = trades.slice().sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  return n > 0 ? s.slice(-n) : s;
};

function rpcUrl() {
  const s = state.settings;
  if (s.rpc) return s.rpc;
  if (s.heliusKey) return 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(s.heliusKey);
  return 'https://api.mainnet-beta.solana.com';
}

async function rpc(method, params) {
  const r = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`RPC ${method} HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}

async function fetchPrices(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 50) {
    const ids = mints.slice(i, i + 50).join(',');
    try {
      const r = await fetch('https://lite-api.jup.ag/price/v3?ids=' + ids);
      const j = await r.json();
      for (const [m, v] of Object.entries(j || {})) if (v && v.usdPrice) out[m] = Number(v.usdPrice);
    } catch (e) { console.warn('price fetch failed', e); }
  }
  if (!out[Stats.SOL_MINT]) {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      out[Stats.SOL_MINT] = (await r.json()).solana.usd;
    } catch (e) { console.warn('coingecko fallback failed', e); }
  }
  return out;
}

async function resolveSymbols(mints) {
  const missing = [...new Set(mints)].filter((m) => !state.symbols[m]);
  if (!missing.length) return;
  for (const [m, s] of Object.entries(STABLES)) state.symbols[m] = s;
  try {
    if (state.settings.heliusKey) {
      for (let i = 0; i < missing.length; i += 100) {
        const assets = await rpc('getAssetBatch', { ids: missing.slice(i, i + 100) });
        for (const a of assets || []) {
          const sym = a && (a.content?.metadata?.symbol || a.token_info?.symbol);
          if (sym) state.symbols[a.id] = sym;
        }
      }
    } else {
      for (let i = 0; i < missing.length; i += 100) {
        const r = await fetch('https://lite-api.jup.ag/tokens/v2/search?query=' + missing.slice(i, i + 100).join(','));
        for (const t of (await r.json()) || []) if (t.id && t.symbol) state.symbols[t.id] = t.symbol;
      }
    }
  } catch (e) { console.warn('symbol lookup failed', e); }
  store.set('symbols', state.symbols);
}

// ---------- FOMO API (fomoapi.io): all chains, USD ----------
const FOMO_BASE = 'https://api.fomoapi.io/v2/users/';
const CHAIN_IDS = { 1: 'Ethereum', 8453: 'Base', 56: 'BNB', 143: 'Monad', 1399811149: 'Solana', 792703809: 'Solana' };

// The API's field names differ between its docs pages (camelCase vs snake_case), so read either.
function pick(o, ...paths) {
  for (const path of paths) {
    const v = path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
    if (v != null && v !== '') return v;
  }
  return undefined;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const unwrap = (j) => (j && typeof j === 'object' && !Array.isArray(j) ? (j.data ?? j.responseObject ?? j.result ?? j) : j);
const listIn = (j, ...paths) => (Array.isArray(j) ? j : paths.map((p) => pick(j, p)).find(Array.isArray) || []);
const toIso = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return isNaN(d) ? null : d.toISOString();
};
const chainName = (v) => {
  if (v == null) return '';
  if (CHAIN_IDS[v]) return CHAIN_IDS[v];
  const s = String(v).toLowerCase();
  if (s.includes('sol')) return 'Solana';
  if (s.includes('base')) return 'Base';
  if (s.includes('bnb') || s.includes('bsc')) return 'BNB';
  if (s.includes('eth')) return 'Ethereum';
  if (s.includes('monad')) return 'Monad';
  if (s.includes('robinhood')) return 'Robinhood';
  return String(v);
};

function fomoMode() {
  const cfg = lookupConfig();
  return !!(state.settings.username && cfg && cfg.url.startsWith(FOMO_BASE) && cfg.key);
}

// fomoapi.io credit guard: after a 402 every call pauses for an hour; each answered call is counted.
let fomoPause = store.get('fomoPause', 0);
function fomoPaused() {
  if (!FomoBudget.isPaused(fomoPause, Date.now())) return null;
  const e = new Error(FomoBudget.creditsMessage(fomoPause, Date.now())); e.status = 402; return e;
}
function fomoAnswered(r) {
  if (r.status === 402) { fomoPause = FomoBudget.pauseUntil(402, Date.now()); store.set('fomoPause', fomoPause); }
  if (!r.ok) return;
  const rem = r.headers.get('x-credits-remaining');
  store.set('fomoUsage', FomoBudget.record(store.get('fomoUsage', null), Date.now(), rem != null && rem !== '' ? Number(rem) : undefined));
  renderFomoUsage();
}
function renderFomoUsage() {
  const el = $('#fomoUsage');
  if (!el) return;
  const u = store.get('fomoUsage', null);
  const month = new Date().toISOString().slice(0, 7);
  const paused = fomoPaused();
  el.innerHTML = (u && u.month === month
    ? `fomoapi.io this month: ${u.calls.toLocaleString()} calls ≈ ${u.credits.toLocaleString()} credits (estimated at ${FomoBudget.CALL_CREDITS} each)${u.remaining != null ? ` · ${u.remaining.toLocaleString()} remaining per fomoapi.io, ${fmtT(u.remainingAt)}` : ''}.`
    : 'fomoapi.io this month: no calls yet.')
    + (paused ? ` <span class="neg">${esc(paused.message)}</span>` : '');
}

// handle defaults to the loaded user; Followed traders passes another handle.
async function fomoGet(path, params = {}, handle = state.settings.username) {
  const pausedErr = fomoPaused();
  if (pausedErr) throw pausedErr;
  const cfg = lookupConfig();
  const url = new URL(FOMO_BASE + encodeURIComponent(handle) + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const auth = /^(bearer|basic) /i.test(cfg.key) ? cfg.key : 'Bearer ' + cfg.key;
  let r;
  // no-store: always fetch fresh numbers instead of a cached response
  try { r = await fetch(url, { headers: { Authorization: auth }, cache: 'no-store' }); }
  catch { const e = new Error('FOMO API request was blocked (network or CORS).'); e.status = 'blocked'; throw e; }
  fomoAnswered(r);
  if (!r.ok) {
    const msg = r.status === 402 ? FomoBudget.creditsMessage(fomoPause, Date.now())
      : r.status === 401 || r.status === 403 ? `FOMO API rejected the key (HTTP ${r.status}).`
      : r.status === 429 ? 'FOMO API rate limit hit. Try again in a minute.'
      : `FOMO API HTTP ${r.status} for ${path || 'profile'}`;
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r.json();
}

// The pnl object comes in several shapes: windows ({"24h","7d","30d","allTime"}), nested windows, or a
// realized/unrealized/total breakdown. Match keys by pattern instead of exact names.
function pnlValue(v) {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (typeof v === 'object') return pnlValue(pick(v, 'usd', 'pnlUsd', 'pnl_usd', 'pnlUSD', 'pnl', 'value', 'total', 'totalUsd', 'realized', 'realizedUsd', 'realizedPnlUsd', 'profit', 'net', 'amount'));
  return null;
}
function pnlWindow(pnl, re) {
  if (!pnl || typeof pnl !== 'object') return null;
  const k = Object.keys(pnl).find((key) => re.test(key));
  return k ? pnlValue(pnl[k]) : null;
}
function parseFomoProfile(j) {
  const p = unwrap(j) || {};
  const pnl = p.pnl;
  const pnlObj = pnl && typeof pnl === 'object' ? pnl : {};
  const direct = (...keys) => { const v = pick(p, ...keys); return v == null ? null : pnlValue(v); };
  return {
    handle: pick(p, 'handle', 'userHandle'),
    name: pick(p, 'displayName', 'display_name', 'name'),
    pnl24h: pnlWindow(pnlObj, /^(24h|1d|d1|day|daily)$/i) ?? direct('pnl24h', 'pnl_24h', 'pnl1d'),
    pnl7d: pnlWindow(pnlObj, /^(7d|d7|week|weekly|1w)$/i) ?? direct('pnl7d', 'pnl_7d'),
    pnl30d: pnlWindow(pnlObj, /^(30d|d30|month|monthly|1m)$/i) ?? direct('pnl30d', 'pnl_30d'),
    pnlAll: pnlWindow(pnlObj, /^(all|alltime|all_time|lifetime|total|totalusd|realized|realizedusd)$/i) ?? (typeof pnl !== 'object' ? pnlValue(pnl) : null) ?? direct('pnlUsd', 'pnl_usd', 'totalPnlUsd', 'realizedPnlUsd'),
    pnlSource: pick(p, 'pnlSource', 'pnl_source') || '',
    pnlNote: pick(p, 'pnlNote', 'pnl_note') || '',
    volumeUsd: pick(p, 'volumeUsd', 'volume_usd') != null ? num(pick(p, 'volumeUsd', 'volume_usd')) : null,
    trades: pick(p, 'trades', 'tradeCount', 'trades_30d'),
    rank: pick(p, 'rank', 'rank_30d', 'rank_7d'),
  };
}

function parseFomoBalances(j) {
  const b = unwrap(j) || {};
  const tokens = listIn(b, 'balances', 'tokens', 'holdings', 'items', 'data').map((x) => ({
    symbol: pick(x, 'token.symbol', 'symbol', 'token_symbol') || '?',
    address: pick(x, 'token.address', 'token_address', 'address', 'mint') || '',
    chain: chainName(pick(x, 'chain', 'token.chain', 'token.networkId', 'networkId', 'network')),
    amount: num(pick(x, 'amount', 'balance', 'uiAmount')),
    usd: num(pick(x, 'valueUsd', 'value_usd', 'usd_value', 'usdValue')),
    change24h: pick(x, 'change24h', 'change_24h'),
  })).filter((t) => t.amount > 0 || t.usd > 0).sort((a, b) => b.usd - a.usd);
  let byChain = {};
  const rawBy = pick(b, 'byChain', 'by_chain');
  if (Array.isArray(rawBy)) for (const c of rawBy) byChain[chainName(pick(c, 'chain', 'networkId', 'name'))] = num(pick(c, 'valueUsd', 'totalValueUsd', 'value_usd', 'usd', 'total'));
  else if (rawBy && typeof rawBy === 'object') for (const [k, v] of Object.entries(rawBy)) byChain[chainName(k)] = num(typeof v === 'object' ? pick(v, 'valueUsd', 'totalValueUsd', 'value_usd', 'usd', 'total') : v);
  if (!Object.keys(byChain).length) for (const t of tokens) byChain[t.chain || '?'] = (byChain[t.chain || '?'] || 0) + t.usd;
  const total = pick(b, 'totalValueUsd', 'total_value_usd', 'total_usd', 'totalUsd');
  return { tokens, byChain, totalUsd: total != null ? num(total) : tokens.reduce((s, t) => s + t.usd, 0) };
}

// FOMO position -> app trade (USD). PnL is FOMO's own realized figure; cost is the USD put in.
function parseFomoTrade(t) {
  // Some responses list individual buy/sell fills instead of positions: a sell with a pnl is a closed trade.
  const side = String(pick(t, 'type', 'side', 'action') || '').toLowerCase();
  if ((side === 'buy' || side === 'sell') && pick(t, 'status', 'state', 'closedAt', 'closed_at') == null) {
    const value = num(pick(t, 'usd_value', 'usdValue', 'valueUsd', 'amountUsd'));
    const pnl = num(pick(t, 'pnl', 'pnlUsd', 'realizedPnlUsd', 'realized_pnl_usd'));
    const at = toIso(pick(t, 'timestamp', 'createdAt', 'created_at', 'time'));
    const rawPnl = pick(t, 'pnl', 'pnlUsd', 'realizedPnlUsd', 'realized_pnl_usd');
    const tokenObj = side === 'sell' ? pick(t, 'token_in', 'token') : pick(t, 'token_out', 'token');
    return {
      fill: true, side, at, value,
      pnl: side === 'sell' && rawPnl != null ? pnl : null,
      id: pick(t, 'trade_id', 'tradeId', 'id', 'tx_hash', 'txHash') || at,
      token: (tokenObj && typeof tokenObj === 'object' ? tokenObj.symbol : null) || pick(t, 'symbol', 'token_symbol') || (typeof tokenObj === 'string' ? tokenObj : '?'),
      address: (tokenObj && typeof tokenObj === 'object' ? tokenObj.address : null) || pick(t, 'token_address', 'tokenAddress') || '',
      chain: chainName(pick(t, 'chain', 'networkId', 'network')),
    };
  }
  const realized = pick(t, 'realizedPnlUsd', 'realized_pnl_usd', 'realizedPnl', 'pnl');
  const boughtCost = num(pick(t, 'boughtAmount', 'bought_amount')) * num(pick(t, 'avgEntryPrice', 'avg_entry_price'))
    + num(pick(t, 'transferredInAmount')) * num(pick(t, 'avgTransferInPrice'));
  const soldValue = num(pick(t, 'soldAmount', 'sold_amount')) * num(pick(t, 'avgExitPrice', 'avg_exit_price'))
    + num(pick(t, 'transferredOutAmount')) * num(pick(t, 'avgTransferOutPrice'));
  const cost = boughtCost > 0 ? boughtCost : num(pick(t, 'costBasisUsd', 'cost_basis_usd', 'costUsd', 'usd_value'));
  const pnl = realized != null ? num(realized) : soldValue - cost;
  const closedFlag = pick(t, 'isClosed', 'is_closed', 'closed');
  const status = String(pick(t, 'status', 'state') || (closedFlag === true ? 'closed' : closedFlag === false ? 'open' : '')).toLowerCase();
  const closedAt = toIso(pick(t, 'closedAt', 'closed_at', 'exitAt', 'exitedAt'));
  const symbol = pick(t, 'token.symbol', 'symbol', 'token_symbol') || '?';
  const address = pick(t, 'token.address', 'token_address', 'tokenAddress', 'address') || '';
  const id = pick(t, 'tradeId', 'trade_id', 'positionId', 'id') || `${address}_${pick(t, 'createdAt', 'created_at')}`;
  return {
    id: 'f_' + id,
    token: symbol,
    address,
    chain: chainName(pick(t, 'chain', 'token.chain', 'token.networkId', 'networkId', 'network')),
    openedAt: toIso(pick(t, 'createdAt', 'created_at', 'openedAt', 'timestamp')) || closedAt,
    closedAt: closedAt || toIso(pick(t, 'updatedAt', 'updated_at')),
    cost,
    proceeds: cost + pnl,
    unrealized: num(pick(t, 'unrealizedPnlUsd', 'unrealized_pnl_usd', 'unrealizedPnl')),
    entryPrice: num(pick(t, 'avgEntryPrice', 'avg_entry_price')) || null,
    amount: num(pick(t, 'amount', 'balance', 'tokenAmount')) || null,
    isOpen: status ? !['closed', 'sold', 'exited', 'complete', 'completed'].includes(status) : !closedAt,
    notes: '',
    source: 'fomo',
  };
}

async function fetchFomoTrades(maxPages) {
  let rows = [];
  try { rows = await fetchFomoRows('/trades', maxPages); }
  catch (e) { if (e.status !== 404) throw e; }
  if (!rows.length) {
    try { rows = await fetchFomoRows('/positions', maxPages); }
    catch (e) { if (e.status !== 404) throw e; }
  }
  const items = rows.map(parseFomoTrade);
  const fills = items.filter((x) => x.fill);
  if (!fills.length) return items;
  // Fills (one row per buy or sell) are merged into one trade per position, so a 3-trim exit is one win, not three.
  const merged = Stats.mergeFills(fills.map((f) => Object.assign({ key: f.address || `${f.chain}:${f.token}` }, f)));
  return items.filter((x) => !x.fill).concat(merged.closed, merged.open.map((p) => Object.assign({ id: 'f_open_' + (p.address || p.token), unrealized: null }, p)));
}

const rowId = (r) => String(pick(r, 'tradeId', 'trade_id', 'positionId', 'id') || JSON.stringify(r).slice(0, 80));
const ROW_LIMIT = 500;

// Pulls every row the endpoint will give: cursor pages if offered, else offset pages while new ids keep
// arriving, plus a status=closed top-up when the response says more closed trades exist than it returned.
// Paging strategies to try when the API returns no cursor and caps the page size. Each builds the params for
// the next page from what we have so far; the first one that yields unseen rows is kept and remembered.
const PAGING_STRATEGIES = [
  ['page', (c) => ({ page: c.page + 1 })],
  ['offset', (c) => ({ offset: c.seen })],
  ['skip', (c) => ({ skip: c.seen })],
  ['cursor=id', (c) => ({ cursor: c.lastId })],
  ['after=id', (c) => ({ after: c.lastId })],
  ['before=id', (c) => ({ before: c.lastId })],
  ['before=iso', (c) => ({ before: c.oldestIso })],
  ['before=ms', (c) => ({ before: c.oldestMs })],
  ['before=sec', (c) => ({ before: Math.floor(c.oldestMs / 1000) })],
  ['until=iso', (c) => ({ until: c.oldestIso })],
  ['from', (c) => ({ from: c.seen })],
  ['start', (c) => ({ start: c.seen })],
  ['page+pageSize', (c) => ({ page: c.page + 1, pageSize: c.pageSize })],
  ['startAfter=id', (c) => ({ startAfter: c.lastId })],
  ['closed+page', (c) => ({ status: 'closed', page: c.page + 1 })],
  ['closed+offset', (c) => ({ status: 'closed', offset: c.seenClosed })],
  ['closed+before=id', (c) => ({ status: 'closed', before: c.lastClosedId })],
  ['closed+before=iso', (c) => ({ status: 'closed', before: c.oldestClosedIso })],
];
const rowTs = (r) => { const d = new Date(pick(r, 'closedAt', 'closed_at', 'createdAt', 'created_at', 'timestamp') || 0); return isNaN(d) ? 0 : d.getTime(); };
const isClosedRow = (r) => /closed|sold|exited|complete/i.test(String(pick(r, 'status', 'state') || ''));

async function fetchFomoRows(path, maxPages) {
  const seen = new Map();
  const add = (rows) => { let n = 0; for (const r of rows) { const id = rowId(r); if (!seen.has(id)) { seen.set(id, r); n++; } } return n; };
  const meta = { requests: 0 };
  const grab = async (params) => {
    meta.requests++;
    const j = await fomoGet(path, params);
    const body = unwrap(j);
    for (const k of ['count', 'closedCount', 'activeCount', 'total', 'stale', 'staleNote', 'ageSeconds']) if (body && body[k] != null && meta[k] == null) meta[k] = body[k];
    return { rows: listIn(body, 'trades', 'positions', 'items', 'data', 'results'), next: pick(body, 'nextCursor', 'next_cursor', 'cursor', 'pagination.nextCursor', 'pagination.next', 'next') ?? pick(j, 'nextCursor', 'next_cursor', 'pagination.nextCursor') };
  };
  const fresh = state.fomoMeta && state.fomoMeta[path] && state.fomoMeta[path].stale ? { fresh: 1, refresh: 1, nocache: 1 } : {};
  // 1) cursor paging if the API offers it
  let cursor = '', pageSize = 0, lastRows = [];
  for (let page = 0; page < maxPages; page++) {
    const { rows, next } = await grab(Object.assign({ limit: ROW_LIMIT, cursor }, fresh));
    if (!pageSize) pageSize = rows.length;
    lastRows = rows;
    const added = add(rows);
    if (!rows.length || !added || !next || next === cursor || typeof next === 'boolean') { if (!next || typeof next === 'boolean') cursor = ''; break; }
    cursor = String(next);
  }
  const counted = (Number(meta.closedCount) || 0) + (Number(meta.activeCount) || 0);
  const expected = Math.max(Number(meta.count) || 0, Number(meta.total) || 0, counted);
  const context = () => {
    const all = [...seen.values()];
    const closed = all.filter(isClosedRow);
    const oldest = all.reduce((m, r) => (rowTs(r) && (!m || rowTs(r) < m) ? rowTs(r) : m), 0);
    const oldestClosed = closed.reduce((m, r) => (rowTs(r) && (!m || rowTs(r) < m) ? rowTs(r) : m), 0);
    return { seen: all.length, seenClosed: closed.length, page: Math.max(1, Math.round(all.length / (pageSize || 50))), pageSize: pageSize || 50,
      lastId: lastRows.length ? rowId(lastRows[lastRows.length - 1]) : '', lastClosedId: closed.length ? rowId(closed[closed.length - 1]) : '',
      oldestMs: oldest || Date.now(), oldestIso: new Date(oldest || Date.now()).toISOString(), oldestClosedIso: new Date(oldestClosed || Date.now()).toISOString() };
  };
  // 2) no cursor: find a paging parameter the API honours, then page with it (at most maxPages * pageSize rows).
  // Once no parameter works, skip the probe for a day: each probe costs ~19 calls.
  const probeMemo = state.settings.fomoPagingMemo || null;
  if (!cursor && expected > seen.size && !FomoBudget.shouldProbe(probeMemo, Date.now())) { meta.paging = 'none'; meta.probeSkipped = true; }
  else if (!cursor && expected > seen.size) {
    const remembered = state.settings.fomoPaging;
    const order = PAGING_STRATEGIES.slice().sort((a, b) => (a[0] === remembered ? -1 : b[0] === remembered ? 1 : 0));
    let strategy = null;
    for (const [name, build] of order) {
      if (strategy) break;
      try {
        const { rows } = await grab(Object.assign({ limit: ROW_LIMIT }, build(context())));
        if (rows.length && add(rows)) { strategy = [name, build]; lastRows = rows; }
      } catch { /* a parameter the API rejects */ }
      if (meta.requests > 24) break;
    }
    if (strategy) {
      meta.paging = strategy[0];
      state.settings.fomoPagingMemo = { strategy: strategy[0], at: Date.now() };
      if (state.settings.fomoPaging !== strategy[0]) state.settings.fomoPaging = strategy[0];
      store.set('settings', state.settings);
      const maxRows = Math.max(maxPages, 5) * Math.max(pageSize, 50) * 4;
      let pages = 1;
      while (seen.size < expected && seen.size < maxRows && pages < 40) {
        let rows = [];
        try { ({ rows } = await grab(Object.assign({ limit: ROW_LIMIT }, strategy[1](context())))); } catch { break; }
        pages++;
        if (!rows.length || !add(rows)) break;
        lastRows = rows;
      }
    } else {
      meta.paging = 'none';
      state.settings.fomoPagingMemo = { strategy: 'none', at: Date.now() };
      store.set('settings', state.settings);
    }
  } else if (cursor) meta.paging = 'cursor';
  meta.received = seen.size;
  meta.closedReceived = [...seen.values()].filter(isClosedRow).length;
  meta.expected = expected;
  state.fomoMeta = Object.assign({}, state.fomoMeta, { [path]: meta });
  return [...seen.values()];
}

async function refreshFomo() {
  const [profile, balances] = await Promise.all([fomoGet(''), fomoGet('/balances')]);
  state.fomo = { profile: parseFomoProfile(profile), balances: parseFomoBalances(balances), at: Date.now() };
  return state.fomo;
}

// Dust filter: positions and holdings worth less than this (USD) are hidden from lists and skipped by checks.
const dustUsd = () => (state.settings.dustUsd === '' ? 0 : Number(state.settings.dustUsd) || 0);
// Current value of an open position in USD (cost + unrealized when FOMO gives it; SOL cost converted otherwise).
function positionValueUsd(p) {
  const base = (Number(p.cost) || 0) + (Number(p.unrealized) || 0);
  if (isUsd() || p.source === 'fomo' || p.source === 'chain') return base;
  const px = state.wallet?.solPrice;
  return px ? base * px : null; // unknown price: never treat as dust
}
const isDust = (p) => { const v = positionValueUsd(p); return v != null && v < dustUsd(); };

// ---------- wallet balance ----------
function pushHistory(solBal, totalUsd) {
  const h = state.history;
  const point = { t: Date.now(), sol: solBal, usd: totalUsd };
  if (!h.length || Date.now() - h[h.length - 1].t > 60000) h.push(point);
  else h[h.length - 1] = point;
  if (h.length > 5000) h.splice(0, h.length - 5000);
  wstore.set('history', h);
}

// force: the Refresh button or a user switch. Otherwise fomoapi.io is called at most every 10 minutes.
async function refreshBalance(force = false) {
  const wallet = state.settings.wallet.trim();
  $('#walletMissing').classList.toggle('hidden', !!wallet || fomoMode());
  if (!wallet && !fomoMode()) return;
  const btn = $('#refreshBtn');
  btn.disabled = true;
  let fomoErr = '';
  if (fomoMode()) {
    if (force && fomoPause) { fomoPause = 0; store.set('fomoPause', 0); }
    if (!force && state.fomo && !FomoBudget.due(state.fomo.at, Date.now(), FomoBudget.BALANCE_MS)) { btn.disabled = false; return; }
    try {
      const f = await refreshFomo();
      pushHistory(null, f.balances.totalUsd);
      const tm = state.fomoMeta && (state.fomoMeta['/trades'] || state.fomoMeta['/positions']);
      $('#lastUpdated').innerHTML = 'Updated ' + fmtT(Date.now()) + ' via FOMO' + (tm && tm.stale ? ' · <span class="neg">trades stale: FOMO not answering fomoapi.io</span>' : '');
      btn.disabled = false;
      renderWallet();
      renderSizing();
      if (FomoBudget.due(state.lastSync, Date.now(), FomoBudget.SYNC_MS)) {
        const err = await syncTrades();
        if (err) $('#lastUpdated').innerHTML = `Balance updated ${fmtT(Date.now())} · <span class="neg">Trades: ${esc(err)}</span>`;
      }
      return;
    } catch (e) {
      state.fomo = null;
      fomoErr = e.message;
      if (!wallet) { $('#lastUpdated').innerHTML = `<span class="neg">${esc(fomoErr)}</span>`; btn.disabled = false; return; }
    }
  }
  try {
    const [lamports, ...tokenLists] = await Promise.all([
      rpc('getBalance', [wallet]).then((r) => r.value),
      ...TOKEN_PROGRAMS.map((p) =>
        rpc('getTokenAccountsByOwner', [wallet, { programId: p }, { encoding: 'jsonParsed' }]).then((r) => r.value).catch(() => [])),
    ]);
    const solBal = lamports / 1e9;
    const tokens = tokenLists.flat()
      .filter((a) => a && a.account)
      .map((a) => a.account.data.parsed.info)
      .map((i) => ({ mint: i.mint, amount: Number(i.tokenAmount.uiAmount) || 0 }))
      .filter((t) => t.amount > 0);

    const prices = await fetchPrices([Stats.SOL_MINT, ...tokens.map((t) => t.mint)]);
    await resolveSymbols(tokens.map((t) => t.mint));
    const solPrice = prices[Stats.SOL_MINT];
    for (const t of tokens) t.usd = prices[t.mint] ? t.amount * prices[t.mint] : NaN;
    tokens.sort((a, b) => (b.usd || 0) - (a.usd || 0));
    const tokenUsd = tokens.reduce((s, t) => s + (t.usd || 0), 0);
    const totalUsd = solBal * (solPrice || 0) + tokenUsd;

    state.wallet = { sol: solBal, solPrice, tokens, tokenUsd, totalUsd, at: Date.now() };
    pushHistory(solBal, totalUsd);
    $('#lastUpdated').innerHTML = fomoErr
      ? `<span class="neg">${esc(fomoErr)}</span> Showing Solana only.`
      : 'Updated ' + fmtT(Date.now());
  } catch (e) {
    $('#lastUpdated').innerHTML = `<span class="neg">${fomoErr ? esc(fomoErr) + ' · ' : ''}Balance error: ${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
    renderWallet();
    renderSizing();
  }
}

const sgnUsd = (n) => (n == null ? '–' : `<span class="${cls(n)}">${n > 0 ? '+' : n < 0 ? '-' : ''}${usd(Math.abs(n))}</span>`);
function setTileLabels(labels) { ['lblBal', 'lblPort', 'lblPrice'].forEach((id, i) => ($('#' + id).textContent = labels[i])); }

function renderBalanceChange(totalUsd) {
  const first = state.history.find((p) => p.usd > 0);
  if (!first) return;
  const d = totalUsd - first.usd;
  $('#balChange').innerHTML = sgnUsd(d);
  $('#balChangeSub').textContent = `${pct(d / first.usd)} since ${new Date(first.t).toLocaleDateString()}`;
}

function pnlWindowsFromTrades() {
  const now = Date.now();
  const sum = (ms) => state.trades.map(Stats.enrich).filter((t) => now - new Date(t.closedAt) <= ms).reduce((s, t) => s + t.pnl, 0);
  return { pnl24h: sum(864e5), pnl7d: sum(7 * 864e5), pnl30d: sum(30 * 864e5), pnlAll: sum(Infinity), count: state.trades.length };
}

function renderFomoWallet() {
  const { profile: p, balances: b } = state.fomo;
  setTileLabels(['FOMO balance', 'PnL, last 30 days', 'PnL, all time']);
  const chains = Object.entries(b.byChain).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  $('#solBal').textContent = usd(b.totalUsd);
  $('#solUsd').textContent = `${chains.length} chain${chains.length === 1 ? '' : 's'} · ${b.tokens.length} holdings`;
  // FOMO only publishes PnL for leaderboard accounts. When its windows are null, use realized PnL from the synced trades.
  const own = p.pnl30d == null && p.pnlAll == null && state.trades.length ? pnlWindowsFromTrades() : null;
  const w = own || p;
  $('#portUsd').innerHTML = sgnUsd(w.pnl30d);
  $('#portSub').innerHTML = `7d ${sgnUsd(w.pnl7d)} · 24h ${sgnUsd(w.pnl24h)}${own ? ' · from your trades' : ''}`;
  $('#solPrice').innerHTML = sgnUsd(w.pnlAll);
  $('#solPriceSub').textContent = [own ? `realized, ${own.count} closed trades` : '', p.volumeUsd != null ? usd(p.volumeUsd) + ' volume' : '', p.rank != null ? 'rank #' + p.rank : ''].filter(Boolean).join(' · ');
  setTileLabels(['FOMO balance', own ? 'Realized PnL, 30 days' : 'PnL, last 30 days', own ? 'Realized PnL, all synced' : 'PnL, all time']);
  renderBalanceChange(b.totalUsd);
  $('#holdings').innerHTML = (chains.length ? `<div class="chain-row">${chains.map(([c, v]) => `<span class="chip">${esc(c)} <b>${usd(v)}</b></span>`).join('')}</div>` : '')
    + (b.tokens.length
      ? b.tokens.filter((t) => !(t.usd < dustUsd())).map((t) => `<div class="holding"><span>${esc(t.symbol)}${t.chain ? `<span class="tag">${esc(t.chain)}</span>` : ''}</span><span>${fmt(t.amount, 2)} <span class="muted">${usd(t.usd)}</span></span></div>`).join('')
      : '<p class="muted">No holdings.</p>')
    + (b.tokens.some((t) => t.usd < dustUsd()) ? `<p class="muted small">${b.tokens.filter((t) => t.usd < dustUsd()).length} dust holdings under ${usd(dustUsd())} hidden.</p>` : '');
  showBalanceChart();
}

function renderWallet() {
  if (state.fomo) return renderFomoWallet();
  const w = state.wallet;
  if (!w) return;
  setTileLabels(['SOL balance', 'Portfolio value', 'SOL price']);
  $('#solPriceSub').textContent = '';
  $('#solBal').textContent = sol(w.sol, 4);
  $('#solUsd').textContent = w.solPrice ? usd(w.sol * w.solPrice) : '';
  $('#portUsd').textContent = usd(w.totalUsd);
  $('#portSub').textContent = `${w.tokens.length} token${w.tokens.length === 1 ? '' : 's'} · ${usd(w.tokenUsd)} in tokens`;
  $('#solPrice').textContent = usd(w.solPrice);

  renderBalanceChange(w.totalUsd);

  $('#holdings').innerHTML = w.tokens.length
    ? w.tokens.map((t) => `<div class="holding"><span>${esc(state.symbols[t.mint] || short(t.mint))}</span><span>${fmt(t.amount, 2)} <span class="muted">${Number.isFinite(t.usd) ? usd(t.usd) : ''}</span></span></div>`).join('')
    : 'No SPL tokens held.';

  showBalanceChart();
}

// The balance chart needs two readings to mean anything; tiles with nothing to show are hidden.
function showBalanceChart() {
  const enough = state.history.filter((q) => Number.isFinite(q.usd)).length >= 2;
  $('#balCard').hidden = !enough;
  if (enough) lineChart('balChart', state.history.map((p) => fmtDT(p.t)), state.history.map((p) => p.usd), THEME.accent);
  hideEmptyTiles();
}
function hideEmptyTiles() {
  for (const id of ['solBal', 'portUsd', 'solPrice', 'balChange']) { const el = $('#' + id); if (el) el.closest('.tile').hidden = el.textContent.trim() === '–'; }
}

// ---------- charts ----------
function makeChart(id, config) {
  if (typeof Chart === 'undefined') return;
  if (state.charts[id]) state.charts[id].destroy();
  Chart.defaults.color = THEME.muted;
  Chart.defaults.borderColor = THEME.border;
  state.charts[id] = new Chart(document.getElementById(id), config);
}

function lineChart(id, labels, data, color) {
  makeChart(id, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + '22', fill: true, pointRadius: 0, tension: 0.2, borderWidth: 2 }] },
    options: { animation: false, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 } } }, interaction: { intersect: false, mode: 'index' } },
  });
}

function barChart(id, labels, data, colors, opts = {}) {
  makeChart(id, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 3 }] },
    options: Object.assign({ animation: false, maintainAspectRatio: false, plugins: { legend: { display: false } } }, opts),
  });
}

// ---------- stats tiles ----------
function statTileList(s) {
  return [
    ['Net PnL', `<span class="${cls(s.netPnl)}">${sgnAmt(s.netPnl)}</span>`, s.totalCost ? pct(s.netPnl / s.totalCost) + ' ROI on volume' : ''],
    ['Win rate', pct(s.winRate), `${s.wins}W / ${s.losses}L${s.breakeven ? ' / ' + s.breakeven + 'BE' : ''}`],
    ['Profit factor', Number.isFinite(s.profitFactor) ? fmt(s.profitFactor, 2) : '∞', 'gross win ÷ gross loss'],
    ['Expectancy', `<span class="${cls(s.expectancy)}">${sgnAmt(s.expectancy)}</span>`, `${pct(s.expectancyPct)} per trade`],
    ['Avg win', `<span class="pos">${amt(s.avgWin)}</span>`, '+' + pct(s.avgWinPct)],
    ['Avg loss', `<span class="neg">${amt(s.avgLoss)}</span>`, '-' + pct(s.avgLossPct)],
    ['Payoff ratio', fmt(s.payoff, 2), 'avg win % ÷ avg loss %'],
    ['Max drawdown', `<span class="neg">${amt(s.maxDrawdown)}</span>`, 'peak-to-trough of PnL'],
    ['Largest win', `<span class="pos">${amt(s.largestWin)}</span>`, ''],
    ['Largest loss', `<span class="neg">${amt(s.largestLoss)}</span>`, ''],
    ['Streak', `<span class="${cls(s.currentStreak)}">${s.currentStreak > 0 ? s.currentStreak + 'W' : s.currentStreak < 0 ? -s.currentStreak + 'L' : '–'}</span>`, `best ${s.longestWinStreak}W · worst ${s.longestLossStreak}L`],
    ['Avg hold', dur(s.avgHoldMs), `${s.count} trades`],
  ];
}
const tileHtml = ([l, v, sub]) => `<div class="tile"><label>${l}</label><div class="big">${v}</div><div class="muted small">${sub}</div></div>`;
const KEY_TILES = ['Net PnL', 'Win rate', 'Expectancy', 'Streak'];

// W/L strip: the last trades in the order the streak counts them (oldest → newest), ±1% = breakeven.
function seqStrip(s) {
  if (!s.sequence || !s.sequence.length) return '';
  return `<div class="seq"><span class="muted small">Last ${s.sequence.length}, oldest → newest (±${Math.round(Stats.BREAKEVEN_PCT * 100)}% counts as breakeven):</span><div class="seq-row">${s.sequence.map((x) => `<span class="seq-dot ${x.outcome > 0 ? 'w' : x.outcome < 0 ? 'l' : 'b'}" title="${esc(tokenName(x))} ${fmtDT(x.at)}: ${sgnAmt(x.pnl)} (${signed(x.pnlPct * 100, 1)}%)">${x.outcome > 0 ? 'W' : x.outcome < 0 ? 'L' : '·'}</span>`).join('')}</div></div>`;
}

// ---------- dashboard ----------
function renderDashboard() {
  renderRisk();
  const trades = lastN(state.trades, +$('#dashWindow').value);
  const s = Stats.computeStats(trades);
  const list = statTileList(s);
  $('#dashStats').innerHTML = list.filter(([l]) => KEY_TILES.includes(l)).map(tileHtml).join('');
  $('#dashMoreStats').innerHTML = list.filter(([l]) => !KEY_TILES.includes(l)).map(tileHtml).join('');
  $('#dashSeq').innerHTML = seqStrip(s);
  lineChart('equityChart', s.equity.map((e) => new Date(e.at).toLocaleDateString()), s.equity.map((e) => e.value), s.netPnl >= 0 ? THEME.green : THEME.red);
  const recent = s.trades.slice(-10).reverse();
  $('#recentList').innerHTML = recent.length
    ? recent.map((t) => `<div class="recent-item"><span>${esc(tokenName(t))} <span class="muted small">${fmtDT(t.closedAt)}</span></span><span class="${cls(t.pnl)}">${sgnAmt(t.pnl)} (${signed(t.pnlPct * 100, 1)}%)</span></div>`).join('')
    : emptyTradesMessage();
}

// Explains an empty Performance section: what the last FOMO sync returned.
function emptyTradesMessage() {
  if (!fomoMode()) return '<p class="muted">No trades yet. Sync from your wallet or add trades manually on the Trades tab.</p>';
  const i = state.syncInfo;
  const when = i ? ` (${fmtT(i.at)})` : '';
  let msg;
  if (!i) msg = 'Loading your trades from FOMO…';
  else if (i.error) msg = `<span class="neg">Couldn't load trades from FOMO${when}: ${esc(i.error)}</span>`;
  else if (!i.total) msg = `FOMO returned no trades for this account${when}.`;
  else msg = `FOMO returned ${i.total} position${i.total === 1 ? "" : "s"}${when}, but none are closed yet (${i.open} open). Stats appear once a position is fully sold.`;
  return `<p class="muted">${msg}</p><p class="muted small">If this looks wrong, go to Settings → FOMO connection check → Run check, and send me the report.</p>`;
}

// ---------- setup tags ----------
const PRESET_TAGS = ['KOL call', 'Dip buy', 'New launch', 'Breakout', 'Narrative', 'Copy trade', 'FOMO entry'];
const parseTags = (str) => [...new Set(String(str || '').split(/[,|]/).map((x) => x.trim()).filter(Boolean))].slice(0, 8);
const allTags = () => [...new Set(PRESET_TAGS.concat(state.trades.flatMap((t) => t.tags || [])))];
const tagChips = (tags) => (tags || []).map((g) => `<span class="tag setup">${esc(g)}</span>`).join('');

function renderTagPicker() {
  const input = $('#tradeForm').tags;
  const on = new Set(parseTags(input.value).map((x) => x.toLowerCase()));
  $('#tagChips').innerHTML = allTags().map((g) => `<button type="button" data-tag="${esc(g)}" class="${on.has(g.toLowerCase()) ? 'on' : ''}">${esc(g)}</button>`).join('');
}
$('#tagChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  const input = $('#tradeForm').tags;
  const tags = parseTags(input.value);
  const i = tags.findIndex((x) => x.toLowerCase() === b.dataset.tag.toLowerCase());
  if (i >= 0) tags.splice(i, 1); else tags.push(b.dataset.tag);
  input.value = tags.join(', ');
  renderTagPicker();
});
$('#tradeForm').tags.addEventListener('input', renderTagPicker);

// ---------- trades table ----------
function renderTrades() {
  const q = $('#filterText').value.toLowerCase();
  const res = $('#filterResult').value;
  const sel = $('#filterTag');
  const tagNow = sel.value;
  const used = [...new Set(state.trades.flatMap((t) => t.tags || []))].sort();
  sel.innerHTML = '<option value="">All setups</option><option value="__none">Untagged</option>' + used.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  sel.value = tagNow === '__none' || used.includes(tagNow) ? tagNow : '';
  const tag = sel.value;
  let rows = state.trades.map(Stats.enrich).filter((t) => {
    if (res === 'win' && !(t.pnl > 0)) return false;
    if (res === 'loss' && !(t.pnl < 0)) return false;
    if (tag === '__none' && (t.tags || []).length) return false;
    if (tag && tag !== '__none' && !(t.tags || []).includes(tag)) return false;
    if (q && !(tokenName(t) + ' ' + t.token + ' ' + (t.notes || '') + ' ' + (t.tags || []).join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    let x = a[key], y = b[key];
    if (key === 'closedAt') { x = new Date(x); y = new Date(y); }
    if (key === 'token') { x = tokenName(a).toLowerCase(); y = tokenName(b).toLowerCase(); }
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
  $('#tradeCount').textContent = `${rows.length} of ${state.trades.length} trades`;
  $('#tradeTable tbody').innerHTML = rows.map((t) => `
    <tr>
      <td class="t-date">${fmtDT(t.closedAt)}</td>
      <td class="t-token">${esc(tokenName(t))}${t.chain ? `<span class="tag">${esc(t.chain)}</span>` : t.source === 'helius' ? '<span class="tag">synced</span>' : ''}${t.viaChain ? '<span class="tag setup" title="Read from the blockchain via Helius; not yet in FOMO\'s list">on-chain</span>' : ''}</td>
      <td class="num hide-m">${fmt(t.cost, 4)}</td>
      <td class="num hide-m">${fmt(t.proceeds, 4)}</td>
      <td class="num t-pnl ${cls(t.pnl)}">${signed(t.pnl, 4)}</td>
      <td class="num t-pct ${cls(t.pnl)}">${signed(t.pnlPct * 100, 1)}%</td>
      <td class="hide-m">${dur(new Date(t.closedAt) - new Date(t.openedAt))}</td>
      <td class="notes t-notes">${tagChips(t.tags)}${t.tags && t.tags.length && t.notes ? ' ' : ''}${esc(t.notes)}</td>
      <td class="t-act"><button class="icon-btn" data-edit="${esc(t.id)}" title="Edit / add notes">✎</button><button class="icon-btn" data-del="${esc(t.id)}" title="Delete">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">No trades.</td></tr>';

  const shown = state.open.filter((p) => !isDust(p));
  const dustN = state.open.length - shown.length;
  $('#openPosCard').hidden = !state.open.length;
  $('#openPositions').innerHTML = (dustN ? `<p class="muted small">${dustN} dust position${dustN === 1 ? '' : 's'} under ${usd(dustUsd())} hidden (Settings).</p>` : '') + shown.map((p) => p.source === 'fomo' || p.source === 'chain'
    ? `<div class="recent-item"><span>${esc(p.token)}${p.chain ? `<span class="tag">${esc(p.chain)}</span>` : ''} <span class="muted small">since ${p.openedAt ? fmtDT(p.openedAt) : '?'}</span></span><span>cost ${usd(p.cost)} · unrealized ${sgnUsd(p.unrealized)}</span></div>`
    : `<div class="recent-item"><span>${esc(state.symbols[p.mint] || short(p.mint))} <span class="muted small">since ${fmtDT(p.openedAt)}</span></span><span>${fmt(p.qty, 2)} tokens · cost basis ${sol(p.cost, 4)}</span></div>`).join('');
}

function saveTrades() {
  wstore.set('trades', state.trades);
  renderAll();
}

function openForm(t) {
  const f = $('#tradeForm');
  f.reset();
  f.classList.remove('hidden');
  $('#formTitle').textContent = t ? 'Edit trade' : 'Add trade';
  f.tradeId.value = t ? t.id : '';
  f.token.value = t ? tokenName(t) : '';
  f.openedAt.value = toLocalInput(t?.openedAt);
  f.closedAt.value = toLocalInput(t ? t.closedAt : new Date().toISOString());
  f.cost.value = t ? t.cost : '';
  f.proceeds.value = t ? t.proceeds : '';
  f.notes.value = t ? t.notes || '' : '';
  f.tags.value = t ? (t.tags || []).join(', ') : '';
  renderTagPicker();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#tradeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const existing = state.trades.find((t) => t.id === f.tradeId.value);
  const data = {
    openedAt: f.openedAt.value ? new Date(f.openedAt.value).toISOString() : new Date(f.closedAt.value).toISOString(),
    closedAt: new Date(f.closedAt.value).toISOString(),
    cost: Number(f.cost.value),
    proceeds: Number(f.proceeds.value),
    notes: f.notes.value.trim(),
    tags: parseTags(f.tags.value),
  };
  if (existing) {
    Object.assign(existing, data);
    if (existing.mint) state.symbols[existing.mint] = f.token.value.trim() || state.symbols[existing.mint];
    else existing.token = f.token.value.trim();
    store.set('symbols', state.symbols);
  } else {
    state.trades.push(Object.assign({ id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), token: f.token.value.trim(), source: 'manual' }, data));
  }
  f.classList.add('hidden');
  saveTrades();
});
$('#cancelForm').onclick = () => $('#tradeForm').classList.add('hidden');
$('#addBtn').onclick = () => openForm(null);

$('#tradeTable').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  const th = e.target.closest('th[data-sort]');
  if (edit) openForm(state.trades.find((t) => t.id === edit.dataset.edit));
  if (del && confirm('Delete this trade?')) {
    const id = del.dataset.del;
    if (id.startsWith('h_') || id.startsWith('f_')) { state.hidden.push(id); wstore.set('hidden', state.hidden); }
    state.trades = state.trades.filter((t) => t.id !== id);
    saveTrades();
  }
  if (th) {
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
    renderTrades();
  }
});
$('#filterText').oninput = renderTrades;
$('#filterResult').onchange = renderTrades;
$('#filterTag').onchange = renderTrades;

// ---------- wallet sync (Helius) ----------
async function syncFomo() {
  const status = $('#syncStatus');
  const btn = $('#syncBtn');
  btn.disabled = true;
  status.textContent = 'Fetching trades from FOMO…';
  state.lastSync = Date.now();
  try {
    const trades = await fetchFomoTrades(Number(state.settings.syncPages) || 5);
    const prev = new Map(state.trades.filter((t) => t.source === 'fomo').map((t) => [t.id, t]));
    const hidden = new Set(state.hidden);
    const clean = ({ isOpen, unrealized, ...t }) => t;
    const closed = trades.filter((t) => !t.isOpen && t.closedAt && !hidden.has(t.id))
      .map((t) => Object.assign(clean(t), { notes: prev.get(t.id)?.notes || '', tags: prev.get(t.id)?.tags || [] }));
    const manual = state.trades.filter((t) => t.source === 'manual');
    const hadSolTrades = state.unit !== 'USD' && manual.length > 0;
    // Keep every FOMO trade from earlier syncs: fomoapi.io only returns the newest page.
    const before = prev.size;
    const kept = FomoBudget.mergeClosed([...prev.values()], closed, state.hidden);
    state.trades = manual.concat(kept);
    state.open = trades.filter((t) => t.isOpen).map((t) => ({ source: 'fomo', token: t.token, chain: t.chain, address: t.address || '', cost: t.cost, unrealized: t.unrealized, entryPrice: t.entryPrice, amount: t.amount, openedAt: t.openedAt }));
    state.unit = 'USD';
    wstore.set('unit', 'USD');
    wstore.set('open', state.open);
    state.syncInfo = { at: Date.now(), total: trades.length, closed: kept.length, open: state.open.length };
    saveTrades();
    const chains = [...new Set(trades.map((t) => t.chain).filter(Boolean))].join(', ');
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const meta = (state.fomoMeta && (state.fomoMeta['/trades'] || state.fomoMeta['/positions'])) || {};
    const added = Math.max(0, kept.length - before);
    const gap = Number(meta.closedCount) > 0 && Number(meta.closedCount) > kept.length ? ` FOMO reports ${meta.closedCount} closed trades; ${kept.length} are saved here${meta.paging === 'none' ? ' (fomoapi.io only returns the newest page, so history builds up as you sync)' : ''}.` : '';
    const age = Number(meta.ageSeconds) > 0 ? ` It is ${meta.ageSeconds >= 3600 ? (meta.ageSeconds / 3600).toFixed(1) + ' hours' : Math.round(meta.ageSeconds / 60) + ' minutes'} old.` : '';
    const stale = meta.stale ? ` ⚠ fomoapi.io could not reach FOMO and served its last good copy.${age} New trades will appear once FOMO answers again.` : '';
    status.textContent = `Synced from FOMO: ${plural(kept.length, 'closed trade')} saved (${added} new), ${plural(state.open.length, 'open position')}${chains ? ' on ' + chains : ''}. Amounts are in USD.${gap}${stale}`
      + (hadSolTrades ? ' Note: trades you added by hand earlier were entered in SOL. Edit them to USD so the stats add up.' : '')
      + (trades.length && !closed.length ? ' FOMO returned positions but none marked closed. Run the connection check in Settings and send me the report.' : '')
      + ` (${fmtT(Date.now())})`;
    return '';
  } catch (e) {
    status.innerHTML = `<span class="neg">${esc(e.message)}</span>`;
    state.syncInfo = { at: Date.now(), error: e.message };
    renderAll();
    return e.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- FOMO connection check ----------
// Shows what each endpoint returned: status, item counts and field NAMES only (no values), safe to share.
const shapeOf = (j) => {
  const body = unwrap(j);
  const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).slice(0, 40).join(', ') : Array.isArray(o) ? `array[${o.length}]` : typeof o);
  const list = Array.isArray(body) ? body : Object.values(body || {}).find(Array.isArray) || [];
  return { top: keys(j), body: body !== j ? keys(body) : '', items: list.length, item: list[0] ? keys(list[0]) : '' };
};

async function runFomoCheck() {
  const out = $('#checkOut');
  if (!fomoMode()) {
    out.innerHTML = '<p class="neg">Add your fomoapi.io key above and load a username first.</p>';
    return;
  }
  out.innerHTML = '<p class="muted">Checking…</p>';
  const lines = [`FOMO check · ${new Date().toISOString()} · app version ${APP_VERSION}`];
  const rows = [];
  for (const [label, path] of [['Profile', ''], ['Balances', '/balances'], ['Trades', '/trades'], ['Positions', '/positions']]) {
    try {
      const j = await fomoGet(path, path === '/trades' || path === '/positions' ? { limit: 5 } : {});
      const sh = shapeOf(j);
      let parsed = '';
      if (label === 'Profile') { const p = parseFomoProfile(j); const body = unwrap(j) || {}; const pk = body.pnl && typeof body.pnl === 'object' ? Object.keys(body.pnl).map((k) => { const v = body.pnl[k]; return k + ':' + (v == null ? 'null' : typeof v === 'object' ? 'object[' + Object.keys(v).join(',') + ']' : typeof v); }).join(', ') : typeof body.pnl; parsed = `24h ${p.pnl24h ?? '–'}, 7d ${p.pnl7d ?? '–'}, 30d ${p.pnl30d ?? '–'}, all ${p.pnlAll ?? '–'} · pnl keys [${pk}]${p.pnlSource ? ' · source ' + p.pnlSource : ''}${p.pnlNote ? ' · note "' + String(p.pnlNote).slice(0, 80) + '"' : ''}`; }
      if (label === 'Balances') { const b = parseFomoBalances(j); parsed = `${b.tokens.length} holdings, total ${b.totalUsd.toFixed(2)}`; }
      if (label === 'Trades' || label === 'Positions') {
        const list = Array.isArray(unwrap(j)) ? unwrap(j) : listIn(unwrap(j), 'trades', 'positions', 'items', 'data', 'results');
        const ts = list.map(parseFomoTrade);
        const body = unwrap(j) || {};
        const statuses = [...new Set(list.map((r) => String(pick(r, 'status', 'state') ?? '')))].join(', ');
        parsed = `${ts.filter((t) => !t.isOpen && t.closedAt).length} closed, ${ts.filter((t) => t.isOpen).length} open in this sample · status values [${statuses}] · FOMO counts: total ${body.count ?? '?'}, closed ${body.closedCount ?? '?'}, active ${body.activeCount ?? '?'}${body.stale != null ? ', stale ' + body.stale : ''}${body.staleNote ? ' (' + String(body.staleNote).slice(0, 60) + ')' : ''}`;
      }
      rows.push([label, 'OK', sh.items, parsed]);
      lines.push(`${label}: OK · top keys [${sh.top}]${sh.body ? ` · body keys [${sh.body}]` : ''} · items ${sh.items}${sh.item ? ` · item keys [${sh.item}]` : ''} · parsed: ${parsed}`);
    } catch (e) {
      rows.push([label, e.status || 'error', '', e.message]);
      lines.push(`${label}: ${e.status || 'error'} · ${e.message}`);
    }
  }
  if (fomoMode()) {
    try {
      const t0 = Date.now();
      const fetched = await fetchFomoRows('/trades', Number(state.settings.syncPages) || 5);
      const m = (state.fomoMeta && state.fomoMeta['/trades']) || {};
      const parsed = fetched.map(parseFomoTrade);
      const closed = parsed.filter((t) => !t.isOpen && t.closedAt).length;
      const newest = parsed.map((t) => t.closedAt || t.openedAt).filter(Boolean).sort().pop();
      const line = `Trades, all pages: received ${fetched.length} rows (${closed} closed, ${parsed.length - closed} open) vs FOMO counts closed ${m.closedCount ?? '?'} / active ${m.activeCount ?? '?'} · paging ${m.paging || '?'} · ${m.requests || '?'} requests · ${Math.round((Date.now() - t0) / 100) / 10}s${m.stale ? ` · STALE, ${Math.round((Number(m.ageSeconds) || 0) / 60)} min old` : ''}${newest ? ' · newest trade ' + newest.slice(0, 16) : ''}`;
      lines.push(line);
      rows.push(['Trades, all pages', fetched.length >= (Number(m.closedCount) || 0) + (Number(m.activeCount) || 0) ? 'OK' : 'partial', fetched.length, line.replace(/^Trades, all pages: /, '')]);
    } catch (e) { lines.push(`Trades, all pages: ${e.status || 'error'} · ${e.message}`); }
  }
  const report = lines.join('\n');
  out.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Endpoint</th><th>Result</th><th class="num">Items</th><th>App read</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="${r[1] === 'OK' ? 'pos' : 'neg'}">${esc(r[1])}</td><td class="num">${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')
  }</tbody></table></div><p class="muted small">The report below lists field names only, never your balances or trades. Copy it and send it to me if something looks wrong.</p><textarea id="checkReport" readonly rows="8">${esc(report)}</textarea>
  <button type="button" class="btn" id="copyReport">Copy report</button> <span id="copyMsg" class="muted small"></span>`;
  $('#copyReport').onclick = async () => {
    const ta = $('#checkReport');
    try { await navigator.clipboard.writeText(ta.value); $('#copyMsg').textContent = 'Copied.'; }
    catch { ta.select(); $('#copyMsg').textContent = 'Press and hold to copy the selected text.'; }
  };
}

// Pull the wallet's recent swaps from Helius into state.swaps (accumulates across syncs).
async function fetchHeliusSwaps(status) {
  const { wallet, heliusKey, syncPages } = state.settings;
  let before = '', fetched = 0, added = 0;
  for (let page = 0; page < (Number(syncPages) || 5); page++) {
    if (status) status.textContent = `Reading wallet swaps from the chain… page ${page + 1}`;
    const url = `https://api.helius.xyz/v0/addresses/${encodeURIComponent(wallet)}/transactions?api-key=${encodeURIComponent(heliusKey)}&type=SWAP&limit=100${before ? '&before=' + before : ''}`;
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text();
      if (r.status === 404 && fetched) break; // no more history in range
      throw new Error(`Helius HTTP ${r.status}: ${body.slice(0, 200)}`);
    }
    const txs = await r.json();
    if (!Array.isArray(txs) || !txs.length) break;
    fetched += txs.length;
    for (const tx of txs) {
      const s = Stats.parseSwap(tx, wallet);
      if (s && !state.swaps[s.sig]) { state.swaps[s.sig] = s; added++; }
    }
    before = txs[txs.length - 1].signature;
    if (txs.length < 100) break;
  }
  wstore.set('swaps', state.swaps);
  return { fetched, added };
}

// All-chain mode: fomoapi.io can lag behind FOMO (it caches). Read the Solana wallet from the chain and add
// the trades FOMO does not list yet, in USD at today's SOL price. FOMO's own figure replaces each one once it arrives.
async function mergeChainTrades() {
  const { wallet, heliusKey } = state.settings;
  if (!wallet || !heliusKey || !isAddress(wallet)) return null;
  const { fetched } = await fetchHeliusSwaps($('#syncStatus'));
  const { closed, open } = Stats.pairSwaps(Object.values(state.swaps));
  const solPrice = (await fetchPrices([Stats.SOL_MINT]))[Stats.SOL_MINT];
  if (!(solPrice > 0)) throw new Error('SOL price unavailable, cannot convert chain trades to USD');
  const fomoSol = state.trades.filter((t) => t.source === 'fomo' && /sol/i.test(t.chain || ''));
  const near = (a, b) => Math.abs(new Date(a) - new Date(b)) < 20 * 60000;
  const known = (h) => fomoSol.some((t) => t.address === h.mint && near(t.closedAt, h.closedAt));
  const hidden = new Set(state.hidden);
  const prev = new Map(state.trades.filter((t) => t.source === 'helius').map((t) => [t.id, t]));
  const fresh = closed.filter((h) => !hidden.has(h.id) && !known(h)).map((h) => {
    const old = prev.get(h.id);
    return { id: h.id, token: h.mint, mint: h.mint, address: h.mint, chain: 'Solana', openedAt: h.openedAt, closedAt: h.closedAt, cost: h.cost * solPrice, proceeds: h.proceeds * solPrice, notes: old?.notes || '', tags: old?.tags || [], source: 'helius', viaChain: true };
  });
  state.trades = state.trades.filter((t) => t.source !== 'helius').concat(fresh);
  const fomoOpen = new Set(state.open.filter((p) => p.source === 'fomo').map((p) => p.address || p.mint));
  const extraOpen = open.filter((p) => !fomoOpen.has(p.mint)).map((p) => ({ source: 'chain', mint: p.mint, address: p.mint, token: state.symbols[p.mint] || short(p.mint), chain: 'Solana', qty: p.qty, cost: p.cost * solPrice, openedAt: p.openedAt }));
  state.open = state.open.filter((p) => p.source !== 'chain').concat(extraOpen);
  wstore.set('open', state.open);
  await resolveSymbols([...fresh.map((t) => t.mint), ...extraOpen.map((p) => p.mint)]);
  for (const p of state.open) if (p.source === 'chain') p.token = state.symbols[p.mint] || p.token;
  saveTrades();
  return { fetched, fresh: fresh.length, extraOpen: extraOpen.length, solPrice };
}

async function syncTrades() {
  if (fomoMode()) {
    const err = await syncFomo();
    if (state.settings.heliusKey && state.settings.wallet) {
      const status = $('#syncStatus');
      const fomoLine = status.innerHTML;
      try {
        const m = await mergeChainTrades();
        status.innerHTML = fomoLine;
        if (m) status.innerHTML += ` <b>Chain:</b> ${m.fresh} recent Solana trade${m.fresh === 1 ? '' : 's'} and ${m.extraOpen} open position${m.extraOpen === 1 ? '' : 's'} not yet in FOMO's list were read from your wallet via Helius (USD at today's SOL price, ${usd(m.solPrice)}).`;
      } catch (e) { status.innerHTML = fomoLine + ` <span class="neg">Chain read failed: ${esc(e.message)}</span>`; }
    }
    if (!err) maybeAutoTune();
    if (!err && typeof autoSnapshotPositions === 'function') autoSnapshotPositions();
    if (!err && typeof autoDraftTheses === 'function') autoDraftTheses();
    return err;
  }
  const { wallet, heliusKey } = state.settings;
  const status = $('#syncStatus');
  if (!wallet || !heliusKey) {
    status.innerHTML = '<span class="neg">Sync needs your wallet address and a free Helius API key (Settings).</span>';
    return;
  }
  const btn = $('#syncBtn');
  btn.disabled = true;
  try {
    const { fetched, added } = await fetchHeliusSwaps(status);
    const { closed, open } = Stats.pairSwaps(Object.values(state.swaps));
    const prev = new Map(state.trades.filter((t) => t.source === 'helius').map((t) => [t.id, t]));
    const hidden = new Set(state.hidden);
    const synced = closed.filter((t) => !hidden.has(t.id)).map((t) => {
      const old = prev.get(t.id);
      if (old) { t.notes = old.notes; t.tags = old.tags || []; }
      delete t.sigs;
      return t;
    });
    state.trades = state.trades.filter((t) => t.source !== 'helius').concat(synced);
    state.open = open.map((p) => ({ mint: p.mint, qty: p.qty, cost: p.cost, openedAt: p.openedAt }));
    wstore.set('open', state.open);
    await resolveSymbols([...synced.map((t) => t.mint), ...state.open.map((p) => p.mint)]);
    saveTrades();
    status.textContent = `Synced: ${fetched} swap txs scanned, ${added} new, ${synced.length} closed trades, ${state.open.length} open positions.`;
    maybeAutoTune();
    if (typeof autoSnapshotPositions === 'function') autoSnapshotPositions();
    if (typeof autoDraftTheses === 'function') autoDraftTheses();
  } catch (e) {
    status.innerHTML = `<span class="neg">${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}
$('#syncBtn').onclick = syncTrades;
$('#checkBtn').onclick = runFomoCheck;

// ---------- CSV ----------
const CSV_COLS = ['token', 'openedAt', 'closedAt', 'cost', 'proceeds', 'notes', 'tags'];
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#exportBtn').onclick = () => {
  const lines = [CSV_COLS.concat('pnl', 'pnlPct').join(',')].concat(state.trades.map(Stats.enrich).map((t) =>
    [tokenName(t), t.openedAt, t.closedAt, t.cost, t.proceeds, t.notes, (t.tags || []).join('|'), t.pnl.toFixed(6), (t.pnlPct * 100).toFixed(2)].map(csvCell).join(',')));
  download('fomo-trades.csv', lines.join('\n'), 'text/csv');
};
$('#importFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const rows = parseCsv(await file.text());
  const head = rows.shift().map((h) => h.trim());
  const idx = Object.fromEntries(CSV_COLS.map((c) => [c, head.indexOf(c)]));
  if (idx.closedAt < 0 || idx.cost < 0 || idx.proceeds < 0) { alert('CSV needs columns: closedAt, cost, proceeds (optional: ' + CSV_COLS.filter((c) => !['closedAt', 'cost', 'proceeds'].includes(c)).join(', ') + ')'); return; }
  let n = 0;
  for (const r of rows) {
    const closed = new Date(r[idx.closedAt]);
    if (isNaN(closed)) continue;
    const opened = idx.openedAt >= 0 && r[idx.openedAt] ? new Date(r[idx.openedAt]) : closed;
    state.trades.push({
      id: 'm_' + Date.now().toString(36) + (n++), source: 'manual',
      token: idx.token >= 0 ? r[idx.token] : '?', openedAt: opened.toISOString(), closedAt: closed.toISOString(),
      cost: Number(r[idx.cost]) || 0, proceeds: Number(r[idx.proceeds]) || 0, notes: idx.notes >= 0 ? r[idx.notes] : '',
      tags: idx.tags >= 0 ? parseTags(r[idx.tags]) : [],
    });
  }
  e.target.value = '';
  saveTrades();
  alert(`Imported ${n} trades.`);
};

// ---------- PnL calendar ----------
// The calendar always uses every trade (not the last-N window), so whole months stay complete.
function calMonthDefault() {
  const last = state.trades.map((t) => new Date(t.closedAt)).filter((d) => !isNaN(d)).sort((a, b) => b - a)[0] || new Date();
  return { y: last.getFullYear(), m: last.getMonth() };
}

// Short cell label: +34, -240, +1.2k (SOL keeps two decimals under 10).
const compactPnl = (n) => {
  const a = Math.abs(n), sign = n > 0 ? '+' : n < 0 ? '-' : '';
  const body = a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : a >= 10 ? Math.round(a) : a.toFixed(isUsd() ? 1 : 2);
  return sign + body;
};
const shortDay = (key) => new Date(key + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function renderCalendar() {
  if (!state.cal) state.cal = calMonthDefault();
  const { y, m } = state.cal;
  const days = Stats.byDay(state.trades);
  const sum = Stats.monthSummary(days, y, m);
  $('#calTitle').textContent = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#calUnit').textContent = `Daily realized PnL in ${isUsd() ? 'USD' : 'SOL'}, by close date. Tap a day to see its trades.`;
  $('#calSummary').innerHTML = sum.trades
    ? `<span>Month <b class="${cls(sum.pnl)}">${sgnAmt(sum.pnl)}</b></span><span>${sum.trades} trade${sum.trades === 1 ? '' : 's'}</span><span><b class="pos">${sum.greenDays}</b> green / <b class="neg">${sum.redDays}</b> red days</span>`
      + (sum.best ? `<span>Best ${shortDay(sum.best.day)} <b class="pos">${sgnAmt(sum.best.pnl)}</b></span>` : '')
      + (sum.worst ? `<span>Worst ${shortDay(sum.worst.day)} <b class="neg">${sgnAmt(sum.worst.pnl)}</b></span>` : '')
    : '<span class="muted">No closed trades this month.</span>';
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const count = new Date(y, m + 1, 0).getDate();
  const todayKey = Stats.dayKey(new Date());
  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  html += '<div class="cal-cell empty"></div>'.repeat(lead);
  for (let d = 1; d <= count; d++) {
    const key = Stats.dayKey(new Date(y, m, d));
    const g = days[key];
    const a = g && sum.maxAbs ? 0.18 + 0.62 * Math.min(1, Math.abs(g.pnl) / sum.maxAbs) : 0;
    const bg = g ? (g.pnl > 0 ? `rgba(34,197,94,${a.toFixed(2)})` : g.pnl < 0 ? `rgba(239,68,68,${a.toFixed(2)})` : 'var(--panel2)') : '';
    html += `<button type="button" class="cal-cell${g ? ' has' : ''}${key === todayKey ? ' today' : ''}${state.calDay === key ? ' sel' : ''}" data-day="${key}" ${g ? `style="background:${bg}"` : 'disabled'} aria-label="${key}${g ? ': ' + g.count + ' trades' : ''}">`
      + `<span class="cal-d">${d}</span>${g ? `<span class="cal-p">${compactPnl(g.pnl)}</span><span class="cal-n">${g.count}</span>` : ''}</button>`;
  }
  $('#calGrid').innerHTML = html;
  const sel = state.calDay && days[state.calDay] && state.calDay.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`) ? days[state.calDay] : null;
  $('#calDetail').innerHTML = sel
    ? `<h3>${new Date(state.calDay + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · <span class="${cls(sel.pnl)}">${sgnAmt(sel.pnl)}</span> · ${sel.wins}W / ${sel.losses}L</h3>`
      + sel.trades.slice().sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt)).map((t) => `<div class="recent-item"><span>${esc(tokenName(t))}${t.chain ? `<span class="tag">${esc(t.chain)}</span>` : ''}${tagChips(t.tags)} <span class="muted small">${fmtT(t.closedAt)}</span></span><span class="${cls(t.pnl)}">${sgnAmt(t.pnl)} (${signed(t.pnlPct * 100, 1)}%)</span></div>`).join('')
    : '';
}
$('#calGrid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-day]');
  if (!c) return;
  state.calDay = state.calDay === c.dataset.day ? null : c.dataset.day;
  renderCalendar();
});
$('#calPrev').onclick = () => { const { y, m } = state.cal; state.cal = m ? { y, m: m - 1 } : { y: y - 1, m: 11 }; renderCalendar(); };
$('#calNext').onclick = () => { const { y, m } = state.cal; state.cal = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }; renderCalendar(); };

function groupRows(groups) {
  return groups.map((g) => `<tr${g.count ? '' : ' class="muted"'}><td>${esc(g.label)}</td><td class="num">${g.count || '–'}</td><td class="num">${g.count ? pct(g.winRate, 0) : '–'}</td><td class="num ${cls(g.pnl)}">${g.count ? sgnAmt(g.pnl, 4) : '–'}</td><td class="num ${cls(g.pnl)}">${g.count ? pct(g.roi) : '–'}</td></tr>`).join('');
}

function timingInsights(weekdays, holds) {
  const out = [];
  const wd = weekdays.filter((g) => g.count >= 3).sort((a, b) => b.pnl - a.pnl);
  if (wd.length >= 2) {
    if (wd[0].pnl > 0) out.push(`Your best day is <b>${wd[0].label}</b> (${sgnAmt(wd[0].pnl)}, ${pct(wd[0].winRate, 0)} win rate).`);
    if (wd[wd.length - 1].pnl < 0) out.push(`<b>${wd[wd.length - 1].label}</b> is your worst day (${sgnAmt(wd[wd.length - 1].pnl)}). Consider trading less then.`);
  }
  const hd = holds.filter((g) => g.count >= 3).sort((a, b) => b.roi - a.roi);
  if (hd.length >= 2 && hd[0].roi > 0) out.push(`Trades held <b>${hd[0].label}</b> return the most (${pct(hd[0].roi)} ROI over ${hd[0].count} trades)${hd[hd.length - 1].roi < 0 ? `, while <b>${hd[hd.length - 1].label}</b> holds lose money (${pct(hd[hd.length - 1].roi)})` : ''}.`);
  return out;
}

// ---------- analytics ----------
function renderAnalytics() {
  const trades = lastN(state.trades, +$('#anaWindow').value);
  const s = Stats.computeStats(trades);

  barChart('pnlBars', s.trades.map((t, i) => '#' + (i + 1) + ' ' + tokenName(t)), s.trades.map((t) => t.pnl),
    s.trades.map((t) => (t.pnl >= 0 ? THEME.green : THEME.red)), { scales: { x: { ticks: { display: false } } } });

  const buckets = [[-Infinity, -0.75, '≤-75%'], [-0.75, -0.5, '-75…-50'], [-0.5, -0.25, '-50…-25'], [-0.25, 0, '-25…0'],
    [0, 0.25, '0…25'], [0.25, 0.5, '25…50'], [0.5, 1, '50…100'], [1, 2, '100…200'], [2, Infinity, '≥200%']];
  barChart('distChart', buckets.map((b) => b[2]), buckets.map(([lo, hi]) => s.trades.filter((t) => t.pnlPct >= lo && t.pnlPct < hi).length),
    buckets.map(([lo]) => (lo < 0 ? THEME.red : THEME.green)));

  const hours = Array.from({ length: 24 }, () => ({ n: 0, w: 0 }));
  for (const t of s.trades) { const h = new Date(t.openedAt || t.closedAt).getHours(); hours[h].n++; if (t.pnl > 0) hours[h].w++; }
  barChart('hourChart', hours.map((_, i) => i + ':00'), hours.map((h) => (h.n ? (h.w / h.n) * 100 : 0)),
    hours.map((h) => (h.n ? (h.w / h.n >= 0.5 ? THEME.green : THEME.red) : THEME.border)),
    { scales: { y: { max: 100, ticks: { callback: (v) => v + '%' } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => hours[c.dataIndex].n + ' trades' } } } });

  const groups = Stats.byToken(trades.map((t) => Object.assign({}, t, { token: tokenName(t) })));
  const byChain = Stats.byToken(trades.filter((t) => t.chain).map((t) => Object.assign({}, t, { token: t.chain })));
  $('#chainCard').hidden = !byChain.length;
  $('#chainTable tbody').innerHTML = byChain.map((g) =>
    `<tr><td>${esc(g.token)}</td><td class="num">${g.count}</td><td class="num">${pct(g.wins / g.count, 0)}</td><td class="num ${cls(g.pnl)}">${sgnAmt(g.pnl, 4)}</td><td class="num ${cls(g.pnl)}">${g.cost ? pct(g.pnl / g.cost) : '–'}</td></tr>`).join('');
  const setups = Stats.byTag(trades);
  const anyTagged = setups.some((g) => g.tag !== 'Untagged');
  $('#tagHint').hidden = anyTagged;
  $('#tagTable').hidden = !anyTagged;
  $('#tagTable tbody').innerHTML = setups.map((g) =>
    `<tr><td>${g.tag === 'Untagged' ? '<span class="muted">Untagged</span>' : esc(g.tag)}</td><td class="num">${g.count}</td><td class="num">${pct(g.winRate, 0)}</td><td class="num ${cls(g.pnl)}">${sgnAmt(g.pnl, 4)}</td><td class="num hide-m ${cls(g.avgPct)}">${signed(g.avgPct * 100, 1)}%</td><td class="num ${cls(g.expectancy)}">${sgnAmt(g.expectancy, 4)}</td></tr>`).join('');
  $('#tokenTable tbody').innerHTML = groups.map((g) =>
    `<tr><td>${esc(g.token)}</td><td class="num">${g.count}</td><td class="num">${pct(g.wins / g.count, 0)}</td><td class="num ${cls(g.pnl)}">${signed(g.pnl, 4)}</td><td class="num ${cls(g.pnl)}">${g.cost ? pct(g.pnl / g.cost) : '–'}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">No trades.</td></tr>';

  renderCalendar();
  const weekdays = Stats.byWeekday(trades);
  const holds = Stats.byHoldTime(trades);
  $('#weekdayTable tbody').innerHTML = groupRows(weekdays);
  $('#holdTable tbody').innerHTML = groupRows(holds);
  $('#insights').innerHTML = insights(s, groups, hours).concat(setupInsights(setups), timingInsights(weekdays, holds)).map((i) => `<li>${i}</li>`).join('') || '<li class="muted">Log some trades to get insights.</li>';
  if (typeof renderLessons === 'function') renderLessons();
  if (typeof renderAgeTable === 'function') renderAgeTable(trades);
  if (typeof renderFeeDrag === 'function') renderFeeDrag();
}

function setupInsights(setups) {
  const real = setups.filter((g) => g.tag !== 'Untagged' && g.count >= 3);
  if (real.length < 2) return [];
  const best = real[0], worst = real[real.length - 1];
  const out = [];
  if (best.pnl > 0) out.push(`Your best setup is <b>${esc(best.tag)}</b>: ${pct(best.winRate, 0)} win rate, ${sgnAmt(best.expectancy)} per trade over ${best.count} trades.`);
  if (worst.pnl < 0) out.push(`<b>${esc(worst.tag)}</b> is losing you money: ${sgnAmt(worst.pnl)} over ${worst.count} trades (${pct(worst.winRate, 0)} win rate). Consider skipping it or sizing it smaller.`);
  return out;
}

function insights(s, groups, hours) {
  const out = [];
  if (s.count < 5) return out;
  if (s.payoff > 0) {
    const be = 1 / (1 + s.payoff);
    out.push(`With your payoff ratio of <b>${fmt(s.payoff, 2)}</b>, you need a <b>${pct(be)}</b> win rate to break even. You're at <b class="${s.winRate >= be ? 'pos' : 'neg'}">${pct(s.winRate)}</b>.`);
  }
  const wins = s.trades.filter((t) => t.pnl > 0), losses = s.trades.filter((t) => t.pnl < 0);
  const avgHold = (arr) => { const v = arr.map((t) => new Date(t.closedAt) - new Date(t.openedAt)).filter((x) => x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  const hw = avgHold(wins), hl = avgHold(losses);
  if (hw && hl) {
    if (hl > hw * 1.5) out.push(`You hold losers about <b>${fmt(hl / hw, 1)}×</b> longer than winners (${dur(hl)} vs ${dur(hw)}). That usually means stops get moved or ignored.`);
    else if (hw > hl * 1.5) out.push(`You hold winners longer than losers (${dur(hw)} vs ${dur(hl)}). You're letting winners run and cutting losers.`);
  }
  if (s.avgLossPct > 0.4) out.push(`Your average loss is <b class="neg">-${pct(s.avgLossPct)}</b>. A tighter stop, or a smaller size on entries you're unsure about, would cut drawdown.`);
  if (s.largestWin > 0 && s.netPnl > 0 && s.largestWin > s.netPnl) out.push(`Your single best trade (${amt(s.largestWin)}) is bigger than your total net PnL. Without it you'd be negative, so your edge depends on outliers.`);
  if (s.currentStreak <= -3) out.push(`You're on a <b class="neg">${-s.currentStreak}-trade losing streak</b>. Consider halving size until you log a win.`);
  if (groups.length > 1) {
    const best = groups[0], worst = groups[groups.length - 1];
    if (best.pnl > 0) out.push(`Best token: <b>${esc(best.token)}</b> (${sgnAmt(best.pnl)} over ${best.count} trades).`);
    if (worst.pnl < 0) out.push(`Worst token: <b>${esc(worst.token)}</b> (${sgnAmt(worst.pnl)} over ${worst.count} trades).`);
  }
  const active = hours.map((h, i) => ({ i, ...h })).filter((h) => h.n >= 3);
  if (active.length >= 2) {
    active.sort((a, b) => b.w / b.n - a.w / a.n);
    const b = active[0], w = active[active.length - 1];
    out.push(`Your best entry hour is <b>${b.i}:00</b> (${pct(b.w / b.n, 0)} win rate) and your worst is <b>${w.i}:00</b> (${pct(w.w / w.n, 0)}).`);
  }
  return out;
}

// ---------- risk rules ----------
function currentRisk() {
  return Stats.riskStatus(state.trades, { lossLimit: Number(state.settings.lossLimit) || 0, maxLossStreak: Number(state.settings.maxLossStreak) || 0 });
}

function renderRisk() {
  const lossLimit = Number(state.settings.lossLimit) || 0;
  const maxStreak = Number(state.settings.maxLossStreak) || 0;
  const banner = $('#riskBanner');
  const r = currentRisk();
  const today = `Today: <b class="${cls(r.todayPnl)}">${sgnAmt(r.todayPnl)}</b> over ${r.todayTrades} closed trade${r.todayTrades === 1 ? '' : 's'}`
    + (lossLimit ? ` of a ${amt(lossLimit)} loss limit` : '')
    + (r.streak ? ` · ${r.streak} loss${r.streak === 1 ? '' : 'es'} in a row` : '');
  const msgs = {
    limit: `Daily loss limit hit. Stop trading for today.`,
    streak: `${r.streak} losses in a row. Take a break before the next trade.`,
    nearLimit: `You've used ${pct(r.limitUsed, 0)} of today's loss limit. Trade smaller or stop.`,
    nearStreak: `One more loss hits your ${maxStreak}-loss stop rule.`,
  };
  if (!state.trades.length || (!lossLimit && !maxStreak) || r.level === 'ok') { banner.hidden = true; }
  else {
    banner.hidden = false;
    banner.className = 'risk-banner ' + r.level;
    const head = r.level === 'ok' ? '' : `<b>${r.reasons.map((k) => msgs[k]).join(' ')}</b>`;
    banner.innerHTML = head + `<span>${today}</span>`
      + (lossLimit ? `<div class="meter" aria-label="Daily loss limit used"><i style="width:${Math.min(100, r.limitUsed * 100).toFixed(0)}%"></i></div>` : '')
      + (r.level === 'ok' ? '' : '<span class="small">Change these rules on the Sizing tab.</span>');
  }
  $('#riskNow').innerHTML = today + (r.level !== 'ok' ? ` · <b class="${r.level === 'stop' ? 'neg' : ''}">${r.level === 'stop' ? 'Rule broken' : 'Close to a rule'}</b>` : '');
}

function applyRiskForm() {
  const f = $('#riskForm');
  f.lossLimit.value = state.settings.lossLimit ?? '';
  f.maxLossStreak.value = state.settings.maxLossStreak ?? '';
}
$('#riskForm').addEventListener('submit', (e) => e.preventDefault());
$('#riskForm').addEventListener('input', () => {
  const f = $('#riskForm');
  state.settings.lossLimit = f.lossLimit.value;
  state.settings.maxLossStreak = f.maxLossStreak.value;
  store.set('settings', state.settings);
  renderRisk();
  renderSizing();
});

// ---------- sizing ----------
function renderSizing() {
  renderRisk();
  const f = $('#sizeForm');
  if (!f.balance.value && accountBalance() != null) f.balance.value = accountBalance();
  const balance = Number(f.balance.value);
  const riskPct = Number(f.riskPct.value) / 100;
  const stopPct = Number(f.stopPct.value) / 100;
  const maxPct = Number(f.maxPct.value) / 100;
  const mult = Number(f.kellyMult.value);
  const s = Stats.computeStats(lastN(state.trades, +f.statsWindow.value));
  const solPrice = state.wallet?.solPrice;
  const usdOf = (n) => (solPrice && !isUsd() ? ' <span class="muted small">≈ ' + usd(n * solPrice) + '</span>' : '');

  const risk = Stats.riskSize({ balance, riskPct, stopPct, maxPct });
  const k = Stats.kelly(s.winRate, s.payoff);
  const enoughData = s.wins + s.losses >= 10;
  let kSize = Math.max(0, k * mult * balance);
  const kCapped = maxPct > 0 && kSize > balance * maxPct;
  if (kCapped) kSize = balance * maxPct;
  const hist = s.avgLossPct > 0 ? Stats.riskSize({ balance, riskPct, stopPct: s.avgLossPct, maxPct }) : null;

  const candidates = [risk.size];
  if (enoughData && k > 0) candidates.push(kSize);
  let rec = enoughData && k <= 0 ? risk.size * 0.5 : Math.min(...candidates);
  const rs = currentRisk();
  const recNote = rs.level === 'stop' ? 'A risk rule is broken, so the suggestion is zero until tomorrow or your next win.'
    : rs.level === 'warn' ? 'Halved: you are close to a risk rule.'
    : enoughData && k <= 0 ? 'Halved: your recent stats show no edge.' : 'Smaller of the risk-based and Kelly sizes.';
  if (rs.level === 'stop') rec = 0;
  else if (rs.level === 'warn') rec *= 0.5;
  state.sizeRec = rec;

  if (!(balance > 0)) {
    $('#sizeOut').innerHTML = '<p class="muted">Enter a balance, or load your wallet balance.</p>'
      + (enoughData ? `<p class="muted small">Your full Kelly from this window: ${pct(k)} of balance (win rate ${pct(s.winRate)}, payoff ${fmt(s.payoff, 2)}).</p>` : '');
    return;
  }
  let html = `<div class="size-block"><h3>Recommended per trade</h3><div class="size-big">${amt(rec, 3)}${usdOf(rec)}</div>
    <div class="muted small">${balance > 0 ? pct(rec / balance) + ' of balance. ' : ''}${recNote}</div></div>`;
  html += `<div class="size-block"><h3>Risk-based</h3><div class="size-big">${amt(risk.size, 3)}${usdOf(risk.size)}</div>
    <div class="muted small">Lose ${amt(risk.maxLoss || 0, 3)} (${pct(riskPct)}) if price drops ${pct(stopPct, 0)}.${risk.capped ? ' Capped at max position.' : ''}</div></div>`;
  html += `<div class="size-block"><h3>Kelly (${mult === 1 ? 'full' : mult === 0.5 ? '½' : '¼'})</h3>`;
  if (!enoughData) html += `<div class="muted">You need at least 10 decided trades in this window (you have ${s.wins + s.losses}).</div>`;
  else html += `<div class="size-big ${k > 0 ? '' : 'neg'}">${k > 0 ? amt(kSize, 3) + usdOf(kSize) : 'No edge'}</div>
    <div class="muted small">Win rate ${pct(s.winRate)} · payoff ${fmt(s.payoff, 2)} → full Kelly ${pct(k)} of balance.${kCapped ? ' Capped at max position.' : ''}</div>`;
  html += '</div>';
  if (hist) html += `<div class="size-block"><h3>Using your real avg loss as the stop</h3><div class="size-big">${amt(hist.size, 3)}${usdOf(hist.size)}</div>
    <div class="muted small">Your average losing trade is -${pct(s.avgLossPct)}. Sizing to that keeps a typical loss at ${pct(riskPct)} of balance.</div></div>`;
  $('#sizeOut').innerHTML = html;
}
// ---------- sizing: saved inputs + auto-tune ----------
const SIZING_FIELDS = ['riskPct', 'stopPct', 'maxPct', 'statsWindow', 'kellyMult'];
function applySizingForm() {
  const f = $('#sizeForm');
  const saved = state.settings.sizing || {};
  for (const k of SIZING_FIELDS) if (saved[k] != null && saved[k] !== '') f[k].value = saved[k];
  $('#autoTune').checked = !!state.settings.autoTune;
  renderTuneInfo();
}
function saveSizingForm() {
  const f = $('#sizeForm');
  const o = {};
  for (const k of SIZING_FIELDS) o[k] = f[k].value;
  state.settings.sizing = o;
  store.set('settings', state.settings);
}
$('#sizeForm').addEventListener('input', () => { saveSizingForm(); renderSizing(); });
$('#autoTune').addEventListener('change', (e) => { state.settings.autoTune = e.target.checked; store.set('settings', state.settings); if (e.target.checked) tuneSizing({ silent: false }); });
$('#tuneBtn').onclick = () => tuneSizing({ silent: false });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundAmt = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 100) / 100);

// Rule-based proposal from the last 50 trades. Each number comes with the reason in plain words.
function tuneByRules() {
  const trades = lastN(state.trades, 50);
  const s = Stats.computeStats(trades);
  const balance = Number(accountBalance()) || Number($('#sizeForm').balance.value) || 0;
  if (s.wins + s.losses < 10) return { ok: false, reason: `Auto-tune needs at least 10 decided trades; you have ${s.wins + s.losses}.` };
  const lossPcts = s.trades.filter((t) => t.outcome < 0).map((t) => -t.pnlPct).sort((a, b) => a - b);
  const medianLoss = lossPcts.length ? lossPcts[Math.floor(lossPcts.length / 2)] : 0.3;
  const stopPct = clamp(Math.round(medianLoss * 100 / 5) * 5, 15, 60);
  const ddPct = balance > 0 ? s.maxDrawdown / balance : 0;
  const k = Stats.kelly(s.winRate, s.payoff);
  const why = [];
  let riskPct = 2;
  if (s.winRate < 0.4 || s.profitFactor < 1.2) { riskPct = 1; why.push(`risk 1%: win rate ${pct(s.winRate, 0)} and profit factor ${fmt(s.profitFactor, 2)} show a thin edge`); }
  else if (s.profitFactor >= 2 && s.winRate >= 0.5 && ddPct < 0.1) { riskPct = 3; why.push(`risk 3%: profit factor ${fmt(s.profitFactor, 2)}, ${pct(s.winRate, 0)} win rate, shallow drawdown`); }
  else why.push(`risk 2%: edge is positive (profit factor ${fmt(s.profitFactor, 2)}) but not strong`);
  if (ddPct >= 0.15) { riskPct = Math.min(riskPct, 1); why.push(`drawdown is ${pct(ddPct, 0)} of balance, so risk is capped at 1%`); }
  if (s.currentStreak <= -3) { riskPct = Math.max(0.5, riskPct / 2); why.push(`${-s.currentStreak} losses in a row, so risk is halved until a win`); }
  why.push(`stop ${stopPct}%: your median losing trade is ${pct(medianLoss, 0)}`);
  const maxPct = k <= 0 ? 10 : s.avgLossPct > 0.5 ? 10 : k > 0.3 && s.count >= 30 ? 25 : 20;
  why.push(`max position ${maxPct}%${k <= 0 ? ' because Kelly shows no edge right now' : s.avgLossPct > 0.5 ? ' because your average loss is over 50%' : ''}`);
  const kellyMult = s.count >= 50 && s.profitFactor >= 1.5 && k > 0 ? 0.5 : 0.25;
  const lossLimit = balance > 0 ? roundAmt(Math.max(0.03 * balance, 2 * s.avgLoss)) : '';
  if (lossLimit) why.push(`daily loss limit ${amt(lossLimit, 0)}: about 2 average losses or 3% of balance, whichever is larger`);
  const maxLossStreak = s.winRate < 0.4 ? 4 : 3;
  return { ok: true, values: { riskPct, stopPct, maxPct, kellyMult, lossLimit, maxLossStreak }, why, stats: s, balance };
}

// Optional: Claude refines the rule-based proposal using the same stats; answers are clamped to safe ranges.
async function tuneByClaude(base) {
  const key = state.settings.anthropicKey;
  if (!key) return null;
  const s = base.stats;
  const evidence = {
    balance: base.balance, unit: isUsd() ? 'USD' : 'SOL', trades: s.count, winRate: s.winRate, profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : 99,
    avgWinPct: s.avgWinPct, avgLossPct: s.avgLossPct, payoff: s.payoff, expectancyPct: s.expectancyPct, maxDrawdown: s.maxDrawdown,
    currentStreak: s.currentStreak, longestLossStreak: s.longestLossStreak, avgHoldHours: s.avgHoldMs / 3600e3,
    largestLoss: s.largestLoss, largestWin: s.largestWin, kellyFull: Stats.kelly(s.winRate, s.payoff),
    bySetup: Stats.byTag(lastN(state.trades, 50)).map((g) => ({ setup: g.tag, trades: g.count, winRate: g.winRate, pnl: g.pnl })),
    rulesProposal: base.values, rulesWhy: base.why,
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({
      model: 'claude-opus-5-5', max_tokens: 600, fallbacks: 'default', output_config: { effort: 'low' },
      system: 'You are a position-sizing coach for a frequent memecoin trader. You receive their recent stats and a rule-based proposal. Reply with ONLY a JSON object, no prose, with keys: riskPct (0.5 to 3, percent of balance risked per trade), stopPct (10 to 70), maxPct (5 to 30), kellyMult (0.25, 0.5 or 1), lossLimit (daily loss limit in the given unit, between 1% and 10% of balance, or 0 to turn it off), maxLossStreak (2 to 5), note (under 60 words, plain English, second person, no disclaimers: what you changed from the proposal and why, grounded in the numbers). Start from the proposal and change a value only when the stats justify it.',
      messages: [{ role: 'user', content: JSON.stringify(evidence) }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  if (j.stop_reason === 'refusal') throw new Error('Claude declined.');
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in the answer.');
  const o = JSON.parse(m[0]);
  const v = base.values;
  const num = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const bal = base.balance;
  return {
    values: {
      riskPct: clamp(num(o.riskPct, v.riskPct), 0.5, 3),
      stopPct: Math.round(clamp(num(o.stopPct, v.stopPct), 10, 70)),
      maxPct: Math.round(clamp(num(o.maxPct, v.maxPct), 5, 30)),
      kellyMult: [0.25, 0.5, 1].includes(num(o.kellyMult, v.kellyMult)) ? num(o.kellyMult, v.kellyMult) : v.kellyMult,
      lossLimit: bal > 0 ? (num(o.lossLimit, v.lossLimit) === 0 ? 0 : roundAmt(clamp(num(o.lossLimit, v.lossLimit), 0.01 * bal, 0.1 * bal))) : v.lossLimit,
      maxLossStreak: Math.round(clamp(num(o.maxLossStreak, v.maxLossStreak), 2, 5)),
    },
    note: String(o.note || '').slice(0, 400),
  };
}

async function tuneSizing({ silent }) {
  const info = $('#tuneInfo');
  const base = tuneByRules();
  if (!base.ok) { if (!silent) info.textContent = base.reason; return; }
  if (!silent) info.textContent = state.settings.anthropicKey ? 'Tuning with Claude…' : 'Tuning from your stats…';
  let ai = null, aiErr = '';
  try { ai = await tuneByClaude(base); } catch (e) { aiErr = e.message; }
  const v = ai ? ai.values : base.values;
  const f = $('#sizeForm');
  f.riskPct.value = v.riskPct; f.stopPct.value = v.stopPct; f.maxPct.value = v.maxPct; f.kellyMult.value = String(v.kellyMult);
  state.settings.lossLimit = v.lossLimit === '' ? '' : String(v.lossLimit);
  state.settings.maxLossStreak = String(v.maxLossStreak);
  applyRiskForm();
  saveSizingForm();
  state.settings.tuneInfo = { at: Date.now(), by: ai ? 'Claude' : 'rules', note: ai ? ai.note : base.why.join('; '), aiErr, trades: base.stats.count };
  store.set('settings', state.settings);
  renderSizing();
  renderTuneInfo();
}

function renderTuneInfo() {
  const t = state.settings.tuneInfo;
  const el = $('#tuneInfo');
  if (!t) { el.textContent = state.settings.anthropicKey ? 'Sets the inputs above and the risk rules from your last 50 trades, refined by Claude.' : 'Sets the inputs above and the risk rules from your last 50 trades. Add an Anthropic key in Settings and Claude refines them.'; return; }
  el.innerHTML = `<b>Tuned ${fmtDT(t.at)}</b> from ${t.trades} trades by ${t.by}${state.settings.autoTune ? ' · re-tunes after each sync (max once an hour)' : ''}.<br>${esc(t.note)}${t.aiErr ? ` <span class="neg">(Claude unavailable: ${esc(t.aiErr)})</span>` : ''}`;
}

function maybeAutoTune() {
  if (!state.settings.autoTune) return;
  const last = state.settings.tuneInfo?.at || 0;
  if (Date.now() - last < 3600e3) return;
  tuneSizing({ silent: true }).catch(() => {});
}
// Balance in the trade unit: FOMO total in USD, or the Solana wallet's SOL.
function accountBalance() {
  if (isUsd()) return state.fomo ? state.fomo.balances.totalUsd.toFixed(2) : state.wallet ? state.wallet.totalUsd.toFixed(2) : null;
  return state.wallet ? state.wallet.sol.toFixed(4) : null;
}
$('#useWalletBal').onclick = () => { const b = accountBalance(); if (b != null) { $('#sizeForm').balance.value = b; renderSizing(); } };

// ---------- settings ----------
let refreshTimer = null;
function applySettings() {
  const f = $('#settingsForm');
  for (const k of Object.keys(state.settings)) if (f[k]) f[k].value = state.settings[k];
  const adv = $('details.adv');
  if (adv && !adv.open && ['heliusKey', 'rpc', 'lookupUrl', 'feedUrl'].some((k) => state.settings[k])) adv.open = true;
  clearInterval(refreshTimer);
  const sec = Number(state.settings.refreshSec);
  if (sec > 0) refreshTimer = setInterval(() => refreshBalance(), Math.max(10, sec) * 1000);
}
$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const wallet = f.wallet.value.trim();
  if (wallet && !isAddress(wallet)) { $('#settingsSaved').innerHTML = '<span class="neg">That is not a valid Solana address.</span>'; return; }
  const walletChanged = wallet !== state.settings.wallet;
  for (const k of Object.keys(state.settings)) if (f[k] && k !== 'wallet') state.settings[k] = f[k].value.trim();
  store.set('settings', state.settings);
  $('#settingsSaved').textContent = 'Saved.';
  setTimeout(() => ($('#settingsSaved').textContent = ''), 2000);
  if (walletChanged) setWallet(wallet, Object.keys(state.profiles).find((h) => state.profiles[h] === wallet) || '');
  else { applySettings(); refreshBalance(true); }
});

// ---------- FOMO usernames ----------
const isAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
const normHandle = (s) => String(s || '').trim().replace(/^@/, '').replace(/^https?:\/\/[^/]+\/(@|u\/|profile\/)?/i, '').replace(/[/?#].*$/, '').toLowerCase();

// Find a Solana address anywhere in a lookup API response, preferring keys that mention "sol".
function findSolAddress(obj) {
  const hits = [];
  (function walk(v, key, depth) {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') { if (isAddress(v)) hits.push({ v, score: /sol/i.test(key) ? 2 : /wallet|address/i.test(key) ? 1 : 0 }); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? key : k, depth + 1);
  })(obj, '', 0);
  hits.sort((a, b) => b.score - a.score);
  return hits[0]?.v || null;
}

const FOMOAPI = { url: 'https://api.fomoapi.io/v2/users/{handle}', header: 'Authorization' };

// fomoapi.io keys (fapi_...) work with no other settings.
function lookupConfig() {
  const { lookupUrl, lookupHeader, lookupKey } = state.settings;
  if (lookupUrl) return { url: lookupUrl, header: lookupHeader || 'x-api-key', key: lookupKey };
  if (/^fapi_/.test(lookupKey || '')) return { url: FOMOAPI.url, header: FOMOAPI.header, key: lookupKey };
  return null;
}

async function lookupHandle(handle) {
  const cfg = lookupConfig();
  if (!cfg) return null;
  const url = cfg.url.includes('{handle}') ? cfg.url.replace('{handle}', encodeURIComponent(handle)) : cfg.url.replace(/\/?$/, '/') + encodeURIComponent(handle);
  const value = /^authorization$/i.test(cfg.header) && !/^(bearer|basic) /i.test(cfg.key) ? 'Bearer ' + cfg.key : cfg.key;
  const isFomoApi = url.startsWith(FOMO_BASE);
  if (isFomoApi && fomoPaused()) throw fomoPaused();
  let r;
  try {
    r = await fetch(url, { headers: cfg.key ? { [cfg.header]: value } : {} });
  } catch (e) {
    throw new Error('lookup request was blocked (network or CORS). The provider may not allow calls from a browser.');
  }
  if (isFomoApi) fomoAnswered(r);
  if (r.status === 402 && isFomoApi) throw new Error(FomoBudget.creditsMessage(fomoPause, Date.now()));
  if (r.status === 401 || r.status === 403) throw new Error(`lookup API rejected the key (HTTP ${r.status}).`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`lookup HTTP ${r.status}`);
  return findSolAddress(await r.json());
}

function saveProfile(handle, wallet) {
  state.profiles[handle] = wallet;
  store.set('profiles', state.profiles);
  renderProfiles();
}

function renderProfiles() {
  const handles = Object.keys(state.profiles).sort();
  $('#userList').innerHTML = handles.map((h) => `<option value="${esc(h)}"></option>`).join('');
  $('#profileList').innerHTML = handles.length
    ? handles.map((h) => `<div class="recent-item"><span><a href="#" data-user="${esc(h)}">@${esc(h)}</a> <span class="muted small">${esc(short(state.profiles[h]))}</span></span><button class="icon-btn" data-unlink="${esc(h)}" title="Remove">✕</button></div>`).join('')
    : '<p class="muted small">No usernames linked yet. Type one in the box at the top.</p>';
  const u = state.settings.username;
  $('#userInput').value = u || '';
  $('#activeUser').innerHTML = state.settings.wallet
    ? `${u ? '@' + esc(u) + ' · ' : ''}<span class="muted small" title="${esc(state.settings.wallet)}">${esc(short(state.settings.wallet))}</span>`
    : '';
}

function resetWalletTiles() {
  for (const id of ['solBal', 'portUsd', 'solPrice', 'balChange']) $('#' + id).textContent = '–';
  for (const id of ['solUsd', 'portSub', 'balChangeSub', 'lastUpdated', 'solPriceSub']) $('#' + id).textContent = '';
  $('#holdings').textContent = '–';
  hideEmptyTiles();
  $('#sizeForm').balance.value = '';
}

function setWallet(wallet, handle) {
  state.settings.wallet = wallet;
  state.settings.username = handle || '';
  store.set('settings', state.settings);
  loadWalletData();
  resetWalletTiles();
  applySettings();
  renderProfiles();
  try {
    const url = new URL(location.href);
    if (handle) url.searchParams.set('user', handle); else url.searchParams.delete('user');
    history.replaceState(null, '', url);
  } catch { /* file:// in some browsers */ }
  $('#linkCard').classList.add('hidden');
  showTab('dashboard');
  refreshBalance(true);
  if ((fomoMode() || (wallet && state.settings.heliusKey)) && !state.trades.length) syncTrades().then(() => showTab('dashboard'));
}

async function openUser(raw) {
  const input = String(raw || '').trim();
  if (!input) return;
  if (isAddress(input)) return setWallet(input, Object.keys(state.profiles).find((h) => state.profiles[h] === input) || '');
  const handle = normHandle(input);
  if (!handle) return;
  let wallet = state.profiles[handle];
  let lookupMsg = '';
  if (!wallet && lookupConfig()) {
    $('#userStatus').textContent = 'Looking up @' + handle + '…';
    try {
      wallet = await lookupHandle(handle);
      if (wallet) saveProfile(handle, wallet);
      else lookupMsg = 'Automatic lookup could not find @' + handle + '.';
    } catch (e) { console.warn(e); lookupMsg = 'Automatic lookup failed: ' + e.message; }
    $('#userStatus').textContent = '';
  }
  if (wallet) return setWallet(wallet, handle);
  $('#linkName').textContent = handle;
  $('#linkErr').textContent = lookupMsg;
  $('#linkForm').addr.value = '';
  $('#linkCard').classList.remove('hidden');
  $('#linkForm').addr.focus();
}

$('#userForm').addEventListener('submit', (e) => { e.preventDefault(); openUser($('#userInput').value); });
$('#linkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const addr = e.target.addr.value.trim();
  if (!isAddress(addr)) { $('#linkErr').textContent = 'That is not a valid Solana address.'; return; }
  const handle = $('#linkName').textContent;
  saveProfile(handle, addr);
  setWallet(addr, handle);
});
$('#fomoapiPreset').onclick = () => {
  const f = $('#settingsForm');
  f.lookupUrl.value = FOMOAPI.url;
  f.lookupHeader.value = FOMOAPI.header;
  f.lookupKey.focus();
};
$('#linkCancel').onclick = () => $('#linkCard').classList.add('hidden');
document.addEventListener('click', (e) => {
  const u = e.target.closest('[data-user]');
  const x = e.target.closest('[data-unlink]');
  if (u) { e.preventDefault(); openUser(u.dataset.user); }
  if (x && confirm(`Remove @${x.dataset.unlink}? Its trade data stays saved under the wallet.`)) {
    delete state.profiles[x.dataset.unlink];
    store.set('profiles', state.profiles);
    renderProfiles();
  }
});

$('#backupBtn').onclick = () => {
  const { heliusKey, lookupKey, anthropicKey, feedKey, ...safeSettings } = state.settings;
  download('fomo-tracker-backup.json', JSON.stringify({ settings: safeSettings, profiles: state.profiles, trades: state.trades, swaps: state.swaps, hidden: state.hidden, history: state.history, symbols: state.symbols }, null, 2), 'application/json');
};
$('#restoreFile').onchange = async (e) => {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (d.settings) { Object.assign(state.settings, d.settings); store.set('settings', state.settings); applySettings(); }
    if (d.profiles) { Object.assign(state.profiles, d.profiles); store.set('profiles', state.profiles); }
    if (d.symbols) { Object.assign(state.symbols, d.symbols); store.set('symbols', state.symbols); }
    for (const k of Object.keys(WALLET_DEFAULTS)) if (d[k]) { state[k] = d[k]; wstore.set(k, d[k]); }
    renderProfiles();
    renderAll();
    alert('Backup restored.');
  } catch (err) { alert('Invalid backup file: ' + err.message); }
  e.target.value = '';
};
$('#clearHistBtn').onclick = () => { if (confirm('Clear balance history?')) { state.history = []; wstore.set('history', []); renderWallet(); } };
$('#clearTradesBtn').onclick = () => {
  if (!confirm('Delete ALL trades and synced swap data?')) return;
  Object.assign(state, { trades: [], swaps: {}, hidden: [], open: [] });
  ['trades', 'swaps', 'hidden', 'open'].forEach((k) => wstore.set(k, state[k]));
  renderAll();
};

// ---------- tabs ----------
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === name));
  try { localStorage.setItem('ft_tab', name); } catch { /* ignore */ }
  renderAll();
  if (name === 'settings') renderFomoUsage();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
document.addEventListener('click', (e) => { const a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); showTab(a.dataset.goto); } });
$('#dashWindow').onchange = renderDashboard;
$('#anaWindow').onchange = renderAnalytics;
$('#refreshBtn').onclick = () => refreshBalance(true);

function renderUnits() {
  $$('.unit').forEach((el) => (el.textContent = isUsd() ? 'USD' : 'SOL'));
  $('#useWalletBal').textContent = isUsd() ? 'Use FOMO balance' : 'Use wallet SOL balance';
}

function renderAll() {
  renderUnits();
  const active = $('.tab.active')?.id;
  if (active === 'dashboard') { renderDashboard(); renderWallet(); }
  if (active === 'trades') renderTrades();
  if (active === 'check' && typeof renderCheck === 'function') renderCheck();
  if (active === 'analytics') renderAnalytics();
  if (active === 'sizing') renderSizing();
}

// ---------- update check ----------
// version.json is fetched fresh; when the published version is newer, offer a one-tap reload past the phone's cache.
const APP_VERSION = 41;
$('#appVersion').textContent = 'version ' + APP_VERSION;
async function checkForUpdate() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = await r.json();
    if (!(Number(version) > APP_VERSION)) return;
    const bar = $('#updateBar');
    bar.hidden = false;
    $('#updateBtn').onclick = async () => {
      const btn = $('#updateBtn');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      // Make sure the new build is actually being served before reloading into it.
      let ok = false;
      try {
        const r = await fetch('app.js?v=' + version + '&t=' + Date.now(), { cache: 'no-store' });
        ok = r.ok && /APP_VERSION = (\d+)/.test(await r.text());
      } catch { ok = false; }
      if (!ok) {
        btn.disabled = false;
        btn.textContent = 'Try again';
        bar.querySelector('span')?.remove();
        bar.insertAdjacentHTML('afterbegin', '<span>The new version is not reachable yet (it may still be publishing or you are offline). </span>');
        return;
      }
      const url = new URL(location.href);
      url.searchParams.set('v', version);
      location.replace(url.toString());
    };
  } catch { /* offline or file:// */ }
}
checkForUpdate();
setInterval(checkForUpdate, 30 * 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

// ---------- boot ----------
applySettings();
renderFomoUsage();
applyRiskForm();
applySizingForm();
renderProfiles();
const urlUser = new URLSearchParams(location.search).get('user');
let startTab = 'dashboard';
try { startTab = localStorage.getItem('ft_tab') || 'dashboard'; } catch { /* ignore */ }
showTab(startTab);
if (state.history.length) {
  const last = state.history[state.history.length - 1];
  $('#solBal').textContent = sol(last.sol, 4);
  $('#portUsd').textContent = usd(last.usd);
}
if (urlUser && normHandle(urlUser) !== state.settings.username) openUser(urlUser);
else refreshBalance();
