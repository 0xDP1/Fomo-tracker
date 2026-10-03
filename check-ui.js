/* global Check, state, store, $, $$, esc, fmt, usd, pct, cls, fmtT, fmtDT, THEME, isUsd, accountBalance, renderSizing */
'use strict';

// ---------- token check: data sources ----------
const DEX_API = 'https://api.dexscreener.com/latest/dex/tokens/';
const RUGCHECK_API = 'https://api.rugcheck.xyz/v1/tokens/';
const GOPLUS_API = 'https://api.gopluslabs.io/api/v1/';
const GOPLUS_CHAIN = { ethereum: '1', bsc: '56', base: '8453', arbitrum: '42161', polygon: '137', avalanche: '43114', optimism: '10', monad: '143' };
const WATCH_MS = 20000;

const checkState = { ca: null, chain: null, dex: null, facts: null, risk: null, plan: null, taken: [], sources: {}, watch: null, sessionHigh: 0, liq0: 0, signal: null, ai: null, celebrate: null };

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
  const isPool = (addr) => /amm|pool|lp|raydium|orca|meteora|pump/i.test(known[addr]?.type || known[addr]?.name || '');
  const holders = (r.topHolders || []).filter((h) => !isPool(h.address));
  if (holders.length) {
    f.topHolderPct = Math.max(...holders.map((h) => Number(h.pct) || 0));
    f.top10Pct = holders.slice(0, 10).reduce((s, h) => s + (Number(h.pct) || 0), 0);
  }
  const nets = r.insiderNetworks || [];
  if (nets.length && supply > 0) {
    f.insiderPct = 100 * nets.reduce((s, n) => s + (Number(n.tokenAmount) || 0), 0) / supply;
    f.insiderWallets = nets.reduce((s, n) => s + (Number(n.size) || Number(n.activeAccounts) || 0), 0);
  } else if (r.topHolders) {
    f.insiderPct = (r.topHolders || []).filter((h) => h.insider).reduce((s, h) => s + (Number(h.pct) || 0), 0);
  }
  const markets = r.markets || [];
  const lps = markets.map((m) => m.lp?.lpLockedPct).filter((v) => typeof v === 'number');
  if (lps.length) f.lpLockedPct = Math.min(...lps);
  if (r.creator) {
    const c = (r.topHolders || []).find((h) => h.owner === r.creator || h.address === r.creator);
    if (c) f.creatorPct = Number(c.pct) || 0;
  }
  f._risks = (r.risks || []).map((x) => ({ name: x.name, level: x.level, description: x.description }));
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
  const hs = (d.holders || []).filter((h) => h.is_contract !== 1 && !/pair|pool|lp|burn|dead|null/i.test(h.tag || '') && !/^0x0+dead$|^0x0+$/i.test(h.address || ''));
  if (hs.length) {
    f.topHolderPct = Math.max(...hs.map((h) => Number(h.percent) * 100 || 0));
    f.top10Pct = hs.slice(0, 10).reduce((s, h) => s + (Number(h.percent) * 100 || 0), 0);
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
  const hs = d.holders || [];
  if (hs.length) {
    f.topHolderPct = Math.max(...hs.map((h) => Number(h.percent) * 100 || 0));
    f.top10Pct = hs.slice(0, 10).reduce((s, h) => s + (Number(h.percent) * 100 || 0), 0);
  }
  const lps = d.lp_holders || [];
  if (lps.length) f.lpLockedPct = Math.min(100, lps.filter((h) => h.is_locked === 1).reduce((s, h) => s + Number(h.percent) * 100, 0));
  if (d.creators && d.creators.length) f.creatorPct = d.creators.reduce((s, c) => s + (Number(c.malicious_address) ? 0 : 0), 0) || undefined;
  return f;
}

