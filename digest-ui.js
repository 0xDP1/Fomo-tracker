/* global Digest, Calls, state, store, addCalls, coinLinks, runCheck, showTab, showPane, esc, ago, $ */
'use strict';
// Feed digest (Calls tab): the whole on chain feed over the last 5, 15, 30 or 60 minutes, read through the Discord feed
// Worker on tap, sorted by chat, the coins the chats agree on, and Claude Haiku's read with your Anthropic key
// (docs/features/feed-digest.md). The last digest is kept on this device.

const DIGEST_MODEL = 'claude-haiku-5-5';
const digestState = Object.assign({ minutes: 15, loading: '', error: '', d: null, summary: null, at: null, reachedAt: null, capped: false }, store.get('digest', {}));
const digestAvailable = () => !!(state.settings.feedUrl && state.settings.feedKey);
const digestSave = () => { const { minutes, d, summary, at, reachedAt, capped } = digestState; store.set('digest', { minutes, d: d ? Object.assign({}, d, { lines: [] }) : null, summary, at, reachedAt, capped }); };

async function fetchDigest(minutes) {
  const { feedUrl, feedKey } = state.settings;
  let r;
  try { r = await fetch(feedUrl.replace(/\/+$/, '') + '/digest?' + new URLSearchParams({ minutes: String(minutes) }), { headers: { 'x-feed-key': feedKey }, cache: 'no-store' }); } catch { throw new Error('Can\'t reach the Worker.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('The Worker rejected the feed key.');
  if (r.status === 404) throw new Error('The Worker is older than this app: redeploy it (worker/README.md).');
  if (j.error === 'not_configured') throw new Error('Add CHATTER_CHANNEL (the on chain feed channel ID) to the Worker in Cloudflare.');
  if (!r.ok) throw new Error('Feed read failed: ' + (j.error || 'HTTP ' + r.status));
  return j;
}

async function digestAsk(minutes, d) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': state.settings.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: DIGEST_MODEL, max_tokens: 3000, system: Digest.SYSTEM, output_config: { effort: 'low', format: { type: 'json_schema', schema: Digest.SCHEMA } }, messages: [{ role: 'user', content: Digest.prompt(minutes, d) }] }),
  });
  if (r.status === 401) throw new Error('Anthropic rejected the API key.');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Anthropic HTTP ${r.status}`);
  if (j.stop_reason === 'refusal') throw new Error('Claude declined to summarise this feed.');
  const s = Digest.readDigest((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
  if (!s) throw new Error('The read came back unreadable. Try again.');
  return s;
}

async function runDigest() {
  if (digestState.loading || !digestAvailable()) return;
  const minutes = digestState.minutes;
  Object.assign(digestState, { loading: `Reading the last ${Digest.windowLabel(minutes)} of on chain feed…`, error: '' });
  renderDigest();
  try {
    const got = await fetchDigest(minutes);
    const d = Digest.build(got.messages || [], Date.now());
    Object.assign(digestState, { d, summary: null, at: Date.now(), reachedAt: got.reachedAt || null, capped: !!got.capped });
    if (d.talk && state.settings.anthropicKey) {
      digestState.loading = `Claude is reading ${d.lines.length} messages…`;
      renderDigest();
      try { digestState.summary = await digestAsk(minutes, d); } catch (e) { digestState.error = e.message; }
    }
  } catch (e) {
    digestState.error = e.message;
  }
  digestState.loading = '';
  digestSave();
  renderDigest();
}

const digestGroupTag = (code) => `<span class="tag grp grp-${Calls.groupColor(code, [])}">${esc(code)}</span>`;
const digestWhen = (t) => (t ? ago(t) + ' ago' : '–');

function renderDigest() {
  const el = $('#digestCard');
  if (!el) return;
  const st = digestState, d = st.d, s = st.summary;
  const chips = `<div class="row gap wrap digest-chips"><span class="muted small">Last</span>${Digest.WINDOWS.map((m) => `<button type="button" class="btn mini${m === st.minutes ? ' primary' : ''}" data-digest-minutes="${m}">${Digest.windowLabel(m)}</button>`).join('')}
    <button type="button" class="btn mini" id="digestRun" ${st.loading ? 'disabled' : ''}>${d ? 'Summarize again' : 'Summarize'}</button></div>`;
  let body = '';
  if (!digestAvailable()) body = '<p class="muted small">Needs the Discord feed Worker (Settings → Advanced): the digest reads the on chain feed channel through it.</p>';
  else if (st.loading) body = `<p class="muted small">${esc(st.loading)}</p>`;
  if (st.error) body += `<p class="neg small">${esc(st.error)}</p>`;
  if (d && !st.loading) {
    const moodCls = { bullish: 'pos', bearish: 'neg', mixed: 'warn-text', quiet: 'muted' };
    const takes = {};
    if (s) for (const g of s.groups) takes[g.code] = g.take;
    const coinRows = d.coins.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.address ? `<br><code class="small">${esc(c.address.slice(0, 4) + '…' + c.address.slice(-4))}</code>` : ''}</td><td>${c.groups.map(digestGroupTag).join(' ')}</td><td class="num">${c.mentions}</td><td class="num hide-m">${c.posters}</td><td class="hide-m small">${esc(digestWhen(c.firstAt))}</td><td class="small">${esc(digestWhen(c.lastAt))}</td>
      <td class="nowrap">${c.address && c.chain === 'solana' ? `${coinLinks('solana', c.address)}<button type="button" class="btn mini" data-digest-check="${esc(c.address)}">Check</button> <button type="button" class="btn mini" data-digest-add="${esc(c.address)}">Add</button>` : c.address ? `<button type="button" class="btn mini" data-digest-check="${esc(c.address)}">Check</button> <button type="button" class="btn mini" data-digest-add="${esc(c.address)}" data-chain="${esc(c.chain || '')}">Add</button>` : '<span class="muted small">no address</span>'}</td></tr>`).join('');
    const groupRows = d.groups.map((g) => `<li>${digestGroupTag(g.code)} <span class="muted small">${g.messages ? `${g.people.length} ${g.people.length === 1 ? 'person' : 'people'} · ${g.messages} msg${g.messages === 1 ? '' : 's'}${g.scans ? ` · ${g.scans} scan${g.scans === 1 ? '' : 's'}` : ''}` : `${g.scans} scan${g.scans === 1 ? '' : 's'}, no talk`}${g.coins.length ? ` · ${g.coins.map((c) => `${esc(c.name)} ×${c.n}`).join(', ')}` : ''}</span>${takes[g.code] ? ' ' + esc(takes[g.code]) : ''}</li>`).join('');
    body += `<div class="row between wrap"><b>Digest of the last ${Digest.windowLabel(st.minutes)}</b><span class="row gap">${s ? `<span class="flow-label ${moodCls[s.mood]}">${esc(s.mood)}</span>` : ''}<span class="muted small">run ${digestWhen(st.at)}</span></span></div>
      ${!d.talk ? '<p class="small">Nobody talked in on chain feed in this window.</p>' : s ? `<p class="small">${esc(s.summary)}</p>${s.narratives.length ? `<p class="small"><b>Narratives:</b> ${s.narratives.map(esc).join(' · ')}</p>` : ''}` : `<p class="muted small">${state.settings.anthropicKey ? 'No read from Claude this time.' : 'Add an Anthropic API key (Settings) for Claude\'s read. The tables below are free.'}</p>`}
      ${s && s.coins.length ? `<p class="small"><b>Coins the chats are on:</b></p><ul class="small digest-list">${s.coins.map((c) => `<li><b>${esc(c.name)}</b> ${esc(c.why)}</li>`).join('')}</ul>` : ''}
      ${s && s.redFlags.length ? `<p class="small neg"><b>Red flags mentioned:</b> ${s.redFlags.map(esc).join(' · ')}</p>` : ''}
      ${d.coins.length ? `<p class="small"><b>Coins by how many chats named them</b> <span class="muted">(${d.coinsTotal} in all)</span></p><div class="table-wrap"><table class="digest-table"><thead><tr><th>Coin</th><th>Chats</th><th class="num">Mentions</th><th class="num hide-m">People</th><th class="hide-m">First</th><th>Last</th><th></th></tr></thead><tbody>${coinRows}</tbody></table></div>` : ''}
      <p class="small"><b>By chat</b></p><ul class="chat-groups small">${groupRows}</ul>
      ${d.topPosters.length ? `<p class="muted small">Most active: ${d.topPosters.map((p) => `${esc(p.who)} (${p.n})`).join(', ')}</p>` : ''}
      <p class="muted small">${d.talk} messages and ${d.scans} scans from ${d.groups.length} chat${d.groups.length === 1 ? '' : 's'}${st.capped ? `; the feed was busier than the Worker reads in one go, so this digest reaches back ${digestWhen(st.reachedAt)}, not the full ${Digest.windowLabel(st.minutes)}` : ''}${s ? ' · read by Claude Haiku' : ''}. Chat is opinion, not proof: the loudest chat can be the one selling.</p>`;
  } else if (!d && !st.loading && digestAvailable()) {
    body += `<p class="muted small">Reads the whole on chain feed for the window, sorts it by chat, lists the coins by how many chats named them, and has Claude Haiku sum up the narratives, each chat and the red flags. Under a cent to a few cents a run with your Anthropic key; the tables are free.</p>`;
  }
  el.innerHTML = chips + body;
  const sum = $('#digestSummary');
  if (sum) sum.textContent = d && st.at ? `last ${Digest.windowLabel(st.minutes)}${s ? ' · ' + s.mood : ''} · ${d.talk} msgs · run ${digestWhen(st.at)}` : '';
}

document.addEventListener('click', async (e) => {
  const w = e.target.closest('[data-digest-minutes]');
  if (w) { digestState.minutes = Number(w.dataset.digestMinutes); digestSave(); renderDigest(); return; }
  if (e.target.closest('#digestRun')) { runDigest(); return; }
  const ck = e.target.closest('[data-digest-check]');
  if (ck) { await runCheck(ck.dataset.digestCheck); setTimeout(() => window.scrollTo({ top: $('#checkForm').offsetTop - 70, behavior: 'smooth' }), 50); return; }
  const add = e.target.closest('[data-digest-add]');
  if (add && typeof addCalls === 'function') {
    const c = (digestState.d && digestState.d.coins.find((x) => x.address === add.dataset.digestAdd)) || {};
    addCalls([{ address: add.dataset.digestAdd, chain: c.chain === 'evm' ? 'evm' : 'solana', poster: 'digest', at: c.firstAt || Date.now(), messageId: 'digest:' + add.dataset.digestAdd, channel: 'on chain feed', symbol: c.ticker || '' }], 'digest');
    add.textContent = 'Added'; add.disabled = true;
    if (typeof showTab === 'function') showTab('calls');
    if (typeof showPane === 'function') showPane('queue');
  }
});
renderDigest();
