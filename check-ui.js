/* global Check, state, store, $, $$, esc, fmt, usd, pct, cls, fmtT, fmtDT, THEME, isUsd, accountBalance, renderSizing */
'use strict';

// ---------- token check: data sources ----------
const DEX_API = 'https://api.dexscreener.com/latest/dex/tokens/';
const RUGCHECK_API = 'https://api.rugcheck.xyz/v1/tokens/';
const GOPLUS_API = 'https://api.gopluslabs.io/api/v1/';
const TRENCH_API = 'https://trench.bot/api/bundle/bundle_advanced/';
const GOPLUS_CHAIN = { ethereum: '1', bsc: '56', base: '8453', arbitrum: '42161', polygon: '137', avalanche: '43114', optimism: '10', monad: '143' };
const WATCH_MS = 20000;

const checkState = { position: null, cache: {}, ca: null, chain: null, dex: null, facts: null, risk: null, plan: null, taken: [], sources: {}, watch: null, sessionHigh: 0, liq0: 0, signal: null, ai: null, celebrate: null };

const checks = () => store.get('checks', {});
function saveCheck() {
  if (!checkState.ca) return;
  const all = checks();
  all[checkState.ca] = { chain: checkState.chain, symbol: checkState.dex?.symbol, plan: checkState.plan, taken: checkState.taken, at: Date.now() };
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 20);
  store.set('checks', Object.fromEntries(keys.map((k) => [k, all[k]])));
}
const discipline = () => Object.assign({ planned: 0, taken: 0, missed: 0, locked: 0 }, store.get('discipline', {}));