// ---------- run a check ----------
async function runCheck(raw) {
  const ca = Check.extractAddress(raw);
  const status = $('#checkStatus');
  if (!ca) { status.innerHTML = '<span class="neg">Paste a contract address (a 0x… address or a Solana mint).</span>'; return; }
  stopWatch();
  Object.assign(checkState, { ca, chain: Check.detectChain(ca), dex: null, facts: null, risk: null, plan: null, taken: [], sources: {}, sessionHigh: 0, liq0: 0, signal: null, ai: null, celebrate: null });
  const saved = checks()[ca];
  if (saved) { checkState.plan = saved.plan || null; checkState.taken = saved.taken || []; }
  $('#checkResult').hidden = true;
  status.textContent = 'Checking the pool…';
  try {
    checkState.dex = await fetchDex(ca);
    checkState.sources.dex = 'ok';
  } catch (e) {
    checkState.sources.dex = e.message;
    status.innerHTML = `<span class="neg">DexScreener: ${esc(e.message)}. ${e.message === 'blocked' ? 'The request was blocked (network or CORS).' : 'Is this a traded token?'}</span>`;
    return;
  }
  status.textContent = 'Checking the contract and holders…';
  const dex = checkState.dex;
  let sec = {};
  if (dex.chainId === 'solana') {
    try { sec = await fetchRugcheck(ca); checkState.sources.security = 'RugCheck'; }
    catch (e) {
      try { sec = await fetchGoplusSolana(ca); checkState.sources.security = 'GoPlus'; checkState.sources.securityNote = 'RugCheck ' + e.message; }
      catch (e2) { checkState.sources.security = null; checkState.sources.securityNote = `RugCheck ${e.message}, GoPlus ${e2.message}`; }
    }
  } else {
    try { sec = await fetchGoplus(dex.chainId, ca); checkState.sources.security = 'GoPlus'; }
    catch (e) { checkState.sources.security = null; checkState.sources.securityNote = 'GoPlus ' + e.message; }
  }
  checkState.facts = Object.assign({
    liquidityUsd: dex.liq, mcapUsd: dex.mcap,
    ageHours: dex.createdAt ? (Date.now() - dex.createdAt) / 3600e3 : undefined,
    buys1h: dex.buys1h, sells1h: dex.sells1h,
  }, sec);
  checkState.risk = Check.assessRisk(checkState.facts);
  status.textContent = '';
  $('#checkResult').hidden = false;
  saveCheck();
  renderCheck();
}

// ---------- rendering ----------
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
    <div class="muted small">CA <code>${esc(checkState.ca)}</code></div>`;

  const src = checkState.sources;
  const srcLine = `Checked with DexScreener${src.security ? ' and ' + src.security : ''}.${src.securityNote ? ' <span class="neg">' + esc(src.securityNote) + '.</span>' : ''}${risk.unknown.length ? ' <span class="muted">Not checked: ' + esc(risk.unknown.join(', ')) + '.</span>' : ''}`;
  $('#verdictCard').innerHTML = `
    <div class="verdict ${verdictClass[risk.verdict]}">
      <div class="verdict-score"><b>${risk.score}</b><span>/100</span></div>
      <div><div class="verdict-title">${esc(risk.verdict)}</div><div class="small">${risk.findings.length ? risk.findings.length + ' finding' + (risk.findings.length === 1 ? '' : 's') : 'No red flags in what was checked'}</div></div>
    </div>
    ${risk.findings.length ? `<ul class="findings">${risk.findings.map((f) => `<li class="f-${f.sev}"><span class="sev">${sevLabel[f.sev]}</span><div><b>${esc(f.title)}</b><div class="muted small">${esc(f.detail)}</div></div></li>`).join('')}</ul>` : ''}
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
        system: 'You are a blunt memecoin risk desk. You get on-chain evidence for one token and the trader\'s exit plan. Write at most 120 words, plain English, no headings, no bullet lists, no disclaimers. Cover: your verdict in one line; the single biggest risk and why; what would change your mind; one sentence on whether the exit plan fits this token. If key checks were not run, say which ones matter most. Never invent data that is not in the evidence.',
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
  const target = plan ? plan.targetMcap : dex.mcap * 3;
  const size = plan ? plan.size : suggestedSize() || '';
  const stop = plan ? Math.round(plan.stopPct * 100) : Number($('#sizeForm')?.stopPct?.value) || 30;
  const amt = (v) => (unit === 'USD' ? usd(v) : fmt(v, 3) + ' ' + unit);
  card.innerHTML = `
    <h3>Plan the exit before you enter</h3>
    <form id="planForm" class="form-grid">
      <label><span class="lbl">Entry market cap</span><input name="entry" value="${esc(Check.fmtMcap(plan ? plan.entryMcap : dex.mcap).replace('$', ''))}" inputmode="decimal" /></label>
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

// ---------- wiring ----------
$('#checkForm').addEventListener('submit', (e) => { e.preventDefault(); runCheck($('#caInput').value); });
$('#caInput').addEventListener('paste', () => setTimeout(() => { if (Check.extractAddress($('#caInput').value)) runCheck($('#caInput').value); }, 50));
$('#recentChecks').addEventListener('click', (e) => { const b = e.target.closest('[data-ca]'); if (b) { $('#caInput').value = b.dataset.ca; runCheck(b.dataset.ca); } });
function renderRecent() {
  const all = checks();
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 6);
  $('#recentChecks').innerHTML = keys.length ? 'Recent: ' + keys.map((k) => `<button type="button" class="btn mini" data-ca="${esc(k)}">${esc(all[k].symbol || k.slice(0, 6))}</button>`).join(' ') : '';
}
const _renderCheck = renderCheck;
renderCheck = function () { renderRecent(); _renderCheck(); };
if ($('.tab.active')?.id === 'check') renderCheck();
