/* global WalletMem, Gmgn, Calls, Check, gmgnAvailable, gmgnGet, callState, callerOf, saveCalls, checkState, renderCheck, store, esc */
'use strict';
// Wallet memory: learns from Call queue coins that rugged or ran (GMGN top traders by profit), then shows on the
// Check tab, and in the Call queue score, which of a coin's wallets profited on earlier rugs or runners.

const WM_LEARN_PER_RUN = 3;          // finished coins learned per queue refresh (one GMGN request each)
const WM_SCAN_PER_RUN = 5;           // queue coins matched per refresh (one GMGN request each)
const WM_SCAN_TTL = 30 * 60000;
const wmState = { mem: store.get('walletMem', WalletMem.empty()) };
const wmGraded = () => { const g = WalletMem.stats(wmState.mem).graded; return g.rug + g.runner + g.bot; };

// Each finished rug or runner in the call book, once: who took profit on it.
async function learnWallets() {
  if (!gmgnAvailable()) return;
  const todo = callState.book.filter((x) => !wmState.mem.coins[x.address] && Gmgn.toGmgnChain(x.chain) && ['rug', 'runner'].includes(WalletMem.outcome(x))).slice(0, WM_LEARN_PER_RUN);
  for (const x of todo) {
    try {
      const d = await gmgnGet('market/token_top_traders', { chain: Gmgn.toGmgnChain(x.chain), address: x.address, limit: '100', order_by: 'profit' });
      wmState.mem = WalletMem.learn(wmState.mem, x, WalletMem.outcome(x), WalletMem.profitable((d && d.list) || [], x.at), Date.now());
      store.set('walletMem', wmState.mem);
    } catch { return; } // GMGN not set up or refusing: try again on a later refresh
  }
}

// The best-scoring queue coins: how many of their top holders are known rug, runner or bot wallets.
async function scanQueueWallets(now) {
  if (!gmgnAvailable() || !wmGraded()) return;
  const q = callState.queue;
  const learned = Object.keys(wmState.mem.coins).length; // match again once the memory has learned more
  const due = Object.values(q).filter((e) => Calls.isFresh(e, now, callState.maxAgeH * 3600000) && Gmgn.toGmgnChain(e.chainId || e.chain) && (!e.wm || e.wm.v !== learned || now - e.wm.at > WM_SCAN_TTL))
    .sort((a, b) => Calls.callScore(b, callerOf(b.firstPoster), now).score - Calls.callScore(a, callerOf(a.firstPoster), now).score).slice(0, WM_SCAN_PER_RUN);
  for (const e of due) {
    try {
      const d = await gmgnGet('market/token_top_holders', { chain: Gmgn.toGmgnChain(e.chainId || e.chain), address: e.address, limit: '100' });
      const m = WalletMem.match(wmState.mem, ((d && d.list) || []).map((h) => h.address));
      if (q[e.address]) q[e.address] = Object.assign({}, q[e.address], { wm: { rug: m.rug.length, runner: m.runner.length, bot: m.bot.length, at: now, v: learned } });
    } catch { break; }
  }
  if (due.length) saveCalls();
}

function walletMemLine() {
  const s = WalletMem.stats(wmState.mem);
  if (!s.rugs && !s.runners) return gmgnAvailable() ? '<p class="muted small">Wallet memory: learning. Once priced calls rug (−80%) or run (3×), the wallets that took profit on them are remembered here.</p>' : '';
  return `<p class="muted small">Wallet memory: learned from <b>${s.rugs}</b> rug${s.rugs === 1 ? '' : 's'} and <b>${s.runners}</b> runner${s.runners === 1 ? '' : 's'} · ${s.wallets.toLocaleString()} wallets (${s.graded.rug} rug, ${s.graded.runner} runner, ${s.graded.bot} bot; a wallet needs 2 coins to be graded).</p>`;
}

