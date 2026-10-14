/* global KeyFile, state, store, applySettings, download, $ */
'use strict';
// Settings → Data: export the API keys to a password-protected file and import them on another device
// (docs/features/key-file.md). The password boxes are in the card, never a prompt that shows the password.

const keysState = { file: null };
const keysNote = (text, bad) => { const n = $('#keysNote'); n.textContent = text; n.className = 'small ' + (bad ? 'neg' : 'pos'); };
const keysPanel = (html) => { const p = $('#keysPanel'); p.innerHTML = html; p.hidden = !html; };

$('#keysExportBtn').onclick = () => {
  const keys = KeyFile.pick(state.settings);
  if (!Object.keys(keys).length) { keysPanel(''); return keysNote('There are no keys in Settings to export.', true); }
  keysNote('', false);
  keysPanel(`<p class="small">Choose a password for the file (${Object.keys(keys).length} key${Object.keys(keys).length === 1 ? '' : 's'}). You'll need it to import them; there is no way to recover it.</p>
    <div class="row gap wrap"><input id="keysPass1" type="password" placeholder="Password (8+ characters)" autocomplete="new-password" /><input id="keysPass2" type="password" placeholder="Same password again" autocomplete="new-password" /><button type="button" class="btn primary" id="keysExportGo">Export</button></div>`);
};

$('#keysImportFile').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { keysState.file = JSON.parse(await f.text()); } catch { keysState.file = null; keysPanel(''); return keysNote('That file is not a Fomo Tracker key file.', true); }
  keysNote('', false);
  keysPanel(`<p class="small">Type the password this key file was exported with.</p>
    <div class="row gap wrap"><input id="keysImportPass" type="password" placeholder="Password" autocomplete="current-password" /><button type="button" class="btn primary" id="keysImportGo">Import</button></div>`);
};

document.addEventListener('click', async (e) => {
  if (e.target.closest('#keysExportGo')) {
    const a = $('#keysPass1').value, b = $('#keysPass2').value;
    const bad = KeyFile.checkPassword(a, b);
    if (bad) return keysNote(bad, true);
    keysNote('Locking…', false);
    try {
      const file = await KeyFile.lock(KeyFile.pick(state.settings), a);
      download('fomo-tracker-keys.json', JSON.stringify(file, null, 2), 'application/json');
      keysPanel('');
      keysNote('Keys exported to fomo-tracker-keys.json, locked with your password. Import it on your other device with the same password.', false);
    } catch (err) { keysNote('Could not export: ' + err.message, true); }
  }
  if (e.target.closest('#keysImportGo')) {
    keysNote('Unlocking…', false);
    try {
      const keys = await KeyFile.unlock(keysState.file, $('#keysImportPass').value);
      Object.assign(state.settings, keys);
      store.set('settings', state.settings);
      applySettings();
      keysState.file = null;
      keysPanel('');
      keysNote(`Keys imported: ${Object.keys(keys).length}. Reload the app if a feature doesn't pick them up.`, false);
    } catch (err) { keysNote(err.message.charAt(0).toUpperCase() + err.message.slice(1) + '. Nothing was changed.', true); }
  }
});
