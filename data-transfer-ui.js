import { DATA_IMPORT_KEY, MAX_BACKUP_BYTES, exportDataBackup, parseDataBackup, prepareDataImport, commitDataImport } from './data-transfer.js';

export function setupDataTransfer() {
  const dialog = document.createElement('dialog');
  dialog.id = 'data-dialog';
  dialog.setAttribute('aria-labelledby', 'data-title');
  // Static interface markup only; file names, plan titles and errors use textContent.
  dialog.innerHTML = `
    <h2 id="data-title" tabindex="-1">Export & import data</h2>
    <p>Share editable plans or keep a backup. No API key needed.</p>
    <div id="data-options">
      <section id="data-export-section" class="data-section" aria-labelledby="data-export-title">
        <h3 id="data-export-title">Export all data</h3>
        <p>Saved battle plans, player details, your formation, and saved rosters.</p>
        <a id="data-download" class="button secondary" download>Export data</a>
      </section>
      <section class="data-section" aria-labelledby="data-import-title">
        <h3 id="data-import-title">Import data</h3>
        <label for="data-file">BaseGrid data file</label>
        <input id="data-file" type="file" accept=".json,application/json" aria-describedby="data-file-help">
        <p id="data-file-help">Choose a .basegrid.json file to review before importing.</p>
      </section>
      <form id="data-import-form" hidden>
        <h3>Review import</h3>
        <p id="data-summary"></p>
        <ul id="data-plan-list" aria-label="Battle plans to import"></ul>
        <p id="data-merge-help">Existing plans and rosters are kept. Matching plan titles get “(imported)”.</p>
        <div id="data-formation-option" hidden>
          <label class="data-checkbox"><input id="data-formation" type="checkbox"><span id="data-formation-label">Load formation</span></label>
          <p>Includes player positions, obstacles, and placement progress.</p>
        </div>
      </form>
    </div>
    <p id="data-error" role="alert" hidden></p>
    <p id="data-status" role="status" aria-live="polite" hidden></p>
    <div class="data-footer">
      <button id="data-close" class="button secondary" type="button">Close</button>
      <button id="data-import-confirm" class="button primary" type="submit" form="data-import-form" hidden>Import data</button>
    </div>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#' + id);
  let exportUrl = null;
  let backup = null;
  let prepared = null;
  let imported = false;
  let reading = 0;
  const count = (number, noun) => `${number} ${noun}${number === 1 ? '' : 's'}`;
  function showReview(visible) {
    $('data-import-form').hidden = !visible;
    $('data-import-confirm').hidden = !visible;
    $('data-export-section').hidden = visible;
    $('data-file-help').hidden = visible;
  }
  function error(message = '') { $('data-error').textContent = message; $('data-error').hidden = !message; }
  function status(message = '', busy = false) {
    $('data-status').textContent = message; $('data-status').hidden = !message;
    $('data-status').classList.toggle('is-loading', busy);
  }
  function review() {
    prepared = prepareDataImport(window.localStorage, backup, { includeFormation: $('data-formation').checked });
    const summary = prepared.summary;
    $('data-summary').textContent = `${count(summary.plans.length, 'battle plan')} · ${count(summary.rostersAdded, 'saved roster')} to add` +
      (summary.searchesAdded ? ` · ${summary.searchesAdded} saved alliance ${summary.searchesAdded === 1 ? 'search' : 'searches'}` : '') +
      (summary.rostersKept ? ` · ${count(summary.rostersKept, 'roster')} already saved` : '');
    $('data-plan-list').replaceChildren(...summary.plans.map(plan => {
      const row = document.createElement('li');
      row.textContent = `${plan.title} · ${plan.event} · ${count(plan.players, 'player')}`; return row;
    }));
    $('data-plan-list').hidden = !summary.plans.length;
    $('data-formation-option').hidden = !summary.hasFormation;
    $('data-formation-label').textContent = summary.hasExistingFormation ? 'Replace my current formation' : 'Load the included formation';
    $('data-import-confirm').disabled = prepared.changes.size === 1;
    showReview(true);
  }
  document.getElementById('open-data').addEventListener('click', () => {
    reading++; backup = null; prepared = null; imported = false;
    error(); status();
    $('data-options').hidden = false; showReview(false);
    $('data-file').value = ''; $('data-formation').checked = false;
    $('data-close').textContent = 'Close';
    $('data-download').removeAttribute('href'); $('data-download').setAttribute('aria-disabled', 'true');
    try {
      const exported = exportDataBackup(window.localStorage);
      exportUrl = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
      $('data-download').href = exportUrl;
      $('data-download').download = 'basegrid-' + exported.exportedAt.slice(0, 10) + '.basegrid.json';
      $('data-download').removeAttribute('aria-disabled');
    } catch { error('Saved data could not be read. Export is unavailable; your existing data has been kept.'); }
    dialog.showModal(); $('data-title').focus();
  });
  $('data-download').addEventListener('click', event => {
    if (!exportUrl) { event.preventDefault(); return; }
    status('Share the downloaded file with another BaseGrid user. They can open it with Import data.');
  });
  $('data-file').addEventListener('change', async () => {
    const generation = ++reading;
    backup = null; prepared = null; error(); showReview(false);
    const file = $('data-file').files[0];
    if (!file) { status(); return; }
    status('Reading data file…', true);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Choose a data file smaller than 10 MB.');
      const text = await file.text();
      if (generation !== reading || !dialog.open) return;
      backup = parseDataBackup(text);
      const initial = prepareDataImport(window.localStorage, backup);
      $('data-formation').checked = initial.summary.hasFormation && !initial.summary.hasExistingFormation;
      review(); status();
    } catch (cause) {
      if (generation !== reading) return;
      backup = null; prepared = null; status(); error(cause.message || 'This data file could not be opened.');
    }
  });
  $('data-formation').addEventListener('change', () => {
    try { error(); review(); } catch (cause) { prepared = null; error(cause.message); $('data-import-confirm').disabled = true; }
  });
  $('data-import-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!prepared) return;
    try {
      const summary = commitDataImport(window.localStorage, prepared);
      imported = true; prepared = null;
      error(); $('data-options').hidden = true; $('data-import-confirm').hidden = true; $('data-close').textContent = 'Done';
      status(`Imported ${count(summary.plans.length, 'battle plan')} and ${count(summary.rostersAdded, 'saved roster')}.` +
        (summary.searchesAdded ? ` Added ${summary.searchesAdded} alliance ${summary.searchesAdded === 1 ? 'search' : 'searches'}.` : '') +
        (summary.formationIncluded ? ' The included formation is now loaded.' : ' Your formation is unchanged.'));
      $('data-close').focus();
    } catch (cause) { error(cause.message); }
  });
  $('data-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    reading++; backup = null; prepared = null;
    if (exportUrl) URL.revokeObjectURL(exportUrl); exportUrl = null;
    $('data-download').removeAttribute('href');
    if (imported) window.location.reload();
  });
  // Other open planners must reload too, so a stale in-memory plan cannot undo
  // the import on its next autosave. This marker is written last, after all data.
  window.addEventListener('storage', event => {
    if (event.key === DATA_IMPORT_KEY && event.newValue) window.location.reload();
  });
}
