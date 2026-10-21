import { fetchMembers } from './lastwar-api.js';
import { setupSavedApiKey } from './api-key.js?v=20261012-key';
import { loadWorkspace } from './storage.js';
import { currentBattle, loadBattles, normalizeBattles } from './battle-model.js?v=20261021-reserve';
import { rosterContextLabels } from './players.js?v=20261021-reserve';
import { readRosterLibrary, rosterUpdateSources, prepareRosterUpdate, commitRosterUpdate } from './roster-update.js?v=20261021-reserve';

export function setupRosterUpdate({ getState, onUpdated }) {
  const $ = id => document.getElementById(id);
  const dialog = $('battle-roster-update-dialog');
  const keyPreference = setupSavedApiKey($('battle-roster-update-key'), { onWarning: message => error(message) });
  let sources = [];
  let request = null;
  let pending = null;
  const storage = () => window.localStorage;
  const date = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const label = entry => {
    const context = rosterContextLabels(entry.context);
    return (entry.context?.serverId ? 'Server ' + context.server + ' · ' : '') +
      (entry.context?.allianceName || entry.context?.allianceTag ? context.alliance : entry.label || entry.id);
  };
  const selected = () => sources.find(entry => entry.id === $('battle-roster-update-alliance').value);
  function error(message = '') { $('battle-roster-update-error').textContent = message; $('battle-roster-update-error').hidden = !message; }
  function status(message = '', loading = false) {
    const node = $('battle-roster-update-status');
    node.textContent = message; node.hidden = !message; node.classList.toggle('is-loading', loading);
  }
  function findSources() {
    return rosterUpdateSources(currentBattle(getState()).players, readRosterLibrary(storage()).entries, loadWorkspace(storage()).draft);
  }
  function render() {
    const node = $('battle-roster-updated');
    try {
      const entries = findSources();
      const entry = entries.length === 1 ? entries[0] : null;
      node.textContent = entry?.statsUpdatedAt ? 'Last updated ' + date(entry.statsUpdatedAt) : '';
    } catch { node.textContent = ''; }
    node.hidden = !node.textContent;
  }
  function context() {
    const entry = selected();
    $('battle-roster-update-context').textContent = entry ? label(entry) : 'Choose the alliance to refresh.';
    $('battle-roster-update-date').textContent = entry?.savedAt ? 'Last fetched ' + date(entry.savedAt) : '';
    $('battle-roster-update-date').hidden = !entry?.savedAt;
    $('battle-roster-update-submit').disabled = !entry || Boolean(request);
  }
  function busy(value) {
    $('battle-roster-update-form').setAttribute('aria-busy', String(value));
    $('battle-roster-update-alliance').disabled = value || Boolean(pending);
    $('battle-roster-update-key').disabled = value || Boolean(pending);
    keyPreference.setBusy(value || Boolean(pending));
    $('battle-roster-update-submit').disabled = value || !selected();
    $('battle-roster-update-submit').textContent = value ? 'Updating…' : pending ? 'Save update' : 'Update roster';
  }
  $('battle-update-roster').addEventListener('click', () => {
    error(); status(); pending = null;
    $('battle-roster-update-form').reset();
    keyPreference.open();
    $('battle-roster-update-close').textContent = 'Cancel';
    $('battle-roster-update-controls').hidden = false;
    $('battle-roster-update-submit').hidden = false;
    sources = [];
    try { sources = findSources(); }
    catch { error('Saved data could not be opened. Your existing plans have been kept.'); }
    const select = $('battle-roster-update-alliance');
    select.replaceChildren(new Option('Choose an alliance…', ''), ...sources.map(entry => new Option(label(entry), entry.id)));
    select.value = sources.length === 1 ? sources[0].id : '';
    $('battle-roster-update-choice').hidden = sources.length <= 1;
    $('battle-roster-update-empty').hidden = Boolean(sources.length);
    $('battle-roster-update-controls').hidden = !sources.length;
    $('battle-roster-update-submit').hidden = !sources.length;
    context(); busy(false);
    dialog.showModal(); $('battle-roster-update-title').focus();
  });
  $('battle-roster-update-alliance').addEventListener('change', () => { error(); context(); });
  $('battle-roster-update-close').addEventListener('click', () => dialog.close());
  function cancel() { request?.abort(); request = null; pending = null; keyPreference.clear(); }
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('close', cancel);
  $('battle-roster-update-form').addEventListener('submit', async event => {
    event.preventDefault();
    const entry = selected();
    if (request || !entry) return;
    error();
    const controller = new AbortController();
    request = controller;
    try {
      if (!pending) {
        // Don't replace unsaved changes in this tab with the saved snapshot.
        if (JSON.stringify(normalizeBattles(getState())) !== JSON.stringify(loadBattles(storage()))) {
          throw new Error('This tab differs from the saved plans. Reload it before updating the roster.');
        }
        busy(true); status('Getting fresh player stats…', true);
        const apiKey = $('battle-roster-update-key').value;
        const data = await fetchMembers(entry.id, { apiKey, signal: controller.signal });
        if (controller.signal.aborted || !dialog.open) return;
        keyPreference.remember(apiKey);
        pending = { ...entry, data, savedAt: Date.now() };
      }
      const prepared = prepareRosterUpdate(storage(), pending);
      const result = commitRosterUpdate(storage(), prepared);
      pending = null;
      onUpdated(prepared.entry);
      render();
      $('battle-roster-update-key').value = '';
      $('battle-roster-update-controls').hidden = true;
      $('battle-roster-update-submit').hidden = true;
      $('battle-roster-update-close').textContent = 'Done';
      status((result.updated ? 'Updated ' + result.updated + (result.updated === 1 ? ' player' : ' players') +
        (result.plansUpdated ? ' across ' + result.plansUpdated + (result.plansUpdated === 1 ? ' battle plan.' : ' battle plans.') : '.') : result.matched ? 'Player stats are already up to date.' : 'No matching players were returned. Your saved roster is kept.') + ' Assignments preserved.');
      $('battle-roster-update-close').focus();
    } catch (cause) {
      if (controller.signal.aborted || !dialog.open) return;
      status();
      error((cause instanceof SyntaxError ? 'Saved data could not be read. Your existing plans have been kept.' : cause.message) +
        (pending ? ' The fresh data is kept in this panel. Save update retries without another API call.' : ''));
    } finally {
      if (request === controller) { request = null; busy(false); }
    }
  });
  render();
  return { render };
}
