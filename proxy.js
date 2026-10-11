/* global state, store, $, esc */
'use strict';
// Every service that needs an API key (fomoapi.io, Helius, Claude) is called through your Cloudflare Worker, which keeps
// the keys as secrets (worker/README.md). This app only holds the Worker's address and its feed key.

const workerBase = () => String(state.settings.feedUrl || '').trim().replace(/\/+$/, '');
const workerReady = () => !!(workerBase() && state.settings.feedKey);

// Which keys the Worker has, from GET /services. Remembered so the app knows at start-up, before the Worker answers.
let workerServices = null;
const knownServices = () => workerServices || (workerServices = store.get('workerServices', {}) || {});
const workerHas = (name) => workerReady() && !!knownServices()[name];
const heliusOn = () => workerHas('helius');
const fomoOn = () => workerHas('fomo');
const claudeOn = () => workerHas('claude');

function workerMessage(status, j) {
  if (status === 401) return 'The Worker rejected the feed key (Settings).';
  if (j.error === 'not_configured') return `Add ${j.secret || 'the key'} to the Worker in Cloudflare (worker/README.md).`;
  if (j.error === 'rate_limited') return 'Too many calls through the Worker this minute. Try again shortly.';
  if (status === 404) return 'The Worker is an older version without this. Update it in Cloudflare (worker/README.md).';
  return 'The Worker refused the request: ' + (j.error || 'HTTP ' + status);
}

// The Worker's own refusals (feed key, missing secret, too many calls) are thrown with a plain message;
// the service's own answers (including its errors) come back as the Response, as before.
async function workerFetch(path, opts = {}) {
  if (!workerReady()) { const e = new Error('Set up your Worker in Settings (URL and feed key).'); e.proxy = true; throw e; }
  let r;
  try { r = await fetch(workerBase() + path, Object.assign({ cache: 'no-store' }, opts, { headers: Object.assign({ 'x-feed-key': state.settings.feedKey }, opts.headers) })); }
  catch { const e = new Error('Can\'t reach the Worker (network).'); e.proxy = true; e.status = 'blocked'; throw e; }
  if (r.headers.get('x-proxy-error')) {
    const j = await r.json().catch(() => ({}));
    if (j.error === 'not_configured' && j.service && knownServices()[j.service]) { workerServices = Object.assign({}, knownServices(), { [j.service]: false }); store.set('workerServices', workerServices); }
    const e = new Error(workerMessage(r.status, j)); e.proxy = true; e.status = r.status; throw e;
  }
  return r;
}

async function refreshServices() {
  if (!workerReady()) { renderWorkerStatus(); return null; }
  let err = '';
  try {
    const r = await workerFetch('/services');
    if (r.ok) { workerServices = await r.json(); store.set('workerServices', workerServices); }
    else err = 'HTTP ' + r.status;
  } catch (e) { err = e.message; }
  renderWorkerStatus(err);
  return err ? null : workerServices;
}

const SERVICE_NAMES = [['fomo', 'FOMO (fomoapi.io)', 'FOMO_API_KEY'], ['helius', 'Helius', 'HELIUS_API_KEY'], ['claude', 'Claude', 'ANTHROPIC_API_KEY'], ['gmgn', 'GMGN', 'GMGN_API_KEY'], ['chatter', 'Chat search', 'CHATTER_CHANNEL']];
function renderWorkerStatus(err) {
  const el = typeof $ === 'function' && $('#workerStatus');
  if (!el) return;
  if (!workerReady()) { el.innerHTML = 'Worker: not set up. FOMO, Helius and Claude features need it.'; return; }
  const s = knownServices();
  el.innerHTML = 'Worker: ' + SERVICE_NAMES.map(([k, label, secret]) => (s[k] ? `<span class="pos">${label} ✓</span>` : `<span class="muted" title="add ${secret} to the Worker">${label}: off</span>`)).join(' · ')
    + (err ? ` <span class="neg">${esc(err)}</span>` : '');
}

// ---- the calls ----
const heliusRpcFetch = (body) => workerFetch('/helius/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
// A wallet's or coin's parsed transactions, newest first. opts: { before, type }
const heliusTxFetch = (addr, opts = {}) => workerFetch('/helius/tx/' + encodeURIComponent(addr) + '?' + new URLSearchParams(Object.assign({}, opts.type ? { type: opts.type } : {}, { limit: '100' }, opts.before ? { before: opts.before } : {})));
// fomoapi.io: path is '' or '/balances', '/trades', '/positions'.
const fomoFetch = (handle, path, params) => {
  const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null && v !== ''));
  return workerFetch('/fomo/users/' + encodeURIComponent(handle) + path + (qs.toString() ? '?' + qs : ''));
};
// Claude Messages API. body: the same object the API takes.
const claudeFetch = (body) => workerFetch('/claude/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Jupiter needs no key: through the Worker (30 s cache) when there is one, else straight from Jupiter.
async function jupFetch(kind, mints) {
  const list = mints.join(',');
  if (workerReady()) {
    try { return await workerFetch(kind === 'price' ? '/jup/price?ids=' + list : '/jup/tokens?query=' + list); }
    catch (e) { if (!e.proxy) throw e; /* an older Worker: ask Jupiter directly */ }
  }
  return fetch(kind === 'price' ? 'https://lite-api.jup.ag/price/v3?ids=' + list : 'https://lite-api.jup.ag/tokens/v2/search?query=' + list);
}
