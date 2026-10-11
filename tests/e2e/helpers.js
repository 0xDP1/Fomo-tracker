// Shared setup for the browser tests: paths, the local server address, the Chromium to launch, and Chart.js.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT) || 8765;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, 'out');
const FIX = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

// Use a preinstalled Chromium when there is one (PW_CHROMIUM or /opt/pw-browsers/chromium), else Playwright's own.
function launchOpts() {
  const p = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  return fs.existsSync(p) ? { executablePath: p } : {};
}

// The app loads Chart.js from a CDN; tests serve a local copy when installed, else a stub so pages still run.
const STUB = "(function(){var d=new Proxy(function(){},{get:function(t,k){return k===Symbol.toPrimitive?function(){return ''}:d},set:function(){return true}});" +
  "window.Chart=function(){return{destroy:function(){},update:function(){},resize:function(){},data:{labels:[],datasets:[]},options:d}};window.Chart.defaults=d;window.Chart.register=function(){};})();";
function chartBody() {
  try { return { path: path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js') }; } catch { return { body: STUB }; }
}

// The same as tapping "Open all" on the Check tab, plus the Plan & watch section, so tests can read and tap every block.
// Register it after the test's own init script (which clears storage).
const openFolds = (page) => page.addInitScript(() => {
  localStorage.setItem('ft_foldOpen', JSON.stringify({ all: true }));
  let ui = {}; try { ui = JSON.parse(localStorage.getItem('ft_uiOpen') || '{}') || {}; } catch { /* fresh */ }
  if (!('check-plan' in ui)) { ui['check-plan'] = true; localStorage.setItem('ft_uiOpen', JSON.stringify(ui)); }
});

// The app reaches Helius, fomoapi.io, Claude and Jupiter only through the user's Worker (keys are Worker secrets).
// mockWorker answers the Worker's routes and hands each call to the mock a test would write for the service itself:
// the handler gets an object like a Playwright route whose request().url() is the service's own address.
const WORKER = 'https://worker.test';
const SERVICES = { helius: true, fomo: true, claude: true, gmgn: false, chatter: false, jupiter: true };
// Settings and remembered services to put in localStorage (ft_settings, ft_workerServices) so the app starts set up.
const workerSettings = (base = WORKER) => ({ feedUrl: base, feedKey: 'k3y' });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'x-credits-remaining, x-proxy-error' };

function asService(route, upstream) {
  const req = route.request();
  return {
    request: () => ({ url: () => upstream, method: () => req.method(), headers: () => req.headers(), postData: () => req.postData(), postDataJSON: () => req.postDataJSON() }),
    fulfill: (o) => route.fulfill(Object.assign({}, o, { headers: Object.assign({}, CORS, o.headers) })),
    abort: () => route.abort(),
  };
}

// h: { base, services (null: an older Worker without /services), helius (tx reads), heliusRpc, fomo, claude, jup, other (any other Worker route, e.g. /calls) }
async function mockWorker(page, h = {}) {
  const base = h.base || WORKER;
  const services = () => (typeof h.services === 'function' ? h.services() : h.services === undefined ? SERVICES : h.services);
  const refuse = (route, status, json) => route.fulfill({ status, json, headers: Object.assign({ 'x-proxy-error': '1' }, CORS) });
  await page.route(base + '/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const svc = p.startsWith('/helius/') ? ['helius', 'HELIUS_API_KEY'] : p.startsWith('/fomo/') ? ['fomo', 'FOMO_API_KEY'] : p === '/claude/messages' ? ['claude', 'ANTHROPIC_API_KEY'] : null;
    if (p === '/services') return services() ? route.fulfill({ json: services(), headers: CORS }) : refuse(route, 404, { error: 'not_found' });
    if (svc && services() && !services()[svc[0]]) return refuse(route, 503, { error: 'not_configured', service: svc[0], secret: svc[1] });
    if (p === '/helius/rpc' && h.heliusRpc) return h.heliusRpc(asService(route, 'https://mainnet.helius-rpc.com/'));
    if (p.startsWith('/helius/tx/') && h.helius) return h.helius(asService(route, `https://api.helius.xyz/v0/addresses/${p.split('/')[3]}/transactions?${u.searchParams}`));
    if (p.startsWith('/fomo/') && h.fomo) return h.fomo(asService(route, 'https://api.fomoapi.io/v2' + p.slice('/fomo'.length) + u.search));
    if (p === '/claude/messages' && h.claude) return h.claude(asService(route, 'https://api.anthropic.com/v1/messages'));
    if (p.startsWith('/jup/') && h.jup) return h.jup(asService(route, p === '/jup/price' ? 'https://lite-api.jup.ag/price/v3' + u.search : 'https://lite-api.jup.ag/tokens/v2/search' + u.search));
    if (h.other) return h.other(route);
    return refuse(route, 404, { error: 'not_found' });
  });
}

module.exports = { ROOT, PORT, BASE, OUT, FIX, launchOpts, chartBody, openFolds, WORKER, SERVICES, workerSettings, mockWorker };