async function getJson(url, opts = {}) {
  let r;
  try { r = await fetch(url, Object.assign({ cache: 'no-store' }, opts)); }
  catch { throw new Error('blocked'); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// DexScreener: pick the deepest pool for the token.
async function fetchDex(ca) {
  const j = await getJson(DEX_API + encodeURIComponent(ca));
  const pairs = (j && j.pairs) || [];
  if (!pairs.length) throw new Error('no pool found on DexScreener');
  const p = pairs.slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  const num = (v) => (v == null || v === '' ? null : Number(v));
  return {
    chainId: p.chainId, dexId: p.dexId, pairAddress: p.pairAddress, url: p.url,
    symbol: p.baseToken?.symbol || '?', name: p.baseToken?.name || '',
    priceUsd: num(p.priceUsd), mcap: num(p.marketCap ?? p.fdv), fdv: num(p.fdv),
    liq: num(p.liquidity?.usd), vol24h: num(p.volume?.h24), vol1h: num(p.volume?.h1), vol5m: num(p.volume?.m5),
    change5m: num(p.priceChange?.m5) || 0, change1h: num(p.priceChange?.h1) || 0, change6h: num(p.priceChange?.h6) || 0, change24h: num(p.priceChange?.h24) || 0,
    buys5m: p.txns?.m5?.buys || 0, sells5m: p.txns?.m5?.sells || 0, buys1h: p.txns?.h1?.buys || 0, sells1h: p.txns?.h1?.sells || 0, buys24h: p.txns?.h24?.buys || 0, sells24h: p.txns?.h24?.sells || 0,
    createdAt: p.pairCreatedAt ? new Date(p.pairCreatedAt) : null,
    socials: (p.info?.socials || []).map((s) => s.url).concat((p.info?.websites || []).map((w) => w.url)).filter(Boolean),
    pools: pairs.length,
  };
}

// Solana program ids and pool authorities whose token accounts are liquidity, not holders.
const POOL_OWNERS = new Set([
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium AMM v4 + authority
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', // Raydium CPMM + authority
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // pump.fun bonding curve + PumpSwap AMM
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora DLMM + pools
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca Whirlpool + v2
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY', 'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb',
]);
const BURN_ADDRESSES = new Set(['1nc1nerator11111111111111111111111111111111', '11111111111111111111111111111111']);
const POOL_WORDS = /amm|pool|lp\b|vault|liquidity|dex|raydium|orca|meteora|pump|bonding|jupiter|phoenix|openbook|whirlpool|dlmm|cpmm|clmm|market/i;

// Collect every address-looking string inside RugCheck's markets (pool accounts, vaults, LP mints).
function marketAddresses(markets) {
  const out = new Set();
  const walk = (v, depth) => {
    if (depth > 3 || v == null) return;
    if (typeof v === 'string') { if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) out.add(v); return; }
    if (typeof v === 'object') Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(markets, 0);
  return out;
}

// RugCheck (Solana): authorities, insider bundles, LP lock, top holders.
async function fetchRugcheck(mint) {
  const r = await getJson(RUGCHECK_API + encodeURIComponent(mint) + '/report');
  const f = {};
  const supply = Number(r.token?.supply) || 0;
  f.mintAuthority = r.token ? r.token.mintAuthority != null : undefined;
  f.freezeAuthority = r.token ? r.token.freezeAuthority != null : undefined;
  f.mutableMetadata = r.tokenMeta ? !!r.tokenMeta.mutable : undefined;
  if (typeof r.totalHolders === 'number') f.holders = r.totalHolders;
  const known = r.knownAccounts || {};
  const markets = r.markets || [];
  const mktAddrs = marketAddresses(markets);
  const label = (h) => known[h.address] || known[h.owner] || null;
  const isPool = (h) => {
    const k = label(h);
    if (k && POOL_WORDS.test(`${k.type || ''} ${k.name || ''}`)) return true;
    if (POOL_OWNERS.has(h.owner) || POOL_OWNERS.has(h.address)) return true;
    return mktAddrs.has(h.address) || mktAddrs.has(h.owner);
  };
  const isBurn = (h) => BURN_ADDRESSES.has(h.owner) || BURN_ADDRESSES.has(h.address);
  const all = (r.topHolders || []).map((h) => {
    const pct = Number(h.pct) || 0;
    const tags = [];
    if (isPool(h)) tags.push('Pool');
    if (isBurn(h)) tags.push('Burned');
    if (h.insider) tags.push('Insider');
    if (r.creator && (h.owner === r.creator || h.address === r.creator)) tags.push('Creator');
    const k = label(h);
    return { addr: h.owner || h.address, pct, tags, name: k && !tags.includes('Pool') ? k.name || '' : (k && k.name) || '' };
  });
  f._holders = all.slice(0, 15);
  const real = all.filter((h) => !h.tags.includes('Pool') && !h.tags.includes('Burned'));
  f.poolPct = all.filter((h) => h.tags.includes('Pool')).reduce((s, h) => s + h.pct, 0);
  if (real.length) {
    f.topHolderPct = Math.max(...real.map((h) => h.pct));
    f.top10Pct = real.slice(0, 10).reduce((s, h) => s + h.pct, 0);
  }
  const nets = r.insiderNetworks || [];
  if (nets.length && supply > 0) {
    f.insiderPct = 100 * nets.reduce((s, n) => s + (Number(n.tokenAmount) || 0), 0) / supply;
    f.insiderWallets = nets.reduce((s, n) => s + (Number(n.size) || Number(n.activeAccounts) || 0), 0);
  } else if (r.topHolders) {
    f.insiderPct = (r.topHolders || []).filter((h) => h.insider).reduce((s, h) => s + (Number(h.pct) || 0), 0);
  }
  const lps = markets.map((m) => m.lp?.lpLockedPct).filter((v) => typeof v === 'number');
  if (lps.length) f.lpLockedPct = Math.min(...lps);
  if (r.creator) {
    const c = (r.topHolders || []).find((h) => h.owner === r.creator || h.address === r.creator);
    if (c) f.creatorPct = Number(c.pct) || 0;
  }
  f._risks = (r.risks || []).map((x) => ({ name: x.name, level: x.level, description: x.description }));
  return f;
}

// TrenchBot (Solana, pump.fun-style launches): bundled at launch vs still held.
async function fetchTrenchbot(mint) {
  const r = await getJson(TRENCH_API + encodeURIComponent(mint));
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const f = {};
  if (num(r.total_holding_percentage) != null) f.bundleHeldPct = r.total_holding_percentage;
  if (num(r.total_percentage_bundled) != null) f.bundleLaunchPct = r.total_percentage_bundled;
  if (num(r.total_bundles) != null) f.bundleCount = r.total_bundles;
  if (r.creator_analysis && num(r.creator_analysis.holding_percentage) != null) f.creatorPct = r.creator_analysis.holding_percentage;
  if (typeof r.bonded === 'boolean') f.bonded = r.bonded;
  if (f.bundleHeldPct == null && f.bundleLaunchPct == null) throw new Error('no bundle data');
  return f;
}

// GoPlus (EVM chains): honeypot, taxes, owner powers, holders, LP holders.
async function fetchGoplus(chainId, ca) {
  const gp = GOPLUS_CHAIN[chainId];
  if (!gp) throw new Error('chain not supported');
  const j = await getJson(`${GOPLUS_API}token_security/${gp}?contract_addresses=${encodeURIComponent(ca)}`);
  const d = j?.result?.[ca.toLowerCase()];
  if (!d) throw new Error('no data');
  const flag = (v) => (v === '1' ? true : v === '0' ? false : undefined);
  const f = {};
  f.honeypot = flag(d.is_honeypot);
  if (d.buy_tax !== '' && d.buy_tax != null) f.buyTax = Number(d.buy_tax) * 100;
  if (d.sell_tax !== '' && d.sell_tax != null) f.sellTax = Number(d.sell_tax) * 100;
  f.mintAuthority = flag(d.is_mintable);
  f.ownerCanModify = [d.is_proxy, d.hidden_owner, d.can_take_back_ownership, d.owner_change_balance, d.slippage_modifiable, d.transfer_pausable, d.is_blacklisted].some((v) => v === '1') ? true : [d.is_proxy, d.hidden_owner].every((v) => v === '0') ? false : undefined;
  f.openSource = flag(d.is_open_source);
  if (d.holder_count) f.holders = Number(d.holder_count);
  const allH = (d.holders || []).map((h) => {
    const tags = [];
    const burn = /^0x0+dead$|^0x0+$/i.test(h.address || '') || /burn|dead|null/i.test(h.tag || '');
    if (burn) tags.push('Burned');
    else if (/pair|pool|lp|uniswap|aerodrome|pancake|sushi/i.test(h.tag || '')) tags.push('Pool');
    else if (h.is_contract === 1) tags.push('Contract');
    if (h.is_locked === 1) tags.push('Locked');
    if (d.creator_address && h.address?.toLowerCase() === d.creator_address.toLowerCase()) tags.push('Creator');
    return { addr: h.address, pct: Number(h.percent) * 100 || 0, tags, name: h.tag || '' };
  });
  f._holders = allH.slice(0, 15);
  const hs = allH.filter((h) => !h.tags.some((t) => ['Pool', 'Burned', 'Contract'].includes(t)));
  f.poolPct = allH.filter((h) => h.tags.includes('Pool')).reduce((s, h) => s + h.pct, 0);
  if (hs.length) {
    f.topHolderPct = Math.max(...hs.map((h) => h.pct));
    f.top10Pct = hs.slice(0, 10).reduce((s, h) => s + h.pct, 0);
  }
  const lps = d.lp_holders || [];
  if (lps.length) {
    const locked = lps.filter((h) => h.is_locked === 1 || /lock|burn|dead|null/i.test(h.tag || '') || /^0x0+dead$|^0x0+$/i.test(h.address || '')).reduce((s, h) => s + Number(h.percent) * 100, 0);
    f.lpLockedPct = Math.min(100, locked);
  }
  if (d.creator_percent !== '' && d.creator_percent != null) f.creatorPct = Number(d.creator_percent) * 100;
  return f;
}

// GoPlus Solana endpoint: fallback when RugCheck is unreachable.
async function fetchGoplusSolana(mint) {
  const j = await getJson(`${GOPLUS_API}solana/token_security?contract_addresses=${encodeURIComponent(mint)}`);
  const d = j?.result?.[mint];
  if (!d) throw new Error('no data');
  const f = {};
  if (d.mintable) f.mintAuthority = d.mintable.status === '1';
  if (d.freezable) f.freezeAuthority = d.freezable.status === '1';
  if (d.metadata_mutable) f.mutableMetadata = d.metadata_mutable.status === '1';
  if (d.holder_count) f.holders = Number(d.holder_count);
  const allH = (d.holders || []).map((h) => {
    const tags = [];
    if (POOL_OWNERS.has(h.address) || /pool|amm|raydium|pump/i.test(h.tag || '')) tags.push('Pool');
    if (BURN_ADDRESSES.has(h.address)) tags.push('Burned');
    return { addr: h.address, pct: Number(h.percent) * 100 || 0, tags, name: h.tag || '' };
  });
  f._holders = allH.slice(0, 15);
  const hs = allH.filter((h) => !h.tags.length);
  f.poolPct = allH.filter((h) => h.tags.includes('Pool')).reduce((s, h) => s + h.pct, 0);
  if (hs.length) {
    f.topHolderPct = Math.max(...hs.map((h) => h.pct));
    f.top10Pct = hs.slice(0, 10).reduce((s, h) => s + h.pct, 0);
  }
  const lps = d.lp_holders || [];
  if (lps.length) f.lpLockedPct = Math.min(100, lps.filter((h) => h.is_locked === 1).reduce((s, h) => s + Number(h.percent) * 100, 0));
  if (d.creators && d.creators.length) f.creatorPct = d.creators.reduce((s, c) => s + (Number(c.malicious_address) ? 0 : 0), 0) || undefined;
  return f;
}

// ---------- run a check ----------
// DexScreener pool + contract/holder checks + bundles for one CA. Throws if DexScreener fails.
// Shared by the Check tab and background holder snapshots (Holder lessons).
async function gatherFacts(ca, onPool) {
  const sources = {};
  const dex = await fetchDex(ca);
  sources.dex = 'ok';
  if (onPool) onPool();
  let sec = {};
  if (dex.chainId === 'solana') {
    const [rc, tb] = await Promise.all([
      fetchRugcheck(ca).then((f) => ({ f })).catch((e) => ({ e })),
      fetchTrenchbot(ca).then((f) => ({ f })).catch((e) => ({ e })),
    ]);
    if (rc.f) { sec = rc.f; sources.security = 'RugCheck'; }
    else {
      try { sec = await fetchGoplusSolana(ca); sources.security = 'GoPlus'; sources.securityNote = 'RugCheck ' + rc.e.message; }
      catch (e2) { sources.security = null; sources.securityNote = `RugCheck ${rc.e.message}, GoPlus ${e2.message}`; }
    }
    if (tb.f) {
      sources.bundles = 'TrenchBot';
      // "Still held" is what sits over your head; take the larger of the two sources' estimates.
      sec.insiderPct = Math.max(sec.insiderPct ?? 0, tb.f.bundleHeldPct ?? 0);
      if (tb.f.bundleLaunchPct != null) sec.bundleLaunchPct = tb.f.bundleLaunchPct;
      if (tb.f.bundleCount != null && !sec.insiderWallets) sec.bundleCount = tb.f.bundleCount;
      if (sec.creatorPct == null && tb.f.creatorPct != null) sec.creatorPct = tb.f.creatorPct;
      if (tb.f.bonded != null) sec.bonded = tb.f.bonded;
    } else sources.bundleNote = 'TrenchBot ' + tb.e.message;
  } else {
    try { sec = await fetchGoplus(dex.chainId, ca); sources.security = 'GoPlus'; }
    catch (e) { sources.security = null; sources.securityNote = 'GoPlus ' + e.message; }
  }
  const facts = Object.assign({
    liquidityUsd: dex.liq, mcapUsd: dex.mcap,
    ageHours: dex.createdAt ? (Date.now() - dex.createdAt) / 3600e3 : undefined,
    buys1h: dex.buys1h, sells1h: dex.sells1h,
  }, sec);
  return { dex, facts, sources, risk: Check.assessRisk(facts) };
}

async function runCheck(raw, position = null) {
  const ca = Check.extractAddress(raw);
  const status = $('#checkStatus');
  if (!ca) { status.innerHTML = '<span class="neg">Paste a contract address (a 0x… address or a Solana mint).</span>'; return; }
  stopWatch();
  Object.assign(checkState, { ca, chain: Check.detectChain(ca), dex: null, facts: null, risk: null, plan: null, taken: [], sources: {}, sessionHigh: 0, liq0: 0, signal: null, ai: null, celebrate: null, position, holderDeep: null, holderDeepHtml: '', feeSample: null });
  $('#caInput').value = ca;
  const saved = checks()[ca];
  if (saved) { checkState.plan = saved.plan || null; checkState.taken = saved.taken || []; }
  $('#checkResult').hidden = true;
  status.textContent = 'Checking the pool…';
  let got;
  try {
    got = await gatherFacts(ca, () => { status.textContent = 'Checking the contract and holders…'; });
  } catch (e) {
    checkState.sources.dex = e.message;
    status.innerHTML = `<span class="neg">DexScreener: ${esc(e.message)}. ${e.message === 'blocked' ? 'The request was blocked (network or CORS).' : 'Is this a traded token?'}</span>`;
    return;
  }
  checkState.dex = got.dex;
  Object.assign(checkState.sources, got.sources);
  checkState.facts = got.facts;
  checkState.risk = Check.assessRisk(checkState.facts);
  checkState.cache[ca] = { dex: got.dex, risk: checkState.risk, at: Date.now() };
  if (typeof saveHolderSnapshot === 'function') saveHolderSnapshot(ca, checkState.facts, checkState.risk);
  status.textContent = '';
  $('#checkResult').hidden = false;
  saveCheck();
  renderCheck();
}

// ---------- rendering ----------
const EXPLORER = { solana: 'https://solscan.io/account/', ethereum: 'https://etherscan.io/address/', base: 'https://basescan.org/address/', bsc: 'https://bscscan.com/address/', arbitrum: 'https://arbiscan.io/address/', monad: 'https://monadexplorer.com/address/' };
function holdersTable(facts, chainId) {
  const hs = facts._holders || [];
  if (!hs.length) return '';
  const ex = EXPLORER[chainId];
  const short = (a) => (a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '?');
  const tagCls = { Pool: 'pool', Burned: 'pool', Contract: 'pool', Insider: 'bad', Creator: 'bad', Locked: 'good' };
  const real = hs.filter((h) => !h.tags.some((t) => ['Pool', 'Burned', 'Contract'].includes(t)));
  const summary = [facts.poolPct > 0 ? `Pools hold ${facts.poolPct.toFixed(1)}%` : '', facts.top10Pct != null ? `top 10 real wallets hold ${facts.top10Pct.toFixed(1)}%` : '', facts.holders != null ? facts.holders.toLocaleString() + ' holders' : ''].filter(Boolean).join(' · ');
  return `<details class="adv holders" open><summary>Top holders (${real.length} wallets shown, pools excluded from the whale check)</summary>
    <p class="muted small">${esc(summary)}</p>
    <div class="table-wrap"><table class="holders-table"><thead><tr><th>#</th><th>Wallet</th><th class="num">Supply</th><th>Share</th></tr></thead><tbody>
    ${hs.map((h, i) => `<tr class="${h.tags.includes('Pool') || h.tags.includes('Burned') ? 'muted' : ''}"><td>${i + 1}</td><td>${ex ? `<a href="${esc(ex + h.addr)}" target="_blank" rel="noopener">${esc(short(h.addr))}</a>` : esc(short(h.addr))}${h.tags.map((t) => `<span class="tag ${tagCls[t] || ''}">${t}</span>`).join('')}${h.name && !h.tags.includes('Pool') ? ` <span class="muted small">${esc(h.name)}</span>` : ''}</td><td class="num">${h.pct.toFixed(2)}%</td><td><div class="share"><i style="width:${Math.min(100, h.pct * 2).toFixed(0)}%"></i></div></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row gap wrap" style="margin-top:10px"><button type="button" class="btn mini" id="deepBtn">Analyze top wallets</button><span class="muted small">Balance, 24h / 7d swap flow, fees and wallet age for the largest real holders${chainId === 'solana' ? ' (via Helius)' : ' (Solana only)'}.</span></div>
    <div id="holderDeep">${checkState.holderDeepHtml || ''}</div></details>`;
}

// ---------- deep holder analysis (Solana, Helius) ----------
async function analyzeWallet(h, ca, nowSec) {
  const { heliusKey } = state.settings;
  const [balance, txs] = await Promise.all([
    rpc('getBalance', [h.addr]).then((r) => r.value / 1e9).catch(() => null),
    fetch(`https://api.helius.xyz/v0/addresses/${encodeURIComponent(h.addr)}/transactions?api-key=${encodeURIComponent(heliusKey)}&limit=100`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Helius HTTP ' + r.status)))),
  ]);
  const list = Array.isArray(txs) ? txs.filter((t) => t && t.timestamp) : [];
  const within = (sec) => list.filter((t) => nowSec - t.timestamp <= sec);
  const sum = (arr, fn) => arr.reduce((s, t) => s + fn(t), 0);
  const myDelta = (t) => (((t.accountData || []).find((a) => a.account === h.addr) || {}).nativeBalanceChange || 0) / 1e9;
  const isSwap = (t) => t.type === 'SWAP' || /swap/i.test(t.description || '');
  const touchesCa = (t) => (t.tokenTransfers || []).some((x) => x.mint === ca);
  const d1 = within(86400), d7 = within(7 * 86400);
  const full = list.length < 100;
  return {
    addr: h.addr, pct: h.pct, tags: h.tags, balance, txCount: list.length, fullHistory: full, fresh: full && list.length <= 30,
    swaps1d: d1.filter(isSwap).length, swaps7d: d7.filter(isSwap).length,
    flow1d: sum(d1.filter(isSwap), myDelta), flow7d: sum(d7.filter(isSwap), myDelta),
    fees7d: sum(d7, (t) => (t.fee || 0) / 1e9), feesOnCa: sum(list.filter(touchesCa), (t) => (t.fee || 0) / 1e9), caTxs: list.filter(touchesCa).length,
    firstSeen: list.length ? Math.min(...list.map((t) => t.timestamp)) : null, lastActive: list.length ? Math.max(...list.map((t) => t.timestamp)) : null,
  };
}

