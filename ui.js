/* global store */
'use strict';
// Collapsible sections (<details data-key>) remember whether you left them open.
(function () {
  const saved = () => store.get('uiOpen', {});
  document.querySelectorAll('details[data-key]').forEach((d) => {
    const s = saved();
    if (d.dataset.key in s) d.open = !!s[d.dataset.key];
  });
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.key) return;
    const s = saved(); s[d.dataset.key] = d.open; store.set('uiOpen', s);
    // Charts inside a section that just opened need to measure their new size.
    if (d.open) setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
  }, true);
})();
