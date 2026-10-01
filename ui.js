import { parseManualPlayers, playerDetails, normalizeImportedPlayer, rosterContextLabels, sortPoolPlayers } from './players.js';
import { tileKey } from './free-formation.js';
import { gridCanvas, previewGridMove } from './grid-layout.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace, clearWorkspace } from './storage.js';
import { getTilePlan, openTilePlacement, confirmTilePlacement, undoTileConfirmation, cancelTilePlacement,
  recordCopiedMessage, moveTile, updateTileDraft, resetTileProgress, migrateTileWorkspace, returnBaseToPool, autoPlaceBases } from './tile-placement.js';
import { setupRosterImport } from './import-ui.js';
import { setupFormationReorder } from './reorder-ui.js';
import { setupPlacementMessages } from './placement-messages.js';

const byId = id => document.getElementById(id);
const fields = { names: byId('players'), x: byId('initial-x'), y: byId('initial-y'), spacing: byId('spacing') };
let draft = { ...DEFAULT_DRAFT };
let reorder = null;
let currentPlan = null;
let mapPadding = 1;
let resetKind = 'clear';
let poolPlayerId = null;
const autoPlaceDialog = byId('auto-place-dialog');
const fullscreenDialog = byId('formation-fullscreen');
const fullscreenToggle = byId('formation-fullscreen-toggle');
const fullscreenHomes = new Map();
let pagePosition = null;
const placementPopup = byId('placement-popup');
const placementHomes = new Map();
let placementReturn = null;

function showPlacementPopup(playerId, mapPosition) {
  reorder?.cancel();
  placementReturn = { playerId, ...mapPosition };
  // Reuse the live controls so copy, language, and confirmation behave identically.
  for (const id of ['notice', 'error', 'player-message-panel']) {
    const node = byId(id);
    const home = document.createComment(id);
    node.before(home);
    placementHomes.set(node, home);
    placementPopup.append(node);
  }
  byId('close-placement').textContent = 'Back to map';
  placementPopup.showModal();
  placementPopup.scrollTop = 0;
  byId('player-message-title').focus({ preventScroll: true });
}

function hidePlacementPopup(restoreFocus = true) {
  if (!placementHomes.size) return;
  if (placementPopup.open) placementPopup.close();
  for (const [node, home] of placementHomes) home.replaceWith(node);
  placementHomes.clear();
  byId('close-placement').textContent = 'Back to setup';
  if (restoreFocus && fullscreenDialog.open) {
    // Rendering replaces tile buttons, so find the current button for this player.
    const tile = [...byId('formation-grid').children].find(node => node.dataset.playerId === placementReturn.playerId);
    (tile?.querySelector('.tile-action') ?? fullscreenToggle).focus({ preventScroll: true });
    byId('map-scroll').scrollTo(placementReturn.left, placementReturn.top);
  }
  placementReturn = null;
}

function closePlacement() {
  change(value => ({ ...value, selectedPlayerId: null }), placementHomes.size ? undefined : 'setup-title');
}

placementPopup.addEventListener('cancel', event => {
  event.preventDefault();
  closePlacement();
});
placementPopup.addEventListener('close', () => {
  if (!placementPopup.open && placementHomes.size) closePlacement();
});

function updateFullscreenButton(expanded) {
  fullscreenToggle.setAttribute('aria-expanded', String(expanded));
  fullscreenToggle.title = expanded ? 'Exit full screen (Escape)' : 'Expand formation to fill the window';
  byId('formation-expand-label').textContent = expanded ? 'Exit full screen' : 'Full screen';
  byId('formation-expand-icon').setAttribute('d', expanded
    ? 'M3 7h4V3m6 0v4h4M7 17v-4H3m14 0h-4v4'
    : 'M7 3H3v4m10-4h4v4M3 13v4h4m6 0h4v-4');
}

function expandFormation() {
  if (fullscreenDialog.open) return;
  reorder?.cancel();
  const map = byId('map-scroll');
  const { scrollLeft, scrollTop } = map;
  pagePosition = { left: window.scrollX, top: window.scrollY };
  // Move the live panel, preserving its handlers and state. Notices remain visible too.
  for (const id of ['notice', 'error', 'formation-panel']) {
    const node = byId(id);
    const home = document.createComment(id);
    node.before(home);
    fullscreenHomes.set(node, home);
    fullscreenDialog.append(node);
  }
  document.body.classList.add('formation-expanded');
  updateFullscreenButton(true);
  fullscreenDialog.showModal();
  map.scrollTo(scrollLeft, scrollTop);
  fullscreenToggle.focus({ preventScroll: true });
}

