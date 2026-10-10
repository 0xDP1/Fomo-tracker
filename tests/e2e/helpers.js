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

module.exports = { ROOT, PORT, BASE, OUT, FIX, launchOpts, chartBody };