async function analyzeHolders() {
  const out = $('#holderDeep');
  if (!out) return;
  if (checkState.dex.chainId !== 'solana') { out.innerHTML = '<p class="muted small">Wallet analysis works for Solana tokens only.</p>'; return; }
  if (!state.settings.heliusKey) { out.innerHTML = '<p class="muted small">Add a Helius API key (Settings → Advanced) to read wallet histories.</p>'; return; }
  const wallets = (checkState.facts._holders || []).filter((h) => !h.tags.some((t) => ['Pool', 'Burned', 'Contract'].includes(t))).slice(0, 8);
  if (!wallets.length) { out.innerHTML = '<p class="muted small">No real wallets to analyze.</p>'; return; }
  const results = [];
  const nowSec = Date.now() / 1000;
  for (const h of wallets) {
    out.innerHTML = renderHolderDeep(results, wallets.length) + `<p class="muted small">Reading wallet ${results.length + 1} of ${wallets.length}…</p>`;
    try { results.push(await analyzeWallet(h, checkState.ca, nowSec)); }
    catch (e) { results.push({ addr: h.addr, pct: h.pct, tags: h.tags, error: e.message }); }
  }
  checkState.holderDeep = results;
  const good = results.filter((r) => !r.error);
  checkState.facts.analyzedHolders = good.length;
  checkState.facts.freshTopHolders = good.filter((r) => r.fresh).length;
  checkState.facts.topHoldersFeesOnCa = good.reduce((s, r) => s + r.feesOnCa, 0);
  checkState.risk = Check.assessRisk(checkState.facts);
  if (typeof saveHolderSnapshot === 'function') saveHolderSnapshot(checkState.ca, checkState.facts, checkState.risk);
  checkState.holderDeepHtml = renderHolderDeep(results, wallets.length);
  renderCheck();
}

