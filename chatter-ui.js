/* global Chatter, state, store, checkState, renderCheck, runCheck, esc, $ */
'use strict';
// "What people are saying" (Check tab): on tap, the Discord feed Worker searches the on chain feed channel for the coin
// (address and $ticker, last 24 hours), the messages are sorted by group code, and Claude Haiku summarises them with your
// Anthropic key. Nothing runs until tapped; a coin's result is reused for 15 minutes.

const CHAT_TTL = 15 * 60000;
const CHAT_MODEL = 'claude-haiku-5-5'; // the cheapest current model; summarising chat does not need more
const chatState = {}; // address -> { loading } | { error } | { prep, summary, total, at }
const chatterAvailable = () => !!(state.settings.feedUrl && state.settings.feedKey);

async function fetchChatter(ca, sym) {
  const { feedUrl, feedKey } = state.settings;
  let r;
  try { r = await fetch(feedUrl.replace(/\/+$/, '') + '/chatter?' + new URLSearchParams({ ca, sym: sym || '' }), { headers: { 'x-feed-key': feedKey }, cache: 'no-store' }); } catch { throw new Error('Can\'t reach the Worker.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('The Worker rejected the feed key.');
  if (r.status === 404) throw new Error('The Worker is an older version without chatter search. Update it in Cloudflare.');
  if (j.error === 'not_configured') throw new Error('Add CHATTER_CHANNEL (the on chain feed channel ID) to the Worker in Cloudflare.');
  if (j.error === 'indexing') throw new Error('Discord is still indexing that channel. Try again in a few seconds.');
  if (!r.ok) throw new Error('Chatter search failed: ' + (j.error || 'HTTP ' + r.status));
  return j;
}

async function summarise(symbol, prep) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': state.settings.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model: CHAT_MODEL, max_tokens: 2000, system: Chatter.SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: Chatter.SCHEMA } },
      messages: [{ role: 'user', content: Chatter.prompt(symbol, prep) }],
    }),
  });
  if (r.status === 401) throw new Error('Anthropic rejected the API key.');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Anthropic HTTP ${r.status}`);
  if (j.stop_reason === 'refusal') throw new Error('Claude declined to summarise this chat.');
  const s = Chatter.readSummary((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
  if (!s) throw new Error('The summary came back unreadable. Try again.');
  return s;
}

// v115: the window shown (5m, 30m, 1h, 2h, 24h), remembered. The Worker's read is always 24 hours; the device filters.
let chatWindow = String(store.get('chatWindow', '24h') || '24h');
if (!Chatter.WINDOWS.some((w) => w.key === chatWindow)) chatWindow = '24h';

// Counts and, with a key, the Haiku summary for one window of a coin's read; summaries are cached per coin and window.
async function summariseWindow(ca, key) {
  const c = chatState[ca];
  if (!c || !c.found) return;
  const found = c.found, sym = found.sym;
  const msgs = Chatter.within(found.messages || [], key);
  // Discord's own total can only be compared with the whole read, so the "counts N in all" note shows on 24h only.
  const prep = Chatter.prepare(msgs, { ca, sym, total: key === '24h' ? found.total : 0 });
  c.windows = c.windows || {};
  let w = c.windows[key];
  if (!w) { w = c.windows[key] = { prep, summary: null, done: false }; }
  const show = () => { c.prep = w.prep; c.summary = w.summary; c.window = key; if (checkState.ca === ca) renderCheck(); };
  if (w.done) { show(); return; }
  w.prep = prep;
  if (prep.talk && state.settings.anthropicKey) {
    c.loading = `Summarising ${prep.talk} messages…`; c.prep = prep; c.summary = null; c.window = key;
    if (checkState.ca === ca) renderCheck();
    try { w.summary = await summarise(sym || found.name, prep); }
    catch (e) { c.loading = ''; c.error = e.message; if (checkState.ca === ca) renderCheck(); return; }
  }
  w.done = true; c.loading = ''; c.error = '';
  show();
}

async function askChatter(force) {
  const ca = checkState.ca, dex = checkState.dex;
  if (!ca || !dex || !chatterAvailable()) return;
  const saved = chatState[ca];
  if (!force && saved && saved.found && saved.at && Date.now() - saved.at < CHAT_TTL) {
    if (saved.window !== chatWindow || !saved.prep) await summariseWindow(ca, chatWindow);
    return;
  }
  chatState[ca] = { loading: 'Searching on chain feed…' };
  renderCheck();
  try {
    const sym = dex.symbol && dex.symbol !== '?' ? dex.symbol : '';
    const found = await fetchChatter(ca, sym);
    chatState[ca] = { found: { messages: found.messages || [], total: found.total || 0, sym, name: dex.name }, total: found.total || 0, at: Date.now(), windows: {}, loading: '' };
  } catch (e) {
    chatState[ca] = { error: e.message };
    if (checkState.ca === ca) renderCheck();
    return;
  }
  await summariseWindow(ca, chatWindow);
}

function chatterBlock() {
  if (!checkState.dex || !chatterAvailable()) return '';
  const c = chatState[checkState.ca];
  const head = '<div class="flow-block chat-block"><div class="row between wrap"><b>What people are saying</b>';
  // v115: the window chips; the read covers 24 hours, the chips cut it on the device. v116: shown before the read too,
  // so the first summary covers only the window you picked (a 30-minute pick never pays for the whole day).
  const chips = `<div class="tag-chips chat-windows">${Chatter.WINDOWS.map((w) => `<button type="button" class="${w.key === chatWindow ? 'on' : ''}" data-chat-window="${w.key}">${w.chip}</button>`).join('')}</div>`;
  if (!c) return head + `<button type="button" class="btn mini" id="chatBtn">Read the chat</button></div>${chips}<p class="muted small">Searches on chain feed for this coin (last 24 hours), keeps the ${esc(Chatter.windowOf(chatWindow).label)}, sorts it by group and has Claude Haiku sum it up. Pick the window first: the summary covers only that window, so a short one costs less. About 0.2¢ a tap with your Anthropic key.</p></div>`;
  if (c.loading) return head + `</div>${chips}<p class="muted small">${esc(c.loading)}</p></div>`;
  if (c.error) return head + `<button type="button" class="btn mini" id="chatBtn" data-force="1">Retry</button></div>${chips}<p class="neg small">${esc(c.error)}</p></div>`;
  const { prep, summary: s } = c;
  if (!prep) return head + `</div>${chips}</div>`;
  const label = Chatter.windowOf(chatWindow).label;
  const refresh = '<button type="button" class="btn mini" id="chatBtn" data-force="1">Refresh</button>';
  const dayNote = chatWindow !== '24h' && c.found ? (() => { const all = Chatter.prepare(c.found.messages, { ca: checkState.ca, sym: c.found.sym, total: c.found.total }); return all.talk ? ` (${all.talk} message${all.talk === 1 ? '' : 's'} in the last 24 hours)` : ''; })() : '';
  if (!prep.talk) return head + refresh + `</div>${chips}<p class="small">Nobody talked about it in on chain feed in the ${label}${dayNote}${prep.scans ? `; it was scanned ${prep.scans} time${prep.scans === 1 ? '' : 's'} in ${prep.groups.length} group${prep.groups.length === 1 ? '' : 's'}` : ''}.</p></div>`;
  const moodCls = { bullish: 'pos', bearish: 'neg', mixed: 'warn-text', quiet: 'muted' };
  const takes = {};
  if (s) for (const g of s.groups) takes[g.code] = g.take;
  const rows = prep.groups.map((g) => `<li><b>[${esc(g.code)}]</b> <span class="muted small">${g.messages ? `${g.mentions ? `${g.mentions} mention${g.mentions === 1 ? '' : 's'} · ` : ''}${g.people.length} ${g.people.length === 1 ? 'person' : 'people'} · ${g.messages} msg${g.messages === 1 ? '' : 's'}${g.scans ? ` · ${g.scans} scan${g.scans === 1 ? '' : 's'}` : ''}` : `${g.scans} scan${g.scans === 1 ? '' : 's'}, no talk`}</span>${takes[g.code] ? ' ' + esc(takes[g.code]) : ''}</li>`).join('');
  return head + `<span class="row gap">${s ? `<span class="flow-label ${moodCls[s.mood]}">${esc(s.mood)}</span>` : ''}${refresh}</span></div>${chips}
    ${Chatter.mentionLine(prep) ? `<p class="small"><b>${esc(Chatter.mentionLine(prep))}</b>, ${label}.</p>` : ''}
    ${s ? `<p class="small">${esc(s.summary)}</p>` : `<p class="muted small">Add an Anthropic API key (Settings) to get the summary. The counts below are free.</p>`}
    <ul class="chat-groups small">${rows}</ul>
    ${s && s.claims.length ? `<p class="small"><b>Claims:</b> ${s.claims.map(esc).join(' · ')}</p>` : ''}
    ${s && s.redFlags.length ? `<p class="small neg"><b>Red flags mentioned:</b> ${s.redFlags.map(esc).join(' · ')}</p>` : ''}
    ${prep.topPosters.length ? `<p class="muted small">Most active: ${prep.topPosters.map((p) => `${esc(p.who)} (${p.n})`).join(', ')}</p>` : ''}
    <p class="muted small">${prep.talk} messages and ${prep.scans} scans from on chain feed, ${label}${dayNote} (messages next to a hit come along, so they can outnumber the mentions)${s ? ' · summarised by Claude Haiku' : ''}. Chat is opinion, not proof: the loudest group can be the one selling.</p></div>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('#chatBtn');
  if (b) { askChatter(!!b.dataset.force); return; }
  const cw = e.target.closest('[data-chat-window]');
  if (cw) {
    chatWindow = cw.dataset.chatWindow; store.set('chatWindow', chatWindow);
    const c = chatState[checkState.ca];
    if (c && c.found) summariseWindow(checkState.ca, chatWindow); else renderCheck();
    return;
  }
  const q = e.target.closest('[data-call-chat]');
  if (q) {
    await runCheck(q.dataset.callChat);
    setTimeout(() => window.scrollTo({ top: $('#checkForm').offsetTop - 70, behavior: 'smooth' }), 50);
    askChatter(false);
  }
});