// ---- Check tab ----
async function autoWalletMem() {
  const ca = checkState.ca, dex = checkState.dex;
  const chain = dex && Gmgn.toGmgnChain(dex.chainId);
  if (!chain || !gmgnAvailable()) return;
  checkState.walletMem = { loading: true };
  renderCheck();
  try {
    // The same requests as Early traders and Holder labels, so these are shared, not extra.
    const [h, t] = await Promise.all([
      gmgnGet('market/token_top_holders', { chain, address: ca, limit: '100' }),
      gmgnGet('market/token_top_traders', { chain, address: ca, limit: '100', order_by: 'profit' }),
    ]);
    if (checkState.ca !== ca) return;
    const addrs = [].concat((h && h.list) || [], (t && t.list) || []).filter((x) => x && (Number(x.addr_type) || 0) === 0).map((x) => x.address);
    const m = WalletMem.match(wmState.mem, addrs);
    checkState.walletMem = { m, stats: WalletMem.stats(wmState.mem) };
    Object.assign(checkState.facts, { wmRug: m.rug.length, wmRugCoins: m.rug.reduce((a, w) => a + w.rug, 0), wmRunner: m.runner.length });
    checkState.risk = Check.assessRisk(checkState.facts);
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.walletMem = e.message === 'not_configured' ? null : { error: e.message };
  }
  renderCheck();
}

function walletMemBlock() {
  const w = checkState.walletMem;
  if (!w || !checkState.dex) return '';
  const head = '<div class="flow-block wm-block"><div class="row between wrap"><b>Wallet memory</b>';
  if (w.loading) return head + '</div><p class="muted small">Comparing this coin\'s wallets with the ones you have seen before…</p></div>';
  if (w.error) return head + `</div><p class="neg small">${esc(w.error)}</p></div>`;
  const { m, stats } = w;
  if (!stats.rugs && !stats.runners) return head + '</div><p class="muted small">Nothing learned yet. As Call queue coins rug or run, the wallets that took profit on them are remembered and flagged here when they show up again.</p></div>';
  const usdK = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
  const short = (a) => esc(a.slice(0, 4) + '…' + a.slice(-4));
  const cls = m.rug.length >= 2 ? 'neg' : m.runner.length >= 2 ? 'pos' : 'muted';
  const label = m.rug.length >= 2 ? `${m.rug.length} rug wallets` : m.runner.length >= 2 ? `${m.runner.length} runner wallets` : 'no clear signal';
  const rows = [].concat(m.rug.map((x) => ['rug', x]), m.runner.map((x) => ['runner', x]), m.bot.map((x) => ['bot', x])).slice(0, 10);
  return head + `<span class="flow-label ${cls}">${label}</span></div>
    <p class="small">${m.rug.length} rug wallet${m.rug.length === 1 ? '' : 's'}${m.rug.length ? ` (profited on ${m.rug.reduce((a, x) => a + x.rug, 0)} earlier rugs between them)` : ''} · ${m.runner.length} runner wallet${m.runner.length === 1 ? '' : 's'} · ${m.bot.length} bot${m.bot.length === 1 ? '' : 's'} among this coin's top holders and traders.</p>
    ${rows.length ? `<div class="table-wrap"><table class="wm-table"><thead><tr><th>Wallet</th><th>Seen as</th><th class="num">Rugs</th><th class="num">Runners</th><th class="num hide-m">Profit taken</th></tr></thead><tbody>
      ${rows.map(([g, x]) => `<tr><td><code>${short(x.address)}</code></td><td class="${g === 'rug' ? 'neg' : g === 'runner' ? 'pos' : 'muted'}">${g}</td><td class="num">${x.rug}</td><td class="num">${x.run}</td><td class="num hide-m">${usdK(x.usd)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    <p class="muted small">Learned from ${stats.rugs} rug${stats.rugs === 1 ? '' : 's'} and ${stats.runners} runner${stats.runners === 1 ? '' : 's'} in your Call queue. Rug wallets took profit on 2+ earlier rugs, runner wallets on 2+ runners, bots on both. Few coins learned means a weak signal.</p></div>`;
}