function renderHolderDeep(results, total) {
  if (!results.length) return '';
  const good = results.filter((r) => !r.error);
  const solv = (n, d = 2) => (n == null ? '–' : (n > 0 ? '+' : '') + n.toFixed(d) + ' SOL');
  const flowCls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
  const fresh = good.filter((r) => r.fresh).length;
  const summary = good.length ? `${fresh} of ${good.length} fresh wallet${fresh === 1 ? '' : 's'} (≤30 transactions in total) · 7d swap flow across them <span class="${flowCls(good.reduce((s, r) => s + r.flow7d, 0))}">${solv(good.reduce((s, r) => s + r.flow7d, 0))}</span> · fees paid on this token ${good.reduce((s, r) => s + r.feesOnCa, 0).toFixed(3)} SOL` : '';
  return `<p class="small">${summary}</p><div class="table-wrap"><table class="deep-table"><thead><tr><th>Wallet</th><th>History</th><th class="num">Supply</th><th class="num">Balance</th><th class="num">24h</th><th class="num">7d</th><th class="num">Fees 7d</th><th class="num">Fees on CA</th></tr></thead><tbody>
    ${results.map((r) => r.error ? `<tr><td>${esc(r.addr.slice(0, 4) + '…' + r.addr.slice(-4))}</td><td colspan="7" class="muted">${esc(r.error)}</td></tr>`
      : `<tr><td><a href="https://solscan.io/account/${esc(r.addr)}" target="_blank" rel="noopener">${esc(r.addr.slice(0, 4) + '…' + r.addr.slice(-4))}</a>${r.tags.filter((t) => t !== 'Pool').map((t) => `<span class="tag ${t === 'Insider' || t === 'Creator' ? 'bad' : ''}">${t}</span>`).join('')}</td>
        <td>${r.fresh ? '<span class="tag bad">Fresh</span> ' : ''}${r.fullHistory ? r.txCount + ' tx' : '100+ tx'}${r.lastActive ? `<div class="muted small">${ago(new Date(r.lastActive * 1000))} ago</div>` : ''}</td>
        <td class="num">${r.pct.toFixed(2)}%</td><td class="num">${r.balance == null ? '–' : r.balance.toFixed(2) + ' SOL'}</td>
        <td class="num"><span class="${flowCls(r.flow1d)}">${solv(r.flow1d)}</span><div class="muted small">${r.swaps1d} swaps</div></td>
        <td class="num"><span class="${flowCls(r.flow7d)}">${solv(r.flow7d)}</span><div class="muted small">${r.swaps7d} swaps</div></td>
        <td class="num">${r.fees7d.toFixed(3)}</td><td class="num">${r.feesOnCa.toFixed(3)}<div class="muted small">${r.caTxs} tx</div></td>
</tr>`).join('')}
  </tbody></table></div><p class="muted small">Swap flow is SOL received from sells minus SOL spent on buys over the window (a realized-flow proxy, not exact PnL). Fees include priority fees and tips; high fee spend on one token is a bot / sniper signal.</p>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('#deepBtn')) analyzeHolders(); });

// Entry market cap implied by the position's average entry price vs the current price.
function entryMcapOf(pos, dex) {
  if (!pos || !dex || !(pos.entryPrice > 0) || !(dex.priceUsd > 0) || !(dex.mcap > 0)) return null;
  return dex.mcap * pos.entryPrice / dex.priceUsd;
}
// ---------- fees paid on this coin ----------
const DEX_FEE = { pumpfun: 0.01, 'pump.fun': 0.01, pumpswap: 0.0025, raydium: 0.0025, orca: 0.003, meteora: 0.005, jupiter: 0.0025, uniswap: 0.003, aerodrome: 0.003, pancakeswap: 0.0025, sushiswap: 0.003, baseswap: 0.003 };
function feeRate(dexId) {
  const id = String(dexId || '').toLowerCase();
  const k = Object.keys(DEX_FEE).find((key) => id.includes(key.replace('.', '')) || id.includes(key));
  return { rate: k ? DEX_FEE[k] : 0.003, known: !!k };
}
function feesBlock() {
  const dex = checkState.dex;
  const { rate, known } = feeRate(dex.dexId);
  const f24 = (dex.vol24h || 0) * rate, f1 = (dex.vol1h || 0) * rate;
  const s = checkState.feeSample;
  const sol = (n, d = 4) => (n == null ? '–' : n.toFixed(d) + ' SOL');
  return `<div class="fees"><div class="row between wrap"><b>Fees paid on this coin</b>${dex.chainId === 'solana' ? `<button type="button" class="btn mini" id="feeBtn" ${s && s.loading ? 'disabled' : ''}>${s && !s.loading ? 'Re-sample' : s && s.loading ? 'Sampling…' : 'Sample network fees'}</button>` : ''}</div>
    <div class="fees-row"><span>Trading fees, est.</span><span><b>${Check.fmtMcap(f24)}</b> last 24h · ${Check.fmtMcap(f1)} last hour <span class="muted small">(${(rate * 100).toFixed(2)}% ${esc(dex.dexId)} fee${known ? '' : ', assumed'} on volume)</span></span></div>
    ${s && !s.loading && !s.error ? `<div class="fees-row"><span>Network fees &amp; tips</span><span><b>${sol(s.est24h, 2)}</b> est. last 24h · avg <b>${sol(s.avg)}</b> per tx, max ${sol(s.max)} · ${pct(s.tippedShare, 0)} of txs tip above 0.005 SOL${s.topPayers.length ? ` · top payer <a href="https://solscan.io/account/${esc(s.topPayers[0].addr)}" target="_blank" rel="noopener">${esc(s.topPayers[0].addr.slice(0, 4) + '…' + s.topPayers[0].addr.slice(-4))}</a> ${sol(s.topPayers[0].fee, 3)}` : ''} <span class="muted small">(sample of ${s.n} recent txs over ${s.spanMin} min)</span></span></div>` : ''}
    ${s && s.error ? `<div class="neg small">${esc(s.error)}</div>` : ''}
    ${!s && dex.chainId === 'solana' ? '<div class="muted small">Sampling reads the coin\'s latest transactions via Helius: average fee per trade, bot tips and the biggest fee payers.</div>' : ''}</div>`;
}
async function sampleFees() {
  const ca = checkState.ca;
  if (!state.settings.heliusKey) { checkState.feeSample = { error: 'Add a Helius API key (Settings → Advanced) to sample fees.' }; renderCheck(); return; }
  checkState.feeSample = { loading: true };
  renderCheck();
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${encodeURIComponent(ca)}/transactions?api-key=${encodeURIComponent(state.settings.heliusKey)}&limit=100`);
    if (!r.ok) throw new Error('Helius HTTP ' + r.status);
    const txs = (await r.json()).filter((t) => t && typeof t.fee === 'number');
    if (!txs.length) throw new Error('No transactions returned for this coin.');
    const fees = txs.map((t) => t.fee / 1e9);
    const avg = fees.reduce((a, b) => a + b, 0) / fees.length;
    const byPayer = {};
    for (const t of txs) if (t.feePayer) byPayer[t.feePayer] = (byPayer[t.feePayer] || 0) + t.fee / 1e9;
    const topPayers = Object.entries(byPayer).map(([addr, fee]) => ({ addr, fee })).sort((a, b) => b.fee - a.fee).slice(0, 3);
    const ts = txs.map((t) => t.timestamp).filter(Boolean);
    const txs24h = (checkState.dex.buys24h || 0) + (checkState.dex.sells24h || 0);
    checkState.feeSample = { n: txs.length, avg, max: Math.max(...fees), total: fees.reduce((a, b) => a + b, 0), tippedShare: fees.filter((f) => f > 0.005).length / fees.length, est24h: txs24h ? avg * txs24h : null, topPayers, spanMin: ts.length ? Math.max(1, Math.round((Math.max(...ts) - Math.min(...ts)) / 60)) : 0 };
    checkState.facts.avgFeeSol = avg;
    checkState.risk = Check.assessRisk(checkState.facts);
  } catch (e) { checkState.feeSample = { error: e.message }; }
  renderCheck();
}
document.addEventListener('click', (e) => { if (e.target.closest('#feeBtn')) sampleFees(); });

function positionLine() {
  const pos = checkState.position, dex = checkState.dex;
  if (!pos || !dex) return '';
  const entry = entryMcapOf(pos, dex);
  const move = entry ? dex.mcap / entry - 1 : null;
  const unit = (v) => (isUsd() ? usd(v) : fmt(v, 3) + ' ' + (state.unit || 'SOL'));
  return `<div class="you-in"><b>You're in this one.</b> ${unit(pos.cost)} in${entry ? ` at about ${Check.fmtMcap(entry)} market cap` : ''}${move != null ? `, now <span class="${cls(move)}">${move > 0 ? '+' : ''}${(move * 100).toFixed(0)}%</span> from entry` : ''}${pos.unrealized != null ? ` · unrealized <span class="${cls(pos.unrealized)}">${(pos.unrealized < 0 ? '-' : '+') + unit(Math.abs(pos.unrealized))}</span>` : ''}${pos.openedAt ? ` · since ${fmtDT(pos.openedAt)}` : ''}</div>`;
}

function deepLinks(chainId, ca) {
  const gm = { solana: 'sol', ethereum: 'eth', base: 'base', bsc: 'bsc', monad: 'monad' }[chainId];
  const bm = { solana: 'sol', ethereum: 'eth', base: 'base', bsc: 'bsc' }[chainId];
  const out = [];
  if (gm) out.push({ name: 'GMGN', url: `https://gmgn.ai/${gm}/token/${ca}` });
  if (bm) out.push({ name: 'Bubblemaps', url: `https://app.bubblemaps.io/${bm}/token/${ca}` });
  if (chainId === 'solana') { out.push({ name: 'RugCheck', url: `https://rugcheck.xyz/tokens/${ca}` }); out.push({ name: 'TrenchBot', url: `https://trench.bot/bundles/${ca}` }); }
  else out.push({ name: 'GoPlus', url: `https://gopluslabs.io/token-security/${GOPLUS_CHAIN[chainId] || ''}/${ca}` });
  return out;
}

