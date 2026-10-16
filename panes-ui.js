/* global store, $ */
'use strict';
// Calls tab panes (docs/features/calls-panes.md): the five sections (Queue, Digest, Graduations, Wallet, Scanner) show
// one at a time, picked from a sticky row of chips; each chip carries its section's status line. The choice is remembered.

const PANES = ['queue', 'digest', 'grad', 'wallet', 'scanner'];
const paneState = { pane: PANES.includes(store.get('callsPane', 'queue')) ? store.get('callsPane', 'queue') : 'queue' };

function showPane(name) {
  if (!PANES.includes(name)) return;
  paneState.pane = name;
  store.set('callsPane', name);
  document.querySelectorAll('#callsPanes button').forEach((b) => b.classList.toggle('active', b.dataset.pane === name));
  document.querySelectorAll('details.pane-section').forEach((d) => {
    const on = d.dataset.pane === name;
    d.classList.toggle('pane-on', on);
    if (on && !d.open) d.open = true; // the summary is hidden in pane mode, so the pane must be open to show anything
  });
  setTimeout(() => window.dispatchEvent(new Event('resize')), 0); // charts in the pane measure their new size
}

// Each section's status line (the text next to its title) is mirrored under its chip whenever it changes.
function paneSubsSync() {
  document.querySelectorAll('#callsPanes [data-pane-sub]').forEach((el) => {
    const src = $('#' + el.dataset.paneSub);
    const t = src ? src.textContent.trim() : '';
    if (el.textContent !== t) el.textContent = t;
  });
}
// The chips stick under the top bar: its height is measured so the two never overlap.
function paneTopSync() {
  const top = $('.top');
  document.documentElement.style.setProperty('--top-h', top ? top.offsetHeight + 'px' : '0px');
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('#callsPanes [data-pane]');
  if (b) showPane(b.dataset.pane);
});
window.addEventListener('resize', paneTopSync);
if ($('#callsPanes')) {
  showPane(paneState.pane);
  paneSubsSync();
  paneTopSync();
  const mo = new MutationObserver(paneSubsSync);
  document.querySelectorAll('#callsPanes [data-pane-sub]').forEach((el) => { const src = $('#' + el.dataset.paneSub); if (src) mo.observe(src, { childList: true, characterData: true, subtree: true }); });
}
