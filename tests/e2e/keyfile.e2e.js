// docs/features/key-file.md: export the keys with a password on one device, import them on a fresh one; a wrong
// password changes nothing.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const KEYS = { feedKey: 'feed-secret-123', anthropicKey: 'sk-ant-test-abc', heliusKey: 'helius-xyz', lookupKey: 'fapi_123', gmgnKey: 'gmgn-777' };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const errs = [];
  const open = async (seed) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\//, (r) => r.abort());
    await p.addInitScript((s) => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'settings'); if (s) localStorage.setItem('ft_settings', JSON.stringify(s)); sessionStorage.setItem('i', 1); }, seed);
    await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
    return p;
  };
  // device 1: export
  const p1 = await open(Object.assign({ feedUrl: 'https://feed.example.workers.dev', refreshSec: 60 }, KEYS));
  await p1.click('#keysExportBtn');
  await p1.fill('#keysPass1', 'short'); await p1.fill('#keysPass2', 'short'); await p1.click('#keysExportGo');
  assert.match(await p1.textContent('#keysNote'), /at least 8 characters/);
  await p1.fill('#keysPass1', 'correct horse'); await p1.fill('#keysPass2', 'correct horse');
  const [dl] = await Promise.all([p1.waitForEvent('download'), p1.click('#keysExportGo')]);
  assert.equal(dl.suggestedFilename(), 'fomo-tracker-keys.json');
  const file = path.join(E2E.OUT, 'keys-test.json');
  await dl.saveAs(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const v of Object.values(KEYS)) assert.ok(!text.includes(v), 'key readable in the file');
  assert.equal(JSON.parse(text).kind, 'keys');
  assert.match(await p1.textContent('#keysNote'), /Keys exported/);
  // device 2: a fresh browser with only a refresh setting
  const p2 = await open({ refreshSec: 30 });
  await p2.setInputFiles('#keysImportFile', file);
  await p2.fill('#keysImportPass', 'wrong horse'); await p2.click('#keysImportGo');
  await p2.waitForFunction(() => /wrong password or damaged file/i.test(document.querySelector('#keysNote').textContent), null, { timeout: 15000 });
  assert.deepEqual(await p2.evaluate(() => [state.settings.feedKey || '', state.settings.anthropicKey || '']), ['', ''], 'nothing changed');
  await p2.fill('#keysImportPass', 'correct horse'); await p2.click('#keysImportGo');
  await p2.waitForFunction(() => /Keys imported/.test(document.querySelector('#keysNote').textContent), null, { timeout: 15000 });
  const got = await p2.evaluate(() => { const s = JSON.parse(localStorage.getItem('ft_settings')); return [s.feedKey, s.anthropicKey, s.heliusKey, s.lookupKey, s.gmgnKey, s.refreshSec]; });
  assert.deepEqual(got, [...Object.values(KEYS), 30], 'every key back; other settings kept');
  assert.equal(await p2.inputValue('#settingsForm [name=anthropicKey]'), KEYS.anthropicKey, 'shown in the form');
  assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  fs.unlinkSync(file);
  assert.deepEqual(errs, []);
  await b.close();
  console.log('KEY FILE E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