function exitFormationFullscreen(restoreFocus = true) {
  if (!fullscreenHomes.size) return;
  hidePlacementPopup(false);
  reorder?.cancel();
  const map = byId('map-scroll');
  const { scrollLeft, scrollTop } = map;
  if (fullscreenDialog.open) fullscreenDialog.close();
  for (const [node, home] of fullscreenHomes) home.replaceWith(node);
  fullscreenHomes.clear();
  document.body.classList.remove('formation-expanded');
  updateFullscreenButton(false);
  map.scrollTo(scrollLeft, scrollTop);
  if (restoreFocus) fullscreenToggle.focus({ preventScroll: true });
  if (pagePosition) window.scrollTo(pagePosition);
  pagePosition = null;
}

fullscreenToggle.addEventListener('click', () => fullscreenDialog.open ? exitFormationFullscreen() : expandFormation());
fullscreenDialog.addEventListener('cancel', event => {
  event.preventDefault();
  exitFormationFullscreen();
});
fullscreenDialog.addEventListener('close', () => {
  if (!fullscreenDialog.open) exitFormationFullscreen();
});

const placementMessages = setupPlacementMessages({ onCopy(proposal, language) {
  draft = recordCopiedMessage(draft, proposal, language);
  persist();
  render();
} });

function showMessage(id, message = '') {
  byId(id).textContent = message;
  byId(id).hidden = !message;
}

function storageStatus(message, warning = false) {
  byId('save-status').textContent = message;
  byId('save-status').classList.toggle('warning', warning);
}

