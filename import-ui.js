import { orderPlayers } from './lastwar-api.js';
import { playerDetails, rosterContextLabels } from './players.js';
import { createRosterCache } from './roster-cache.js';

/** A single active step; credentials only live while the dialog is open. */
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
  let step = 1;
  let savedRosters = [];
  let alliances = [];
  let allianceServerId = null;
  let players = [];
  let activeRoster = null;
  let fromSaved = false;
  let credentialsStep = null;
  let keyAction = null;
  let request = null;
  const cache = createRosterCache({ onWarning: value => message('import-cache-warning', value) });
  cache.preservePreviousImport(previousPlayers, previousContext);

  function message(id, value = '') {
    byId(id).textContent = value;
    byId(id).hidden = !value;
  }

  const selectedId = () => (directId.value.trim() || selection.value).toLowerCase();
  const stepTitle = () => ({ saved: 'saved-roster-title', 1: 'import-server-title', 2: 'import-alliance-title', 3: 'import-preview-title' })[step];

  function render() {
    const busy = Boolean(request);
    const cachedServer = cache.getAlliances(server.value);
    const id = selectedId();
    const cachedRoster = id && cache.getRoster(id);
    form.setAttribute('aria-busy', String(busy));
    byId('saved-rosters').hidden = step !== 'saved';
    byId('import-server-step').hidden = step !== 1;
    byId('import-alliance-step').hidden = step !== 2;
    byId('import-preview').hidden = step !== 3;
    byId('import-steps').hidden = step === 'saved';
    byId('import-description').textContent = step === 'saved' ? 'Use saved players or find your alliance.' : 'Find your alliance, then review its players.';
    for (const item of byId('import-steps').children) {
      const number = Number(item.dataset.step);
      item.classList.toggle('import-step-complete', number < step);
      if (number === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    byId('import-context').hidden = step !== 2 && step !== 3;
    const labels = rosterContextLabels(step === 3 ? activeRoster?.context : { serverId: allianceServerId });
    byId('import-server-summary').textContent = `Server ${labels.server}`;
    byId('change-import-server').hidden = step === 3 && fromSaved;
    byId('import-alliance-summary-row').hidden = step !== 3;
    byId('import-alliance-summary').textContent = labels.alliance;
    byId('change-import-alliance').textContent = fromSaved ? 'Change roster' : 'Change alliance';
    byId('import-selection').hidden = !alliances.length;
    byId('import-no-alliances').hidden = Boolean(alliances.length);
    byId('import-replace-note').hidden = !hasRoster();
    byId('import-back').hidden = step === 'saved' || (step === 1 && !savedRosters.length);

    // Keep an exposed key field visible while it is being edited.
    if (step === 1 || (step === 2 && id && !cachedRoster && !key.value.trim())) credentialsStep = step;
    const showKey = step !== 'saved' && credentialsStep === step && !(step === 1 && cachedServer);
    if (step !== 'saved') byId(`import-credentials-${step}`).append(byId('import-key-field'));
    byId('import-key-field').hidden = !showKey;
    for (const input of [key, server, selection, directId, order, savedSelection]) input.disabled = busy;

    const actions = {
      'find-alliances': { visible: step === 1, label: 'Find alliances' },
      'load-roster': { visible: step === 2 && Boolean(id), label: 'Load players' },
      'confirm-import': { visible: step === 3, label: `Add ${players.length} ${players.length === 1 ? 'player' : 'players'}` },
      'refresh-alliances': { visible: step === 2, label: 'Refresh alliances · 1 API call' },
      'refresh-roster': { visible: step === 3 && activeRoster?.id !== 'previous-import', label: 'Refresh players · 1 API call' },
    };
    for (const [buttonId, action] of Object.entries(actions)) {
      const button = byId(buttonId);
      button.hidden = !action.visible;
      button.disabled = busy || (buttonId === 'confirm-import' && !players.length);
      const loading = request?.buttonId === buttonId;
      button.textContent = loading ? request.label : action.label;
      button.classList.toggle('is-loading', loading);
      button.setAttribute('aria-busy', String(loading));
    }
    message('import-action-help', step === 1 ? cachedServer
      ? 'Saved alliances available. No API call.' : 'Saved results first. A new search uses 1 API call.'
      : step === 2 && id ? cachedRoster ? 'Saved players available. No API call.' : 'Loading players uses 1 API call.'
      : step === 3 ? 'Players will be added to your base pool.' : '');
  }

  function cancelRequest() {
    request?.controller.abort();
    request = null;
    message('import-status');
  }

  function goTo(nextStep, focus = true) {
    cancelRequest();
    message('import-error');
    credentialsStep = null;
    keyAction = null;
    step = nextStep;
    render();
    if (focus) byId(stepTitle()).focus();
  }

  function clearPreview() {
    players = [];
    activeRoster = null;
    byId('import-preview-list').replaceChildren();
  }

  function clearAlliances() {
    alliances = [];
    allianceServerId = null;
    selection.replaceChildren(new Option('Choose an alliance…', ''));
    clearPreview();
  }

  async function run(buttonId, label, task) {
    if (request) return;
    message('import-error');
    const controller = new AbortController();
    const pending = { controller, buttonId, label };
    request = pending;
    render();
    message('import-status', label);
    let focusId;
    try {
      focusId = await task({ apiKey: key.value, signal: controller.signal }, () => request === pending && dialog.open);
    } catch (error) {
      if (request === pending && error.name !== 'AbortError') {
        message('import-error', error.message);
        if (/key/i.test(error.message)) { credentialsStep = step; keyAction = buttonId; }
      }
    } finally {
      if (request === pending) {
        request = null;
        message('import-status');
        render();
        if (focusId) byId(focusId).focus();
      }
    }
  }

  function requireKey(action) {
    if (key.value.trim()) return true;
    credentialsStep = step;
    keyAction = action;
    render();
    message('import-error', 'Enter your API key to load new data.');
    key.focus();
    return false;
  }

  function savedDescription(entry) {
    const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.savedAt));
    return `${entry.persisted ? 'Saved on this device' : 'Available this visit'} · ${date}`;
  }

  function renderSavedRosters(selected = '') {
    savedRosters = cache.listRosters();
    savedSelection.replaceChildren(new Option('Choose a saved roster…', ''));
    for (const roster of savedRosters) {
      const labels = rosterContextLabels(roster.context);
      const label = roster.context?.allianceName || roster.context?.allianceTag ? labels.alliance : roster.label;
      savedSelection.add(new Option(`${roster.context?.serverId ? `Server ${labels.server} · ` : ''}${label} · ${roster.data.length} players`, roster.id));
    }
    savedSelection.value = selected;
  }

  function renderPreview() {
    const list = byId('import-preview-list');
    list.replaceChildren();
    for (const player of orderPlayers(players, order.value)) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = player.name;
      const details = document.createElement('span');
      details.className = 'import-player-details';
      details.textContent = playerDetails(player, 'R');
      row.append(name, details);
      list.append(row);
    }
    byId('import-preview-title').textContent = `Review ${players.length} ${players.length === 1 ? 'player' : 'players'}`;
    byId('import-list-summary').textContent = `View ${players.length} ${players.length === 1 ? 'player' : 'players'}`;
    const missing = players.filter(player => player.hqLevel === null || player.group === null).length;
    message('import-metadata-note', missing ? `${missing} ${missing === 1 ? 'player has' : 'players have'} missing HQ or rank details. You can still import them.` : '');
  }

  function showRoster(entry, saved = false) {
    activeRoster = entry;
    players = entry.data;
    fromSaved = saved;
    step = 3;
    credentialsStep = null;
    keyAction = null;
    renderSavedRosters(entry.id);
    message('roster-cache-status', savedDescription(entry));
    renderPreview();
  }

  function findAlliances(refresh = false) {
    if (request || !server.reportValidity()) return;
    if ((refresh || !cache.getAlliances(server.value)) && !requireKey(refresh ? 'refresh-alliances' : 'find-alliances')) return;
    run(refresh ? 'refresh-alliances' : 'find-alliances', refresh ? 'Refreshing alliances…' : 'Finding alliances…', async (options, current) => {
      const result = await cache.loadAlliances(server.value, options, { refresh });
      if (!current()) return;
      const previous = selection.value;
      alliances = result.data;
      allianceServerId = Number(result.id);
      selection.replaceChildren(new Option('Choose an alliance…', ''));
      for (const alliance of alliances) selection.add(new Option(`[${alliance.tag}] ${alliance.name}${Number.isInteger(alliance.memberCount) ? ` · ${alliance.memberCount} players` : ''}`, alliance.id));
      selection.value = alliances.some(alliance => alliance.id === previous) ? previous : '';
      clearPreview();
      step = 2;
      credentialsStep = null;
      fromSaved = false;
      message('alliance-cache-status', savedDescription(result));
      if (!alliances.length) byId('import-direct').open = true;
      return 'import-alliance-title';
    });
  }

  function loadRoster(refresh = false) {
    if (request) return;
    const id = refresh ? activeRoster?.id : selectedId();
    if (!id || id === 'previous-import') return;
    if (!refresh && directId.value.trim() && !directId.reportValidity()) return;
    if ((refresh || !cache.getRoster(id)) && !requireKey(refresh ? 'refresh-roster' : 'load-roster')) return;
    const alliance = alliances.find(item => item.id === id);
    const label = alliance ? `[${alliance.tag}] ${alliance.name}` : cache.getRoster(id)?.label ?? `Alliance ${id}`;
    const context = alliance ? { serverId: allianceServerId, allianceId: id, allianceName: alliance.name, allianceTag: alliance.tag } : cache.getRoster(id)?.context;
    const saved = refresh && fromSaved;
    run(refresh ? 'refresh-roster' : 'load-roster', refresh ? 'Refreshing players…' : 'Loading players…', async (options, current) => {
      const result = await cache.loadRoster(id, options, { refresh, label, context });
      if (!current()) return;
      showRoster(result, saved);
      return 'import-preview-title';
    });
  }

  function back() {
    goTo(step === 3 ? fromSaved ? 'saved' : 2 : step === 2 ? 1 : 'saved');
  }

  function open() {
    if (dialog.open) return;
    cancelRequest();
    dialog.returnValue = '';
    form.reset();
    clearAlliances();
    fromSaved = false;
    byId('import-direct').open = false;
    byId('import-player-details').open = false;
    renderSavedRosters();
    goTo(savedRosters.length ? 'saved' : 1, false);
    dialog.showModal();
    (savedRosters.length ? savedSelection : server).focus();
  }
  byId('open-import').addEventListener('click', open);
  byId('cancel-import').addEventListener('click', () => dialog.close());
  byId('import-back').addEventListener('click', back);
  byId('find-another-alliance').addEventListener('click', () => goTo(1));
  byId('change-import-server').addEventListener('click', () => goTo(1));
  byId('change-import-alliance').addEventListener('click', back);
  dialog.addEventListener('close', () => {
    cancelRequest();
    key.value = '';
    clearAlliances();
  });
  dialog.addEventListener('cancel', cancelRequest);

  key.addEventListener('input', () => { message('import-error'); });
  server.addEventListener('input', () => {
    cancelRequest();
    clearAlliances();
    directId.value = '';
    byId('import-direct').open = false;
    savedSelection.value = '';
    message('import-error');
    render();
  });
  savedSelection.addEventListener('change', () => {
    const entry = cache.getRoster(savedSelection.value);
    if (!entry) return;
    cancelRequest();
    message('import-error');
    showRoster(entry, true);
    render();
    byId(stepTitle()).focus();
  });
  selection.addEventListener('change', () => {
    directId.value = '';
    clearPreview();
    message('import-error');
    credentialsStep = null;
    render();
  });
  directId.addEventListener('input', () => {
    selection.value = '';
    clearPreview();
    message('import-error');
    render();
  });
  order.addEventListener('change', renderPreview);
  byId('refresh-roster').addEventListener('click', () => loadRoster(true));
  byId('refresh-alliances').addEventListener('click', () => findAlliances(true));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (request) return;
    if (document.activeElement === key && keyAction === 'refresh-roster') { loadRoster(true); return; }
    if (document.activeElement === key && keyAction === 'refresh-alliances') { findAlliances(true); return; }
    if (step === 1) findAlliances();
    else if (step === 2) loadRoster();
    else if (step === 3 && players.length) {
      if (onImport(orderPlayers(players, order.value), activeRoster?.context ?? null) !== false) dialog.close('imported');
    }
  });

  const previousIds = new Set(previousPlayers?.map(player => player.id));
  const matches = cache.listRosters().filter(roster => roster.data.length === previousIds.size &&
    roster.data.every(player => previousIds.has(player.id)));
  return { open, hasSavedRosters: () => cache.listRosters().length > 0,
    previousContext: previousContext ?? (matches.length === 1 ? matches[0].context : null) };
}