const sevLabel = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const verdictClass = { 'Walk away': 'stop', 'High risk': 'stop', 'Caution': 'warn', 'Looks OK': 'ok' };
const chg = (v) => `<span class="${cls(v)}">${v > 0 ? '+' : ''}${(v ?? 0).toFixed(1)}%</span>`;
const ago = (d) => { if (!d) return '–'; const m = (Date.now() - d) / 60000; return m < 60 ? Math.round(m) + 'm' : m < 1440 ? (m / 60).toFixed(1) + 'h' : (m / 1440).toFixed(1) + 'd'; };

function renderCheck() {
  renderDiscipline();
  const { dex, risk, facts } = checkState;
  if (!dex || !risk) { $('#checkResult').hidden = true; return; }
  $('#checkResult').hidden = false;
  const chainName = Check.CHAIN_NAMES[dex.chainId] || dex.chainId;
  $('#tokenCard').innerHTML = `
    <div class="row between wrap">
      <div><span class="tok-sym">${esc(dex.symbol)}</span> <span class="muted">${esc(dex.name)}</span> <span class="tag">${esc(chainName)}</span> <span class="tag">${esc(dex.dexId)}</span></div>
      <a class="small" href="${esc(dex.url)}" target="_blank" rel="noopener">DexScreener ↗</a>
    </div>
    <div class="tiles mini">
      <div class="tile"><label>Market cap</label><div class="big">${Check.fmtMcap(dex.mcap)}</div></div>
      <div class="tile"><label>Liquidity</label><div class="big">${Check.fmtMcap(dex.liq)}</div><div class="muted small">${dex.mcap ? (100 * dex.liq / dex.mcap).toFixed(1) + '% of mcap' : ''}</div></div>
      <div class="tile"><label>Age</label><div class="big">${ago(dex.createdAt)}</div><div class="muted small">${facts.holders != null ? facts.holders.toLocaleString() + ' holders' : ''}</div></div>
      <div class="tile"><label>Volume 24h</label><div class="big">${Check.fmtMcap(dex.vol24h)}</div><div class="muted small">${dex.buys24h}B / ${dex.sells24h}S</div></div>
    </div>
    <div class="chg-row">5m ${chg(dex.change5m)} · 1h ${chg(dex.change1h)} · 6h ${chg(dex.change6h)} · 24h ${chg(dex.change24h)} · <span class="muted">last hour ${dex.buys1h} buys / ${dex.sells1h} sells</span></div>
    ${positionLine()}
    ${feesBlock()}
    <div class="muted small">CA <code>${esc(checkState.ca)}</code></div>
    <div class="muted small links-row">Look deeper: ${deepLinks(dex.chainId, checkState.ca).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ↗</a>`).join(' · ')}</div>
    ${typeof thesisButton === 'function' ? thesisButton() : ''}`;

  const src = checkState.sources;
  const bundleLine = facts.bundleLaunchPct != null || facts.bundleHeldPct != null ? ` Bundles (${esc(src.bundles || '')}): ${Math.round(facts.bundleLaunchPct ?? 0)}% bought in bundles at launch, ${Math.round(facts.insiderPct ?? 0)}% still held${facts.bundleCount ? ' across ' + facts.bundleCount + ' bundles' : ''}.` : '';
  const srcLine = `Checked with DexScreener${src.security ? ', ' + src.security : ''}${src.bundles ? ' and ' + src.bundles : ''}.${bundleLine}${src.securityNote ? ' <span class="neg">' + esc(src.securityNote) + '.</span>' : ''}${src.bundleNote ? ' <span class="muted">' + esc(src.bundleNote) + '.</span>' : ''}${risk.unknown.length ? ' <span class="muted">Not checked: ' + esc(risk.unknown.join(', ')) + '.</span>' : ''}`;
  $('#verdictCard').innerHTML = `
    <div class="verdict ${verdictClass[risk.verdict]}">
      <div class="verdict-score"><b>${risk.score}</b><span>/100</span></div>
      <div><div class="verdict-title">${esc(risk.verdict)}</div><div class="small">${risk.findings.length ? risk.findings.length + ' finding' + (risk.findings.length === 1 ? '' : 's') : 'No red flags in what was checked'}</div></div>
    </div>
    ${typeof historyBlock === 'function' ? historyBlock(facts, risk) : ''}
    ${risk.findings.length ? `<ul class="findings">${risk.findings.map((f) => `<li class="f-${f.sev}"><span class="sev">${sevLabel[f.sev]}</span><div><b>${esc(f.title)}</b><div class="muted small">${esc(f.detail)}</div></div></li>`).join('')}</ul>` : ''}
    ${holdersTable(facts, dex.chainId)}
    ${facts._risks && facts._risks.length ? `<details class="adv"><summary>RugCheck's own flags (${facts._risks.length})</summary><ul class="muted small">${facts._risks.map((r) => `<li><b>${esc(r.name)}</b> (${esc(r.level)}): ${esc(r.description || '')}</li>`).join('')}</ul></details>` : ''}
    <p class="muted small">${srcLine}</p>`;

  renderAi();
  renderPlan();
  renderWatch();
}

function renderAi() {
  const card = $('#aiCard');
  const key = state.settings.anthropicKey;
  const ai = checkState.ai;
  card.innerHTML = `<div class="row between wrap"><h3>AI write-up</h3>${key ? `<button type="button" class="btn" id="aiBtn" ${ai && ai.loading ? 'disabled' : ''}>${ai && ai.text ? 'Write again' : 'Ask Claude'}</button>` : ''}</div>`
    + (!key ? '<p class="muted small">Add an Anthropic API key in Settings and Claude will turn these checks into a plain-English verdict: the biggest risk, what would change the call, and how the exit plan looks. The checks above work without it.</p>'
      : ai && ai.loading ? '<p class="muted">Thinking…</p>'
      : ai && ai.error ? `<p class="neg small">${esc(ai.error)}</p>`
      : ai && ai.text ? `<div class="ai-text">${esc(ai.text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</div>`
      : '<p class="muted small">Tap Ask Claude for a short read on this token and your plan.</p>');
  const b = $('#aiBtn');
  if (b) b.onclick = askClaude;
}

async function askClaude() {
  const key = state.settings.anthropicKey;
  if (!key) return;
  checkState.ai = { loading: true };
  renderAi();
  const { dex, risk, facts, plan } = checkState;
  const evidence = {
    token: { symbol: dex.symbol, chain: dex.chainId, marketCapUsd: dex.mcap, liquidityUsd: dex.liq, ageHours: facts.ageHours, volume24hUsd: dex.vol24h, priceChange: { m5: dex.change5m, h1: dex.change1h, h6: dex.change6h, h24: dex.change24h }, txns1h: { buys: dex.buys1h, sells: dex.sells1h } },
    checks: Object.fromEntries(Object.entries(facts).filter(([k]) => !k.startsWith('_') && !['liquidityUsd', 'mcapUsd', 'ageHours', 'buys1h', 'sells1h'].includes(k))),
    ruleFindings: risk.findings.map((f) => `${f.sev}: ${f.title}. ${f.detail}`),
    ruleVerdict: `${risk.verdict} (${risk.score}/100)`,
    notChecked: risk.unknown,
    feesOnCoin: { tradingFees24hUsd: (dex.vol24h || 0) * feeRate(dex.dexId).rate, networkFeeSample: checkState.feeSample && !checkState.feeSample.error && !checkState.feeSample.loading ? { avgFeeSol: checkState.feeSample.avg, maxFeeSol: checkState.feeSample.max, tippedShare: checkState.feeSample.tippedShare, est24hSol: checkState.feeSample.est24h } : null },
    topWallets: (checkState.holderDeep || []).filter((r) => !r.error).map((r) => ({ supplyPct: r.pct, balanceSol: r.balance, fresh: r.fresh, swaps7d: r.swaps7d, flow7dSol: r.flow7d, feesOnTokenSol: r.feesOnCa, tags: r.tags })),
    yourHistory: typeof historyEvidence === 'function' ? historyEvidence(facts, risk) : null,
    plan: plan ? { entryMcap: plan.entryMcap, targetMcap: plan.targetMcap, size: plan.size, stopPct: plan.stopPct, levels: plan.levels.map((l) => ({ mcap: Math.round(l.mcap), sellPct: l.sellPct })) } : null,
  };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        max_tokens: 800,
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: 'You are a blunt memecoin risk desk. You get on-chain evidence for one token and the trader\'s exit plan. Write at most 120 words, plain English, no headings, no bullet lists, no disclaimers. Cover: your verdict in one line; the single biggest risk and why; what would change your mind; one sentence on whether the exit plan fits this token. If key checks were not run, say which ones matter most. If yourHistory lists holder patterns that have cost this trader money and this coin has them, say so plainly in one sentence. Never invent data that is not in the evidence.',
        messages: [{ role: 'user', content: 'Evidence (JSON):\n' + JSON.stringify(evidence) }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
    if (j.stop_reason === 'refusal') throw new Error('Claude declined to answer this one.');
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    checkState.ai = { text: text || 'No answer came back.' };
  } catch (e) {
    checkState.ai = { error: /Failed to fetch|NetworkError/.test(e.message) ? 'The request was blocked (network or CORS). Check the key and try again.' : e.message };
  }
  renderAi();
}

// ---------- plan ----------
function suggestedSize() {
  try { renderSizing(); } catch { /* sizing tab may not have a balance */ }
  return state.sizeRec > 0 ? Math.round(state.sizeRec * 100) / 100 : null;
}

function renderPlan() {
  const { dex, plan } = checkState;
  const unit = isUsd() ? 'USD' : (state.unit || 'SOL');
  const card = $('#planCard');
  const posEntry = entryMcapOf(checkState.position, dex);
  const entryDefault = plan ? plan.entryMcap : posEntry || dex.mcap;
  const target = plan ? plan.targetMcap : entryDefault * 3;
  const size = plan ? plan.size : checkState.position ? checkState.position.cost : suggestedSize() || '';
  const stop = plan ? Math.round(plan.stopPct * 100) : Number($('#sizeForm')?.stopPct?.value) || 30;
  const amt = (v) => (unit === 'USD' ? usd(v) : fmt(v, 3) + ' ' + unit);
  card.innerHTML = `
    <h3>Plan the exit before you enter</h3>
    <form id="planForm" class="form-grid">
      <label><span class="lbl">Entry market cap${posEntry && !plan ? ' (from your position)' : ''}</span><input name="entry" value="${esc(Check.fmtMcap(entryDefault).replace('$', ''))}" inputmode="decimal" /></label>
      <label><span class="lbl">Target market cap</span><input name="target" value="${esc(Check.fmtMcap(target).replace('$', ''))}" inputmode="decimal" /></label>
      <label><span class="lbl">Size (${unit})</span><input name="size" type="number" step="any" min="0" value="${esc(String(size))}" placeholder="${state.sizeRec ? '' : 'set a balance on Sizing'}" /></label>
      <label><span class="lbl">Stop (% below entry)</span><input name="stop" type="number" step="1" min="1" max="95" value="${stop}" /></label>
      <div class="span2 row gap wrap">
        <span class="muted small">Quick targets:</span>${[2, 3, 5, 10].map((x) => `<button type="button" class="btn mini" data-x="${x}">${x}×</button>`).join('')}
        <button class="btn primary" type="submit">${plan ? 'Update plan' : 'Build plan'}</button>
      </div>
    </form>
    ${plan ? planTable(plan, amt) : '<p class="muted small">The plan sells in three trims on the way up and keeps a 10% runner. Your first trims should get your money out before the target.</p>'}`;
  const f = $('#planForm');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const entryMcap = Check.parseMcap(f.entry.value), targetMcap = Check.parseMcap(f.target.value);
    const p = Check.buildPlan({ entryMcap, targetMcap, size: Number(f.size.value), stopPct: (Number(f.stop.value) || 30) / 100 });
    if (!p) { alert('Check the numbers: the target must be above the entry and the size above zero.'); return; }
    checkState.plan = p;
    checkState.taken = [];
    const d = discipline(); d.planned += p.levels.length; store.set('discipline', d);
    saveCheck();
    renderPlan(); renderWatch(); renderDiscipline();
  });
  $$('[data-x]', f).forEach((b) => (b.onclick = () => { f.target.value = Check.fmtMcap(Check.parseMcap(f.entry.value) * Number(b.dataset.x)).replace('$', ''); }));
}

function planTable(plan, amt) {
  const taken = new Set(checkState.taken);
  const cur = checkState.dex?.mcap || 0;
  return `<div class="table-wrap"><table class="plan-table"><thead><tr><th>Level</th><th>Market cap</th><th class="num hide-m">×</th><th class="num">Sell</th><th class="num">You get</th><th></th></tr></thead><tbody>
    ${plan.levels.map((l) => `<tr class="${taken.has(l.i) ? 'done' : cur >= l.mcap ? 'hit' : ''}">
      <td>Trim ${l.i + 1}${plan.freeRideAt === l.i ? ' <span class="tag setup">initial back</span>' : ''}</td><td>${Check.fmtMcap(l.mcap)}</td><td class="num hide-m">${l.mult.toFixed(2)}×</td><td class="num">${l.sellPct}%</td><td class="num">${amt(l.sellValue)}</td>
      <td class="num">${taken.has(l.i) ? '<span class="pos">Taken ✓</span>' : `<button type="button" class="btn mini ${cur >= l.mcap ? 'primary' : ''}" data-take="${l.i}">Took it</button>`}</td></tr>`).join('')}
    <tr><td>Runner</td><td>${Check.fmtMcap(plan.targetMcap)}+</td><td class="num hide-m">${plan.X.toFixed(2)}×</td><td class="num">${plan.runnerPct}%</td><td class="num">${amt(plan.X * plan.size * plan.runnerPct / 100)}</td><td></td></tr>
    <tr class="stop-row"><td>Stop</td><td>${Check.fmtMcap(plan.stop.mcap)}</td><td class="num hide-m">${(1 - plan.stopPct).toFixed(2)}×</td><td class="num">100%</td><td class="num neg">-${amt(plan.stop.loss)}</td><td></td></tr>
  </tbody></table></div>
  <p class="muted small">If every trim hits and the runner reaches the target: ${amt(plan.expectedAtTarget)} back on ${amt(plan.size)} in. Trim 1 and 2 together ${plan.freeRideAt != null && plan.freeRideAt <= 1 ? 'return your initial, so everything after is house money' : 'do not yet return your initial'}.</p>
  ${checkState.celebrate ? `<div class="celebrate">${esc(checkState.celebrate)}</div>` : ''}`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-take]');
  if (!b || !checkState.plan) return;
  const i = Number(b.dataset.take);
  if (checkState.taken.includes(i)) return;
  checkState.taken.push(i);
  const l = checkState.plan.levels[i];
  const d = discipline(); d.taken += 1; d.locked += l.sellValue; store.set('discipline', d);
  const n = d.taken;
  checkState.celebrate = `🎯 Exit taken on plan. ${isUsd() ? usd(l.sellValue) : fmt(l.sellValue, 3) + ' ' + state.unit} locked in. That is ${n} planned exit${n === 1 ? '' : 's'} you actually took. Exits are the whole edge.`;
  saveCheck();
  try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch { /* ignore */ }
  renderPlan(); renderWatch(); renderDiscipline();
});

function renderDiscipline() {
  const d = discipline();
  const card = $('#disciplineCard');
  if (!d.planned) { card.hidden = true; return; }
  card.hidden = false;
  const rate = d.planned ? d.taken / d.planned : 0;
  card.innerHTML = `<h3>Exit discipline</h3><div class="row gap wrap"><div class="tile"><label>Planned exits taken</label><div class="big ${rate >= 0.6 ? 'pos' : rate >= 0.3 ? '' : 'neg'}">${d.taken} of ${d.planned}</div><div class="muted small">${pct(rate, 0)} follow-through</div></div><div class="tile"><label>Locked in on plan</label><div class="big pos">${isUsd() ? usd(d.locked) : fmt(d.locked, 2) + ' ' + state.unit}</div><div class="muted small">from trims you marked</div></div></div>`;
}

// ---------- watch ----------
function renderWatch() {
  const card = $('#watchCard');
  const { plan, watch, signal, dex } = checkState;
  if (!plan) { card.innerHTML = '<h3>Watch</h3><p class="muted small">Build a plan first. Then start watching and the app re-checks every 20 seconds while this page is open: trim calls when a level is hit, a warning when the top is in, and a walk-away call if liquidity goes.</p>'; return; }
  const v = signal?.verdict || 'hold';
  const head = { hold: 'Hold', trim: 'Trim into strength', exit: 'Walk away' }[v];
  const next = plan.levels.find((l) => !checkState.taken.includes(l.i));
  card.innerHTML = `
    <div class="row between wrap"><h3>Watch${watch ? ' <span class="live">● live</span>' : ''}</h3><button type="button" class="btn ${watch ? '' : 'primary'}" id="watchBtn">${watch ? 'Stop watching' : 'Start watching'}</button></div>
    ${signal ? `<div class="risk-banner ${v === 'hold' ? 'ok' : v === 'trim' ? 'warn' : 'stop'}"><b>${head}</b>${signal.reasons.length ? signal.reasons.map((r) => `<span>${esc(r.text)}</span>`).join('') : `<span>No trim due. ${next ? 'Next target ' + Check.fmtMcap(next.mcap) + ' (' + (100 * (next.mcap / dex.mcap - 1)).toFixed(0) + '% away).' : 'All planned trims taken. Let the runner run.'}</span>`}
      <span class="small muted">Now ${Check.fmtMcap(dex.mcap)} · high ${Check.fmtMcap(checkState.sessionHigh)} · liquidity ${Check.fmtMcap(dex.liq)} · ${fmtT(Date.now())}</span></div>`
      : `<p class="muted small">Not watching. Current market cap ${Check.fmtMcap(dex.mcap)}; next target ${next ? Check.fmtMcap(next.mcap) : '–'}.</p>`}
    <p class="muted small">Watching only runs while this page is open. Keep the tab in the foreground on your phone.</p>`;
  $('#watchBtn').onclick = () => (watch ? stopWatch() : startWatch());
}

let beeper = null;
function beep() {
  try {
    beeper = beeper || new (window.AudioContext || window.webkitAudioContext)();
    const o = beeper.createOscillator(), g = beeper.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(beeper.destination);
    o.start(); o.stop(beeper.currentTime + 0.25);
  } catch { /* no audio */ }
}

function startWatch() {
  if (!checkState.plan || checkState.watch) return;
  checkState.sessionHigh = checkState.dex.mcap;
  checkState.liq0 = checkState.dex.liq;
  beeper = beeper || new (window.AudioContext || window.webkitAudioContext || function () {})();
  checkState.watch = setInterval(tickWatch, WATCH_MS);
  tickWatch();
}
function stopWatch() {
  if (checkState.watch) clearInterval(checkState.watch);
  checkState.watch = null;
  checkState.signal = null;
  if (checkState.plan) renderWatch();
}
async function tickWatch() {
  if (!checkState.watch) return;
  let d;
  try { d = await fetchDex(checkState.ca); } catch { return; }
  const prevVerdict = checkState.signal?.verdict || 'hold';
  const prevHits = new Set(checkState.signal?.hits || []);
  checkState.dex = d;
  checkState.sessionHigh = Math.max(checkState.sessionHigh, d.mcap || 0);
  checkState.signal = Check.monitorSignal({ plan: checkState.plan, mcap: d.mcap, sessionHigh: checkState.sessionHigh, liq0: checkState.liq0, liq: d.liq, change5m: d.change5m, change1h: d.change1h, buys5m: d.buys5m, sells5m: d.sells5m, buys1h: d.buys1h, sells1h: d.sells1h, takenIdx: checkState.taken });
  const s = checkState.signal;
  const newHit = s.hits.some((i) => !prevHits.has(i));
  if ((s.verdict !== 'hold' && s.verdict !== prevVerdict) || newHit) {
    beep();
    try { navigator.vibrate && navigator.vibrate(s.verdict === 'exit' ? [300, 100, 300, 100, 300] : [200, 100, 200]); } catch { /* ignore */ }
  }
  renderCheck();
}

// ---------- your open positions ----------
function openPositions() {
  return (state.open || []).filter((p) => !isDust(p)).map((p) => ({ address: p.address || p.mint || '', token: p.token || (p.mint ? state.symbols[p.mint] || p.mint.slice(0, 6) : '?'), chain: p.chain || (p.mint ? 'Solana' : ''), cost: p.cost, unrealized: p.unrealized, entryPrice: p.entryPrice, openedAt: p.openedAt })).filter((p) => p.address);
}
const dustCount = () => (state.open || []).filter(isDust).length;

function renderPositions() {
  const card = $('#positionsCard');
  const list = openPositions();
  const dust = dustCount();
  if (!list.length && !dust) { card.hidden = true; return; }
  card.hidden = false;
  if (!list.length) { card.innerHTML = `<h3>Your open positions</h3><p class="muted small">${dust} dust position${dust === 1 ? '' : 's'} under ${usd(dustUsd())} hidden (change the threshold in Settings).</p>`; return; }
  const unit = (v) => (isUsd() ? usd(v) : fmt(v, 3) + ' ' + (state.unit || 'SOL'));
  const running = checkState.checkingAll;
  card.innerHTML = `<div class="row between wrap"><h3>Your open positions (${list.length})</h3><button type="button" class="btn ${running ? '' : 'primary'}" id="checkAllBtn" ${running ? 'disabled' : ''}>${running ? 'Checking…' : 'Check all'}</button></div>
    <div class="table-wrap"><table class="pos-table"><thead><tr><th>Token</th><th class="num">In</th><th class="num">Unrealized</th><th>Now</th><th>Verdict</th><th></th></tr></thead><tbody>
    ${list.map((p, i) => { const c = checkState.cache[p.address]; const entry = c ? entryMcapOf(p, c.dex) : null; const move = entry ? c.dex.mcap / entry - 1 : null;
      return `<tr><td><b>${esc(p.token)}</b>${p.chain ? `<span class="tag">${esc(p.chain)}</span>` : ''}</td><td class="num">${unit(p.cost)}</td><td class="num ${cls(p.unrealized)}">${p.unrealized != null ? (p.unrealized < 0 ? '-' : '+') + unit(Math.abs(p.unrealized)) : '–'}</td>
        <td>${c ? Check.fmtMcap(c.dex.mcap) + (move != null ? ` <span class="small ${cls(move)}">${move > 0 ? '+' : ''}${(move * 100).toFixed(0)}%</span>` : '') : '<span class="muted">–</span>'}</td>
        <td>${c ? `<span class="v-pill ${verdictClass[c.risk.verdict]}">${c.risk.score} · ${esc(c.risk.verdict)}</span>` : '<span class="muted">not checked</span>'}</td>
        <td class="num"><button type="button" class="btn mini" data-pos="${i}">${c ? 'Open' : 'Check'}</button></td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="muted small">From your last FOMO sync${dust ? `; ${dust} dust position${dust === 1 ? '' : 's'} under ${usd(dustUsd())} hidden` : ''}. Check all runs the rug check on every position; tap Open for the full view, plan and watch.</p>
    ${liveAiBlock(list)}`;
  const lb = $('#liveAiBtn'); if (lb) lb.onclick = () => analyzeLiveTrades(false);
  const la = $('#liveAuto'); if (la) la.onchange = (e) => { state.settings.liveAiAuto = e.target.checked; store.set('settings', state.settings); scheduleLiveAi(); if (e.target.checked) analyzeLiveTrades(true); };
  $('#checkAllBtn').onclick = checkAllPositions;
  $$('[data-pos]', card).forEach((b) => (b.onclick = () => { const p = list[Number(b.dataset.pos)]; runCheck(p.address, p); window.scrollTo({ top: $('#checkResult').offsetTop - 70, behavior: 'smooth' }); }));
}

// ---------- AI review of live trades ----------
const LIVE_AI_MS = 10 * 60000;
function liveAiBlock(list) {
  const key = state.settings.anthropicKey;
  const r = checkState.liveAi;
  const head = `<div class="row between wrap live-head"><b>AI review of your live trades</b><div class="row gap">${key ? `<label class="chk"><input type="checkbox" id="liveAuto" ${state.settings.liveAiAuto ? 'checked' : ''} /> auto every 10 min</label><button type="button" class="btn mini primary" id="liveAiBtn" ${r && r.loading ? 'disabled' : ''}>${r && r.loading ? 'Reviewing…' : r ? 'Review again' : 'Analyze my live trades'}</button>` : ''}</div></div>`;
  if (!key) return head + '<p class="muted small">Add an Anthropic API key in Settings and Claude will review every open position: hold, trim or exit, with the reason, and an overall read on your exposure.</p>';
  if (!r) return head + '<p class="muted small">Claude gets each position\'s entry, current market cap, liquidity, flow and rug score plus your risk rules, and returns a call per trade.</p>';
  if (r.loading) return head + '<p class="muted">Refreshing positions and asking Claude…</p>';
  if (r.error) return head + `<p class="neg small">${esc(r.error)}</p>`;
  const pill = (a) => ({ hold: 'ok', trim: 'warn', exit: 'stop' }[a] || 'ok');
  const label = (p) => (p.action === 'trim' ? `Trim${p.trimPct ? ' ' + p.trimPct + '%' : ''}` : p.action === 'exit' ? 'Exit' : 'Hold');
  return head + `<div class="live-rows">${r.positions.map((p) => { const pos = list[p.id] || {}; return `<div class="live-row"><span class="v-pill ${pill(p.action)}">${label(p)}</span><div><b>${esc(pos.token || p.token || '?')}</b> <span class="muted small">${esc(p.reason)}</span></div></div>`; }).join('')}</div>
    <p class="small">${esc(r.overall)}</p><p class="muted small">Reviewed ${fmtT(r.at)}${state.settings.liveAiAuto ? ' · auto every 10 min while this page is open' : ''}. Not financial advice.</p>`;
}

async function analyzeLiveTrades(silent) {
  const key = state.settings.anthropicKey;
  const list = openPositions();
  if (!key || !list.length) return;
  if (checkState.liveAi && checkState.liveAi.loading) return;
  checkState.liveAi = { loading: true };
  renderPositions();
  try {
    for (const p of list) { const c = checkState.cache[p.address]; if (c) c.at = 0; } // force a fresh read of every position
    await checkAllPositions();
    const risk = Stats.riskStatus(state.trades, { lossLimit: Number(state.settings.lossLimit) || 0, maxLossStreak: Number(state.settings.maxLossStreak) || 0 });
    const s = Stats.computeStats(state.trades.slice(-50));
    const balance = Number(accountBalance()) || 0;
    const positions = list.map((p, i) => {
      const c = checkState.cache[p.address];
      const entry = c ? entryMcapOf(p, c.dex) : null;
      return { id: i, token: p.token, chain: p.chain, cost: p.cost, unrealized: p.unrealized, heldHours: p.openedAt ? (Date.now() - new Date(p.openedAt)) / 3600e3 : null,
        entryMcap: entry, nowMcap: c ? c.dex.mcap : null, movePct: entry && c ? 100 * (c.dex.mcap / entry - 1) : null,
        liquidityUsd: c ? c.dex.liq : null, change1h: c ? c.dex.change1h : null, change24h: c ? c.dex.change24h : null, buys1h: c ? c.dex.buys1h : null, sells1h: c ? c.dex.sells1h : null,
        rugScore: c ? c.risk.score : null, rugVerdict: c ? c.risk.verdict : null, topFindings: c ? c.risk.findings.slice(0, 3).map((f) => f.title) : [] };
    });
    const evidence = { unit: isUsd() ? 'USD' : 'SOL', balance, exposure: list.reduce((a, p) => a + (p.cost || 0), 0), positions,
      trader: { todayPnl: risk.todayPnl, todayTrades: risk.todayTrades, lossStreak: risk.streak, riskLevel: risk.level, lossLimit: Number(state.settings.lossLimit) || 0, winRate: s.winRate, profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : 99, avgHoldHours: s.avgHoldMs / 3600e3, avgLossPct: s.avgLossPct, stopPct: Number($('#sizeForm')?.stopPct?.value) || 30 } };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      body: JSON.stringify({
        model: 'claude-opus-5-5', max_tokens: 1200, fallbacks: 'default', output_config: { effort: 'low' },
        system: 'You are a blunt risk desk reviewing a memecoin trader\'s OPEN positions right now. For each position decide hold, trim or exit using: distance from entry vs their stop %, liquidity, 1h/24h momentum and buy/sell balance, rug score and findings, hold time vs their average, and the trader\'s daily loss state. Prefer taking profit into strength and cutting rugs fast. Reply with ONLY a JSON object: {"overall": "<under 60 words on total exposure, concentration and whether they should be trading at all today>", "positions": [{"id": <id>, "action": "hold"|"trim"|"exit", "trimPct": <number, only for trim>, "reason": "<under 25 words, concrete, cite a number>"}]}. Include every position id exactly once. Never invent data that is not in the evidence.',
        messages: [{ role: 'user', content: JSON.stringify(evidence) }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
    if (j.stop_reason === 'refusal') throw new Error('Claude declined to review these.');
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON in the answer.');
    const o = JSON.parse(m[0]);
    const byId = new Map((o.positions || []).map((p) => [Number(p.id), p]));
    checkState.liveAi = { at: Date.now(), overall: String(o.overall || ''), positions: list.map((p, i) => { const x = byId.get(i) || {}; const action = ['hold', 'trim', 'exit'].includes(x.action) ? x.action : 'hold'; return { id: i, token: p.token, action, trimPct: action === 'trim' && Number(x.trimPct) > 0 ? Math.round(Number(x.trimPct)) : null, reason: String(x.reason || (byId.has(i) ? '' : 'No call returned for this one.')).slice(0, 200) }; }) };
  } catch (e) {
    checkState.liveAi = { error: /Failed to fetch|NetworkError/.test(e.message) ? 'The request was blocked (network or CORS). Check the key and try again.' : e.message };
  }
  renderPositions();
}

let liveAiTimer = null;
function scheduleLiveAi() {
  if (liveAiTimer) clearInterval(liveAiTimer);
  liveAiTimer = null;
  if (state.settings.liveAiAuto && state.settings.anthropicKey) liveAiTimer = setInterval(() => { if (document.visibilityState === 'visible') analyzeLiveTrades(true); }, LIVE_AI_MS);
}
scheduleLiveAi();

async function checkAllPositions() {
  if (checkState.checkingAll) return;
  checkState.checkingAll = true;
  renderPositions();
  for (const p of openPositions()) {
    const c = checkState.cache[p.address];
    if (c && Date.now() - c.at < 5 * 60000) continue;
    try {
      const dex = await fetchDex(p.address);
      let sec = {};
      if (dex.chainId === 'solana') { try { sec = await fetchRugcheck(p.address); } catch { /* keep going */ } }
      else { try { sec = await fetchGoplus(dex.chainId, p.address); } catch { /* keep going */ } }
      const risk = Check.assessRisk(Object.assign({ liquidityUsd: dex.liq, mcapUsd: dex.mcap, ageHours: dex.createdAt ? (Date.now() - dex.createdAt) / 3600e3 : undefined, buys1h: dex.buys1h, sells1h: dex.sells1h }, sec));
      checkState.cache[p.address] = { dex, risk, at: Date.now() };
    } catch { checkState.cache[p.address] = null; }
    renderPositions();
  }
  checkState.checkingAll = false;
  renderPositions();
}

// ---------- paste & deep link ----------
async function pasteAndCheck() {
  const status = $('#checkStatus');
  if (!navigator.clipboard || !navigator.clipboard.readText) { status.textContent = 'This browser cannot read the clipboard. Long-press the box and tap Paste instead.'; return; }
  try {
    const text = await navigator.clipboard.readText();
    const ca = Check.extractAddress(text);
    if (!ca) { status.innerHTML = '<span class="neg">No contract address in the clipboard. Copy a CA first.</span>'; return; }
    runCheck(ca);
  } catch { status.textContent = 'Clipboard access was not allowed. Long-press the box and tap Paste instead.'; }
}

// ---------- wiring ----------
$('#checkForm').addEventListener('submit', (e) => { e.preventDefault(); runCheck($('#caInput').value); });
$('#pasteBtn').onclick = pasteAndCheck;
$('#caInput').addEventListener('paste', () => setTimeout(() => { if (Check.extractAddress($('#caInput').value)) runCheck($('#caInput').value); }, 50));
$('#recentChecks').addEventListener('click', (e) => { const b = e.target.closest('[data-ca]'); if (b) { $('#caInput').value = b.dataset.ca; runCheck(b.dataset.ca); } });
function renderRecent() {
  const all = checks();
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 6);
  $('#recentChecks').innerHTML = keys.length ? 'Recent: ' + keys.map((k) => `<button type="button" class="btn mini" data-ca="${esc(k)}">${esc(all[k].symbol || k.slice(0, 6))}</button>`).join(' ') : '';
}
const _renderCheck = renderCheck;
renderCheck = function () { renderRecent(); renderPositions(); _renderCheck(); };
// ?ca=<address> opens the Check tab and runs it (an iOS Shortcut can send the clipboard here).
const _caParam = new URLSearchParams(location.search).get('ca');
if (_caParam && Check.extractAddress(_caParam)) { showTab('check'); runCheck(_caParam); }
else if ($('.tab.active')?.id === 'check') renderCheck();
