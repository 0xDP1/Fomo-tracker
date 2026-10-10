// Runs every browser test (tests/e2e/*.e2e.js) against a local copy of the app. Needs Playwright:
//   npm i --no-save playwright        (once; nothing is added to the repo)
//   node tests/e2e/run.js [name ...]  (all tests, or only the ones named, e.g. calls alerts)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const H = require('./helpers');

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, H.BASE).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(H.ROOT, rel);
  if (!file.startsWith(H.ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const only = process.argv.slice(2);
const tests = fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.js')).filter((f) => !only.length || only.includes(f.replace('.e2e.js', ''))).sort();

function runOne(f) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, f)], { env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ f, ok: code === 0, out, s: ((Date.now() - t0) / 1000).toFixed(1) }); });
  });
}

server.listen(H.PORT, async () => {
  let failed = 0;
  for (const f of tests) {
    const r = await runOne(f);
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${f}  (${r.s}s)`);
    if (!r.ok) { failed++; console.log(r.out.split('\n').slice(-25).join('\n')); }
  }
  server.close();
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
