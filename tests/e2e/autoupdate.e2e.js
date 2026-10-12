const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Automatic updates: a newer published version installs itself on open (with an "Updated to" note); typing, a running
// check or an AI request in flight shows the update bar instead; a phone that keeps serving the old files gets one try,
// then the bar; the check while you're on screen only offers the bar.
const CUR = Number(/APP_VERSION = (\d+)/.exec(require('fs').readFileSync(require('path').join(__dirname, '../../app.js'), 'utf8'))[1]);
const NEW = CUR + 1;
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  // served: the version.json number; serveNew: after a reload into ?v=NEW the phone gets the new app.js (false: stuck cache)
  const open = async ({ served, serveNew }) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const st = { served, serveNew, reloaded: false, loads: [], errs: [] };
    p.on('pageerror', (e) => st.errs.push(e.message));
    p.on('load', () => st.loads.push(p.url()));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!cdnjs|api\.anthropic)/, (r) => r.abort());
    await p.route('https://api.anthropic.com/**', () => {}); // never answers: an AI request in flight
    await p.route('**/version.json*', (r) => r.fulfill({ json: { version: st.served } }));
    // the page reloaded into ?v=NEW: from then on (when the phone gets the new files) app.js is the new build
    await p.route('**/index.html*', (r) => { if (r.request().url().includes(`v=${NEW}`)) st.reloaded = true; r.continue(); });
    await p.route('**/app.js*', async (r) => {
      const res = await r.fetch();
      const body = st.serveNew && st.reloaded ? (await res.text()).replace(`APP_VERSION = ${CUR};`, `APP_VERSION = ${NEW};`) : await res.text();
      r.fulfill({ response: res, body });
    });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); sessionStorage.setItem('i', 1); });
    await p.goto(E2E.BASE + '/index.html');
    return { p, st, ctx };
  };
  const bar = (p) => p.$eval('#updateBar', (e) => (e.hidden ? '' : e.innerText.replace(/\s+/g, ' ').trim()));

  // 1. on open: installs by itself, then says so
  let { p, st, ctx } = await open({ served: NEW, serveNew: true });
  await p.waitForFunction((v) => document.querySelector('#appVersion')?.textContent === 'version ' + v, NEW, { timeout: 8000 });
  assert.match(p.url(), new RegExp(`[?&]v=${NEW}`));
  assert.equal(await p.$eval('#updatedNote', (e) => e.textContent), `Updated to v${NEW}`);
  assert.equal(await bar(p), '', 'no bar after an automatic update');
  await p.screenshot({ path: E2E.OUT + '/autoupdate-note.png' });
  assert.deepEqual(st.errs, []);
  await ctx.close();

  // 2. something in progress: the bar instead, no reload
  ({ p, st, ctx } = await open({ served: CUR, serveNew: true }));
  await p.waitForTimeout(500);
  st.served = NEW;
  const loads = st.loads.length;
  await p.focus('#caInput');
  await p.evaluate(() => checkForUpdate('auto'));
  assert.match(await bar(p), /A new version of the app is available\. Update now/, 'typing: the bar');
  await p.evaluate(() => { document.activeElement.blur(); $('#updateBar').hidden = true; checkState.running = true; });
  await p.evaluate(() => checkForUpdate('auto'));
  assert.match(await bar(p), /Update now/, 'a check running: the bar');
  await p.evaluate(() => { $('#updateBar').hidden = true; checkState.running = false; fetch('https://api.anthropic.com/v1/messages', { method: 'POST' }).catch(() => {}); });
  await p.evaluate(() => checkForUpdate('auto'));
  assert.match(await bar(p), /Update now/, 'an AI request in flight: the bar');
  // 3. the check while you're on screen only offers the bar
  await p.evaluate(() => { $('#updateBar').hidden = true; });
  await p.evaluate(() => checkForUpdate('bar'));
  assert.match(await bar(p), /Update now/);
  await p.waitForTimeout(300);
  assert.equal(st.loads.length, loads, 'never reloaded');
  // the bar's button still installs it
  await p.click('#updateBtn');
  await p.waitForFunction((v) => document.querySelector('#appVersion')?.textContent === 'version ' + v, NEW, { timeout: 8000 });
  assert.deepEqual(st.errs, []);
  await ctx.close();

  // 4. the phone keeps serving the old files: one try, then the bar with Try again
  ({ p, st, ctx } = await open({ served: NEW, serveNew: false }));
  await p.waitForFunction(() => document.querySelector('#updateBar')?.hidden === false, null, { timeout: 8000 });
  assert.match(await bar(p), /didn't load on its own .* Try again/);
  await p.waitForTimeout(500);
  assert.equal(st.loads.length, 2, 'loaded once, reloaded once, no loop: ' + st.loads.join(' '));
  assert.equal(await p.$('#updatedNote'), null);
  await p.screenshot({ path: E2E.OUT + '/autoupdate-stuck.png' });
  assert.deepEqual(st.errs, []);
  await ctx.close();

  await b.close();
  console.log('AUTO UPDATE E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