function persist() {
  try {
    saveWorkspace(window.localStorage, draft, null);
    storageStatus('Saved on this device');
  } catch {
    storageStatus('Not saved', true);
    showMessage('notice', 'Browser storage is unavailable or full. You can keep planning, but changes may be lost when you close or refresh the page.');
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderPlayerDetails(player, container = element('span', 'player-details')) {
  container.replaceChildren();
  container.hidden = !playerDetails(player);
  if (container.hidden) return container;
  const { hqLevel, group } = normalizeImportedPlayer(player);
  container.append(element('span', '', hqLevel === null ? 'HQ unknown' : `HQ ${hqLevel}`));
  if (group === null) container.append(element('span', '', 'Group unknown'));
  else {
    const badge = element('span', 'rank-badge', `R${group}`);
    badge.dataset.rank = group;
    container.append(badge);
  }
  return container;
}

function change(update, focusId) {
  try {
    draft = update(draft);
    showMessage('error');
    persist();
    render();
    if (focusId) byId(focusId).focus({ preventScroll: true });
    return true;
  } catch (error) {
    showMessage('error', error.message);
    return false;
  }
}

function renderFormation(plan) {
  reorder?.cancel();
  for (const id of ['reorder-help', 'obstacle-tools', 'map-scroll', 'base-pool']) byId(id).hidden = !plan;
  for (const tool of document.querySelectorAll('.obstacle-tool')) tool.disabled = !plan;
  byId('map-empty').hidden = Boolean(plan);
  const grid = byId('formation-grid');
  grid.replaceChildren();
  if (!plan) {
    byId('grid-size').textContent = 'Awaiting roster';
    byId('formation-summary').textContent = 'Add players to start shaping your formation.';
    return;
  }
  renderPool(plan);
  const canvas = gridCanvas(plan.pool.length ? [...plan.slots, { column: 0, row: 0, size: 9 }] : plan.slots, mapPadding);
  const playersById = new Map(plan.players.map(player => [player.id, player]));
  const playerNumbers = new Map(plan.players.map((player, index) => [player.id, index + 1]));
  grid.style.setProperty('--columns', canvas.columns);
  grid.style.setProperty('--rows', canvas.rows);
  Object.assign(grid.dataset, { minColumn: canvas.minColumn, minRow: canvas.minRow,
    columns: canvas.columns, rows: canvas.rows, originX: plan.origin.x, originY: plan.origin.y });
  const fragment = document.createDocumentFragment();
  for (const slot of plan.slots) {
    const coordinates = slot;
    const small = slot.size === 1;
    const locked = slot.status === 'placed';
    const cell = element('li', `slot ${slot.status}${small ? ' small-obstacle' : ''}`);
    Object.assign(cell.dataset, { tile: tileKey(slot), column: slot.column, row: slot.row,
      x: coordinates.x, y: coordinates.y, kind: slot.type, size: slot.size, locked: String(locked) });
    if (slot.playerId) cell.dataset.playerId = slot.playerId;
    cell.style.left = `calc(${slot.column - canvas.minColumn} * var(--cell-size))`;
    cell.style.top = `calc(${slot.row - canvas.minRow} * var(--cell-size))`;
    cell.style.width = `calc(${slot.size} * var(--cell-size))`;
    cell.style.height = `calc(${slot.size} * var(--cell-size))`;
    cell.title = `${slot.type === 'obstacle' ? `Obstacle ${slot.size} × ${slot.size}` : slot.name} · X ${slot.x}, Y ${slot.y}`;
    if (slot.playerId && slot.playerId === draft.selectedPlayerId) cell.classList.add('selected');
    const top = element('div', 'slot-top');
    top.append(element('span', 'slot-number', slot.type === 'obstacle' ? `${slot.size} × ${slot.size}` : String(playerNumbers.get(slot.playerId)).padStart(2, '0')));
    if (!locked) {
      cell.classList.add('slot-reorderable');
      const handle = element('button', 'slot-move', '⠿');
      handle.type = 'button';
      handle.setAttribute('aria-label', `Move ${slot.type === 'obstacle' ? `${slot.size} × ${slot.size} obstacle` : slot.name}, X ${coordinates.x}, Y ${coordinates.y}`);
      handle.setAttribute('aria-describedby', 'reorder-help');
      handle.setAttribute('aria-pressed', 'false');
      handle.title = 'Drag to move, or press Space and use the arrow keys';
      if (slot.type === 'player') {
        const actions = element('span', 'slot-tools');
        const remove = element('button', 'base-return', '↶');
        remove.type = 'button';
        remove.title = `Return ${slot.name} to pool`;
        remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', () => {
          poolPlayerId = slot.playerId;
          if (change(value => returnBaseToPool(value, slot.playerId), 'add-base')) {
            byId('reorder-status').textContent = `${slot.name} returned to the pool. Their roster details are saved.`;
          }
        });
        actions.append(remove, handle);
        top.append(actions);
      } else top.append(handle);
    } else top.append(element('span', 'slot-state', '✓ Placed'));
    cell.append(top);
    if (!small) cell.append(element('span', 'slot-name', slot.type === 'obstacle' ? '× Blocked' : slot.name));
    if (slot.type === 'player') cell.append(renderPlayerDetails(playersById.get(slot.playerId)));
    if (!small) cell.append(element('span', 'slot-coordinates', `${coordinates.x}, ${coordinates.y}`));
    if (slot.type === 'player') {
      if (slot.status === 'in-progress') cell.append(element('span', 'slot-state', slot.messageChanged ? '↻ Update message' : 'In progress'));
      const action = element('button', 'tile-action', locked ? 'View' : slot.status === 'in-progress' ? 'Continue' : 'Place');
      action.type = 'button';
      action.setAttribute('aria-label', `${locked ? 'View placement for' : slot.status === 'in-progress' ? 'Continue placing' : 'Place'} ${slot.name}`);
      action.addEventListener('click', () => {
        const expanded = fullscreenDialog.open;
        const map = byId('map-scroll');
        const mapPosition = { left: map.scrollLeft, top: map.scrollTop };
        if (change(value => openTilePlacement(value, slot.playerId), expanded ? undefined : 'player-message-title')) {
          if (expanded) showPlacementPopup(slot.playerId, mapPosition);
          else if (window.matchMedia('(max-width: 760px)').matches) byId('player-message-panel').scrollIntoView({ block: 'start' });
        }
      });
      cell.append(action);
    }
    if (slot.type === 'obstacle') {
      const remove = element('button', 'text-button obstacle-remove', small ? '×' : 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove obstacle at X ${coordinates.x}, Y ${coordinates.y}`);
      remove.addEventListener('click', () => {
        if (editFormation('obstacle', slot, null)) {
          byId('add-obstacle').focus({ preventScroll: true });
          byId('reorder-status').textContent = `Obstacle removed at ${coordinates.x}, ${coordinates.y}.`;
        }
      });
      cell.append(remove);
    }
    fragment.append(cell);
  }
  grid.append(fragment);
  byId('grid-size').textContent = `${canvas.columns} × ${canvas.rows} tiles · 1 tile per step`;
  const blocked = plan.slots.filter(slot => slot.type === 'obstacle').length;
  byId('formation-summary').textContent = `${blocked} ${blocked === 1 ? 'obstacle' : 'obstacles'} · Confirmed bases stay locked. Empty tiles stay empty.`;
}

function renderPool(plan) {
  const picker = byId('pool-player');
  const players = sortPoolPlayers(plan.pool);
  const grouped = players.some(player => normalizeImportedPlayer(player).group !== null);
  const groups = new Map();
  picker.replaceChildren();
  for (const player of players) {
    const details = playerDetails(player, 'R');
    const option = element('option', '', `${player.name}${details ? ` · ${details}` : ''}`);
    option.value = player.id;
    if (grouped) {
      const rank = normalizeImportedPlayer(player).group;
      if (!groups.has(rank)) {
        const group = element('optgroup');
        group.label = rank === null ? 'Rank unavailable' : `R${rank}`;
        groups.set(rank, group);
        picker.append(group);
      }
      groups.get(rank).append(option);
    } else picker.append(option);
  }
  if (!plan.pool.length) picker.append(element('option', '', 'All bases are on the map'));
  if (!players.some(player => player.id === poolPlayerId)) poolPlayerId = players[0]?.id ?? null;
  if (poolPlayerId) picker.value = poolPlayerId;
  picker.disabled = !plan.pool.length;
  byId('pool-count').textContent = `· ${plan.pool.length}`;
  byId('auto-place').disabled = plan.slots.filter(slot => slot.status === 'placed').length === plan.players.length;
  byId('pool-help').textContent = plan.pool.length
    ? 'Choose a player. Drag Add base onto the map, or click it then choose an empty area.'
    : 'Use ↶ on an unconfirmed base to return it to the pool.';
  syncPoolTool();
}

function syncPoolTool() {
  const player = currentPlan?.pool.find(player => player.id === poolPlayerId);
  const tool = byId('add-base');
  tool.disabled = !player;
  tool.dataset.playerId = player?.id ?? '';
  tool.dataset.name = player?.name ?? '';
  tool.setAttribute('aria-label', player ? `Add base for ${player.name}` : 'Add base');
}
byId('pool-player').addEventListener('change', () => {
  reorder?.cancel();
  poolPlayerId = byId('pool-player').value;
  syncPoolTool();
});

byId('auto-place').addEventListener('click', () => {
  if (!currentPlan) return;
  reorder?.cancel();
  const poolChoice = byId('auto-place-form').elements['auto-mode'][0];
  const rearrangeChoice = byId('auto-place-form').elements['auto-mode'][1];
  poolChoice.disabled = !currentPlan.pool.length;
  poolChoice.checked = Boolean(currentPlan.pool.length);
  rearrangeChoice.checked = !currentPlan.pool.length;
  byId('auto-pool-help').textContent = currentPlan.pool.length ? `${currentPlan.pool.length} ${currentPlan.pool.length === 1 ? 'base' : 'bases'}. Keep the current arrangement.` : 'The pool is empty.';
  byId('auto-place-description').textContent = `Start at X ${currentPlan.origin.x}, Y ${currentPlan.origin.y}, with ${currentPlan.spacing} empty ${currentPlan.spacing === 1 ? 'tile' : 'tiles'} between bases. Occupied areas are skipped.`;
  showMessage('auto-place-error');
  autoPlaceDialog.showModal();
});
byId('cancel-auto-place').addEventListener('click', () => autoPlaceDialog.close());
byId('auto-place-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const next = autoPlaceBases(draft, byId('auto-place-form').elements['auto-mode'].value);
    change(() => next);
    autoPlaceDialog.close();
    byId('auto-place').focus({ preventScroll: true });
    byId('reorder-status').textContent = 'Bases arranged from the starting point. Confirmed bases and obstacles stayed fixed. Plan saved.';
  } catch (error) { showMessage('auto-place-error', error.message); }
});

function renderResults(plan) {
  const recorded = plan?.slots.filter(slot => slot.status === 'placed' || slot.type === 'obstacle') ?? [];
  byId('results-panel').hidden = !recorded.length;
  const body = byId('results-body');
  body.replaceChildren();
  if (!recorded.length) return;
  byId('results-title').textContent = recorded.filter(slot => slot.type === 'player').length === plan.players.length ? 'Final coordinates' : 'Confirmed coordinates';
  byId('results-count').textContent = `${recorded.length} ${recorded.length === 1 ? 'position' : 'positions'}`;
  byId('results-empty').hidden = true;
  for (const occupant of recorded) {
    const blocked = occupant.type === 'obstacle';
    const row = element('tr', blocked ? 'blocked-row' : '');
    const playerIndex = plan.players.findIndex(player => player.id === occupant.playerId);
    for (const value of [blocked ? '—' : playerIndex + 1, blocked ? `Obstacle ${occupant.size} × ${occupant.size}` : occupant.name, occupant.x, occupant.y]) row.append(element('td', '', String(value)));
    if (!blocked) row.children[1].append(renderPlayerDetails(plan.players[playerIndex]));
    const status = element('td');
    status.append(element('span', 'status-badge', blocked ? '× Blocked' : '✓ Placed'));
    row.append(status);
    body.append(row);
  }
}

function render() {
  let plan = null;
  try { plan = getTilePlan(draft); } catch { /* Incomplete input is normal while editing. */ }
  currentPlan = plan;
  const selected = plan?.slots.find(slot => slot.playerId === draft.selectedPlayerId);
  const player = selected && plan.players.find(item => item.id === selected.playerId);
  placementMessages.render(selected ? { player, x: selected.x, y: selected.y } : null);
  byId('setup-panel').hidden = Boolean(selected);
  if (selected) {
    const placed = selected.status === 'placed';
    byId('player-message-title').textContent = player.name;
    byId('selected-status').textContent = placed ? '✓ PLACED · LOCKED' : 'IN PROGRESS';
    byId('player-message-panel').dataset.status = selected.status;
    renderPlayerDetails(player, byId('selected-details'));
    byId('selected-x').textContent = selected.x;
    byId('selected-y').textContent = selected.y;
    byId('message-compose').hidden = placed;
    byId('confirmed-details').hidden = !placed;
    byId('message-changed').hidden = !selected.messageChanged;
  }
  const placed = plan?.slots.filter(slot => slot.status === 'placed').length ?? 0;
  const inProgress = plan?.slots.filter(slot => slot.status === 'in-progress').length ?? 0;
  const total = plan?.players.length ?? 0;
  byId('placement-count').textContent = `${placed} placed · ${inProgress} in progress · ${total - placed - inProgress} remaining`;
  byId('placement-progress').max = total || 1;
  byId('placement-progress').value = placed;
  for (const field of Object.values(fields)) field.disabled = placed > 0;
  byId('open-import').disabled = placed > 0;
  byId('settings-lock-help').hidden = !placed;
  byId('reset-progress').hidden = !draft.tilePlacements?.length;
  byId('roster-context').hidden = !draft.importedPlayers?.length;
  const context = rosterContextLabels(draft.rosterContext);
  byId('roster-server').textContent = context.server;
  byId('roster-alliance').textContent = context.alliance;
  const count = parseManualPlayers(draft.names).length;
  byId('player-count').textContent = `${count} ${count === 1 ? 'player' : 'players'}`;
  const spacing = Number(draft.spacing);
  byId('spacing-help').textContent = draft.spacing.trim() && Number.isSafeInteger(spacing) && spacing >= 0
    ? `${spacing} empty ${spacing === 1 ? 'tile' : 'tiles'} between bases when using Auto place. Dragging moves 1 tile at a time.`
    : 'Spacing is the number of empty tiles between bases.';
  renderFormation(plan);
  renderResults(plan);
  if (!selected) hidePlacementPopup();
}

byId('setup-form').addEventListener('submit', event => event.preventDefault());
byId('setup-form').addEventListener('input', () => {
  const patch = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
  if (!change(value => updateTileDraft(value, patch))) syncFields();
});
function syncFields() { for (const [key, input] of Object.entries(fields)) input.value = draft[key]; }

byId('close-placement').addEventListener('click', closePlacement);
byId('confirm-placement').addEventListener('click', () => change(value => confirmTilePlacement(value, value.selectedPlayerId), 'undo-confirmation'));
byId('undo-confirmation').addEventListener('click', () => change(value => undoTileConfirmation(value, value.selectedPlayerId), 'confirm-placement'));
byId('cancel-placement').addEventListener('click', () => change(value => cancelTilePlacement(value, value.selectedPlayerId), placementHomes.size ? undefined : 'setup-title'));

function requestReset(kind) {
  resetKind = kind;
  byId('reset-title').textContent = kind === 'progress' ? 'Reset placement progress?' : 'Clear this formation?';
  byId('reset-description').textContent = kind === 'progress'
    ? 'All players return to Planned and their bases unlock. Your roster, positions, and obstacles stay in place.'
    : 'This removes the current roster, positions, obstacles, and placement progress. Your saved API rosters remain available to import again.';
  byId('reset-dialog').querySelector('.reset-confirm').textContent = kind === 'progress' ? 'Reset progress' : 'Clear formation';
  byId('reset-dialog').returnValue = 'cancel';
  byId('reset-dialog').showModal();
}
byId('reset-progress').addEventListener('click', () => requestReset('progress'));
byId('clear-draft').addEventListener('click', () => requestReset('clear'));
byId('reset-dialog').addEventListener('close', () => {
  if (byId('reset-dialog').returnValue !== 'reset') return;
  if (resetKind === 'progress') change(resetTileProgress);
  else {
    draft = { ...DEFAULT_DRAFT };
    mapPadding = 1;
    try { clearWorkspace(window.localStorage); storageStatus('Formation cleared'); showMessage('notice'); }
    catch { storageStatus('Not saved', true); showMessage('notice', 'The formation was cleared on screen, but browser storage is unavailable.'); }
    showMessage('error');
    render();
  }
  syncFields();
  fields.names.focus({ preventScroll: true });
});

function editFormation(kind, from, to, size) { return change(value => moveTile(value, kind, from, to, size)); }
byId('expand-map').addEventListener('click', () => {
  mapPadding += 3;
  render();
  byId('reorder-status').textContent = 'More empty tiles added around the formation.';
});
reorder = setupFormationReorder({ grid: byId('formation-grid'), map: byId('map-scroll'),
  obstacleTools: [...document.querySelectorAll('.obstacle-tool')],
  validate: (kind, from, to, size) => previewGridMove(currentPlan, kind, from, to, size),
  announce: message => { byId('reorder-status').textContent = message; }, onDrop: editFormation });

try {
  const saved = loadWorkspace(window.localStorage);
  draft = migrateTileWorkspace(saved.draft, saved.session);
  if (draft !== saved.draft) persist();
} catch {
  storageStatus('Saved data unavailable', true);
  showMessage('notice', 'The saved plan could not be opened. Start a new plan, or clear the saved formation.');
}
syncFields();
const imported = setupRosterImport({ hasRoster: () => parseManualPlayers(draft.names).length > 0,
  previousPlayers: draft.importedPlayers, previousContext: draft.rosterContext,
  onImport(players, rosterContext) {
    if (draft.tilePlacements?.some(record => record.status === 'placed')) {
      showMessage('error', 'Undo confirmations before replacing the roster.');
      return;
    }
    if (change(value => updateTileDraft(value, { names: players.map(player => player.name).join('\n'),
      importedPlayers: players, orderedPlayers: players, rosterContext }))) {
      syncFields();
      showMessage('notice', `${players.length} players imported. Add bases from the pool or use Auto place, then choose Place on any player.`);
    }
  },
});
if (!draft.rosterContext && imported.previousContext) { draft = { ...draft, rosterContext: imported.previousContext }; persist(); }
render();
