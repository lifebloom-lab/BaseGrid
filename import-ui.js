import { orderPlayers } from './lastwar-api.js';
import { playerDetails, rosterContextLabels } from './players.js';
import { createRosterCache } from './roster-cache.js';

/** The dialog holds credentials only while open; the caller receives player records. */
export function setupRosterImport({ onImport, hasRoster, previousPlayers, previousContext }) {
  const byId = id => document.getElementById(id);
  const dialog = byId('import-dialog');
  const form = byId('import-form');
  const key = byId('import-key');
  const server = byId('import-server');
  const selection = byId('import-alliance');
  const directId = byId('import-alliance-id');
  const order = byId('import-order');
  const savedSelection = byId('saved-roster');
  let alliances = [];
  let allianceServerId = null;
  let players = [];
  let activeRoster = null;
  let request = null;
  const cache = createRosterCache({ onWarning: value => message('import-cache-warning', value) });
  cache.preservePreviousImport(previousPlayers, previousContext);

  function message(id, value = '') {
    byId(id).textContent = value;
    byId(id).hidden = !value;
  }

  function clearPreview() {
    players = [];
    activeRoster = null;
    byId('import-preview').hidden = true;
    byId('confirm-import').disabled = true;
    byId('import-preview-list').replaceChildren();
  }

  function clearAlliances() {
    alliances = [];
    allianceServerId = null;
    selection.replaceChildren(new Option('Choose an alliance…', ''));
    byId('import-selection').hidden = true;
    clearPreview();
  }

  function cancelRequest() {
    request?.abort();
    request = null;
    setBusy(false);
    message('import-status');
  }

  function setBusy(busy) {
    form.setAttribute('aria-busy', String(busy));
    byId('find-alliances').disabled = busy;
    byId('refresh-alliances').disabled = busy;
    byId('refresh-roster').disabled = busy || !activeRoster || activeRoster.id === 'previous-import';
    byId('load-roster').disabled = busy || !(selection.value || directId.value.trim());
    byId('confirm-import').disabled = busy || !players.length;
  }

  async function run(task, status) {
    if (request) return;
    message('import-error');
    const controller = new AbortController();
    request = controller;
    setBusy(true);
    message('import-status', `${status} Please wait.`);
    try {
      await task({ apiKey: key.value, signal: controller.signal }, controller);
    } catch (error) {
      if (request === controller && error.name !== 'AbortError') message('import-error', error.message);
    } finally {
      if (request === controller) {
        request = null;
        setBusy(false);
        message('import-status');
      }
    }
  }

  function renderPreview() {
    const ordered = orderPlayers(players, order.value);
    const list = byId('import-preview-list');
    list.replaceChildren();
    for (const player of ordered) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = player.name;
      const details = document.createElement('span');
      details.className = 'import-player-details';
      details.textContent = [playerDetails(player),
        player.power === undefined ? '' : `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(player.power)} power`].filter(Boolean).join(' · ');
      row.append(name, details);
      list.append(row);
    }
    byId('import-preview-title').textContent = `Review ${players.length} ${players.length === 1 ? 'player' : 'players'}`;
    const missing = players.filter(player => player.hqLevel === null || player.group === null).length;
    message('import-metadata-note', missing
      ? `${missing} ${missing === 1 ? 'player has' : 'players have'} an unknown HQ level or group. You can still import the roster; unknown values stay empty.` : '');
    byId('import-preview').hidden = false;
    byId('confirm-import').textContent = `Use ${players.length} ${players.length === 1 ? 'player' : 'players'}`;
    byId('import-replace-note').textContent = hasRoster()
      ? 'This will replace your current roster. You can edit the names and order afterward.'
      : 'You can edit the names and order in the roster afterward.';
  }

  function savedDescription(entry) {
    const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.savedAt));
    return `${entry.persisted ? 'Saved locally' : 'Kept for this visit'} · ${date}`;
  }

  function renderSavedRosters(selectedId = '') {
    const rosters = cache.listRosters();
    savedSelection.replaceChildren(new Option('Choose a saved roster…', ''));
    for (const roster of rosters) {
      const labels = rosterContextLabels(roster.context);
      const label = roster.context?.allianceName || roster.context?.allianceTag ? labels.alliance : roster.label;
      savedSelection.add(new Option(`${roster.context?.serverId ? `Server ${labels.server} · ` : ''}${label} · ${roster.data.length} players`, roster.id));
    }
    savedSelection.value = selectedId;
    byId('saved-rosters').hidden = !rosters.length;
    return rosters;
  }

  function showRoster(entry) {
    activeRoster = entry;
    players = entry.data;
    const labels = rosterContextLabels(entry.context);
    message('import-roster-context', `Server ${labels.server} · Alliance: ${labels.alliance}`);
    message('roster-cache-status', `${savedDescription(entry)}. ${entry.source === 'api' ? 'Downloaded with 1 API call.' : 'Loaded without an API call.'}`);
    renderSavedRosters(entry.id);
    renderPreview();
    setBusy(Boolean(request));
  }

  function requireKey() {
    if (key.value.trim()) return true;
    byId('import-lookup').open = true;
    message('import-error', 'Enter your API key to fetch new data. Saved rosters do not need a key.');
    key.focus();
    key.reportValidity();
    return false;
  }

  function showAlliances(entry) {
    alliances = entry.data;
    allianceServerId = Number(entry.id);
    selection.replaceChildren(new Option('Choose an alliance…', ''));
    for (const alliance of alliances) {
      selection.add(new Option(`[${alliance.tag}] ${alliance.name}${Number.isInteger(alliance.memberCount) ? ` · ${alliance.memberCount} players` : ''}`, alliance.id));
    }
    byId('import-selection').hidden = false;
    message('alliance-cache-status', `${savedDescription(entry)}. ${entry.source === 'api' ? 'Downloaded with 1 API call.' : 'Loaded without an API call.'}`);
    if (!alliances.length) message('import-error', 'No ranked alliances were returned for this server. You can enter an alliance ID below.');
    selection.focus();
  }

  function findAlliances(refresh = false) {
    if (request || !server.reportValidity()) return;
    if ((refresh || !cache.getAlliances(server.value)) && !requireKey()) return;
    // Keep the current roster available if a lookup/refresh fails.
    run(async (options, controller) => {
      const result = await cache.loadAlliances(server.value, options, { refresh });
      if (request !== controller || !dialog.open) return;
      directId.value = '';
      showAlliances(result);
    }, refresh ? 'Refreshing alliances… This uses 1 API call.' : 'Loading alliances… Using saved data when available.');
  }

  function loadRoster(refresh = false) {
    if (request) return;
    const id = (refresh ? activeRoster?.id : directId.value.trim() || selection.value)?.toLowerCase();
    if (!id || id === 'previous-import') return;
    if ((refresh || !cache.getRoster(id)) && !requireKey()) return;
    const alliance = alliances.find(item => item.id === id);
    const label = alliance ? `[${alliance.tag}] ${alliance.name}` : cache.getRoster(id)?.label ?? `Alliance ${id}`;
    const context = alliance ? { serverId: allianceServerId, allianceId: id,
      allianceName: alliance.name, allianceTag: alliance.tag } : cache.getRoster(id)?.context;
    run(async (options, controller) => {
      const result = await cache.loadRoster(id, options, { refresh, label, context });
      if (request !== controller || !dialog.open) return;
      showRoster(result);
      byId('import-preview-title').focus();
    }, refresh ? 'Refreshing players… This uses 1 API call.' : 'Loading players… Using saved data when available.');
  }

  byId('open-import').addEventListener('click', () => {
    form.reset();
    clearAlliances();
    message('import-error');
    message('import-status');
    byId('import-direct').open = false;
    const saved = renderSavedRosters();
    byId('import-lookup').open = saved.length === 0;
    if (saved.length) showRoster(saved[0]);
    setBusy(false);
    dialog.showModal();
    if (saved.length) savedSelection.focus();
  });
  byId('cancel-import').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    cancelRequest();
    key.value = '';
    clearAlliances();
  });
  dialog.addEventListener('cancel', cancelRequest);

  key.addEventListener('input', () => {
    cancelRequest();
    message('import-error');
  });
  server.addEventListener('input', () => {
    cancelRequest();
    clearAlliances();
    directId.value = '';
    savedSelection.value = '';
    message('import-error');
    setBusy(false);
  });
  savedSelection.addEventListener('change', () => {
    cancelRequest();
    message('import-error');
    const entry = cache.getRoster(savedSelection.value);
    if (entry) showRoster(entry);
    else clearPreview();
  });
  selection.addEventListener('change', () => {
    cancelRequest();
    directId.value = '';
    clearPreview();
    savedSelection.value = '';
    message('import-error');
    setBusy(false);
  });
  directId.addEventListener('input', () => {
    cancelRequest();
    selection.value = '';
    clearPreview();
    savedSelection.value = '';
    message('import-error');
    setBusy(false);
  });
  order.addEventListener('change', () => { if (players.length) renderPreview(); });

  // Enter in the first fields searches the server instead of prematurely importing.
  form.addEventListener('submit', event => {
    event.preventDefault();
    findAlliances();
  });

  byId('load-roster').addEventListener('click', () => loadRoster());
  byId('refresh-roster').addEventListener('click', () => loadRoster(true));
  byId('refresh-alliances').addEventListener('click', () => findAlliances(true));

  byId('confirm-import').addEventListener('click', () => {
    if (!players.length || request) return;
    onImport(orderPlayers(players, order.value), activeRoster?.context ?? null);
    dialog.close();
  });

  // Restore provenance for an older workspace only when its imported IDs match one saved roster.
  const previousIds = new Set(previousPlayers?.map(player => player.id));
  const matches = cache.listRosters().filter(roster => roster.data.length === previousIds.size &&
    roster.data.every(player => previousIds.has(player.id)));
  return { previousContext: previousContext ?? (matches.length === 1 ? matches[0].context : null) };
}
