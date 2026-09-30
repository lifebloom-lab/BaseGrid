import { tileToCoordinate } from './placement.js';
import { parseManualPlayers, playerDetails, rosterContextLabels } from './players.js';
import { tileKey, formationCanvas } from './free-formation.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace, clearWorkspace } from './storage.js';
import { getTilePlan, openTilePlacement, confirmTilePlacement, undoTileConfirmation, cancelTilePlacement,
  recordCopiedMessage, moveTile, updateTileDraft, resetTileProgress, migrateTileWorkspace } from './tile-placement.js';
import { setupRosterImport } from './import-ui.js';
import { setupFormationReorder } from './reorder-ui.js';
import { setupPlacementMessages } from './placement-messages.js';

const byId = id => document.getElementById(id);
const fields = { names: byId('players'), x: byId('initial-x'), y: byId('initial-y'), spacing: byId('spacing') };
let draft = { ...DEFAULT_DRAFT };
let reorder = null;
let mapPadding = 1;
let resetKind = 'clear';
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
  for (const id of ['reorder-help', 'obstacle-tools', 'map-scroll']) byId(id).hidden = !plan;
  byId('add-obstacle').disabled = !plan;
  byId('map-empty').hidden = Boolean(plan);
  const grid = byId('formation-grid');
  grid.replaceChildren();
  if (!plan) {
    byId('grid-size').textContent = 'Awaiting roster';
    byId('formation-summary').textContent = 'Add players to start shaping your formation.';
    return;
  }
  const canvas = formationCanvas(plan, plan.slots, mapPadding);
  const playersById = new Map(plan.players.map(player => [player.id, player]));
  const playerNumbers = new Map(plan.players.map((player, index) => [player.id, index + 1]));
  grid.style.setProperty('--columns', canvas.columns);
  Object.assign(grid.dataset, { minColumn: canvas.minColumn, minRow: canvas.minRow, rows: canvas.rows });
  const fragment = document.createDocumentFragment();
  for (const slot of canvas.tiles) {
    const empty = slot.type === 'empty';
    let coordinates;
    try { coordinates = tileToCoordinate(plan, slot); } catch { if (empty) continue; throw new Error('Formation coordinates are out of range.'); }
    const locked = slot.status === 'placed';
    const cell = element('li', `slot ${empty ? 'empty-slot' : slot.status}`);
    Object.assign(cell.dataset, { tile: tileKey(slot), column: slot.column, row: slot.row,
      x: coordinates.x, y: coordinates.y, kind: slot.type, locked: String(locked) });
    if (slot.playerId) cell.dataset.playerId = slot.playerId;
    cell.style.gridColumn = String(slot.column - canvas.minColumn + 1);
    cell.style.gridRow = String(slot.row - canvas.minRow + 1);
    if (slot.playerId && slot.playerId === draft.selectedPlayerId) cell.classList.add('selected');
    const top = element('div', 'slot-top');
    top.append(element('span', 'slot-number', empty ? 'OPEN' : slot.type === 'obstacle' ? '×' : String(playerNumbers.get(slot.playerId)).padStart(2, '0')));
    if (!locked) {
      cell.classList.add('slot-reorderable');
      const handle = element('button', empty ? 'slot-drop' : 'slot-move', empty ? '+' : '⠿');
      handle.type = 'button';
      handle.setAttribute('aria-label', `${empty ? 'Empty tile' : `Move ${slot.type === 'obstacle' ? 'obstacle' : slot.name}`}, X ${coordinates.x}, Y ${coordinates.y}`);
      handle.setAttribute('aria-describedby', 'reorder-help');
      if (!empty) handle.setAttribute('aria-pressed', 'false');
      handle.title = empty ? 'Drop a player or obstacle here' : 'Drag to move, or press Space and use the arrow keys';
      top.append(handle);
    } else top.append(element('span', 'slot-state', '✓ Placed'));
    cell.append(top, element('span', 'slot-name', empty ? 'Drop here' : slot.type === 'obstacle' ? '× Blocked' : slot.name));
    const details = playerDetails(playersById.get(slot.playerId), 'R');
    if (details) cell.append(element('span', 'player-details', details));
    cell.append(element('span', 'slot-coordinates', `${coordinates.x}, ${coordinates.y}`));
    if (slot.type === 'player') {
      if (slot.status === 'in-progress') cell.append(element('span', 'slot-state', slot.messageChanged ? '↻ Update message' : 'In progress'));
      const action = element('button', 'tile-action', locked ? 'View' : slot.status === 'in-progress' ? 'Continue' : 'Place');
      action.type = 'button';
      action.setAttribute('aria-label', `${locked ? 'View placement for' : slot.status === 'in-progress' ? 'Continue placing' : 'Place'} ${slot.name}`);
      action.addEventListener('click', () => {
        if (change(value => openTilePlacement(value, slot.playerId), 'player-message-title')) {
          if (window.matchMedia('(max-width: 760px)').matches) byId('player-message-panel').scrollIntoView({ block: 'start' });
        }
      });
      cell.append(action);
    }
    if (slot.type === 'obstacle') {
      const remove = element('button', 'text-button obstacle-remove', 'Remove');
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
  byId('grid-size').textContent = `${canvas.columns} columns × ${canvas.rows} rows · expandable`;
  const blocked = plan.slots.filter(slot => slot.type === 'obstacle').length;
  byId('formation-summary').textContent = `${blocked} ${blocked === 1 ? 'obstacle' : 'obstacles'} · Confirmed bases stay locked. Empty tiles stay empty.`;
}

function renderResults(plan) {
  const recorded = plan?.slots.filter(slot => slot.status === 'placed' || slot.type === 'obstacle') ?? [];
  byId('results-panel').hidden = !recorded.length;
  const body = byId('results-body');
  body.replaceChildren();
  if (!recorded.length) return;
  byId('results-title').textContent = recorded.filter(slot => slot.type === 'player').length === plan.players.length ? 'Final coordinates' : 'Confirmed coordinates';
  byId('results-count').textContent = `${recorded.length} occupied ${recorded.length === 1 ? 'tile' : 'tiles'}`;
  byId('results-empty').hidden = true;
  for (const occupant of recorded) {
    const blocked = occupant.type === 'obstacle';
    const row = element('tr', blocked ? 'blocked-row' : '');
    const playerIndex = plan.players.findIndex(player => player.id === occupant.playerId);
    for (const value of [blocked ? '—' : playerIndex + 1, blocked ? 'Obstacle' : occupant.name, occupant.x, occupant.y]) row.append(element('td', '', String(value)));
    const details = playerDetails(plan.players[playerIndex], 'R');
    if (details) row.children[1].append(element('span', 'player-details', details));
    const status = element('td');
    status.append(element('span', 'status-badge', blocked ? '× Blocked' : '✓ Placed'));
    row.append(status);
    body.append(row);
  }
}

function render() {
  let plan = null;
  try { plan = getTilePlan(draft); } catch { /* Incomplete input is normal while editing. */ }
  const selected = plan?.slots.find(slot => slot.playerId === draft.selectedPlayerId);
  const player = selected && plan.players.find(item => item.id === selected.playerId);
  placementMessages.render(selected ? { player, x: selected.x, y: selected.y } : null);
  byId('setup-panel').hidden = Boolean(selected);
  if (selected) {
    const placed = selected.status === 'placed';
    byId('player-message-title').textContent = player.name;
    byId('selected-status').textContent = placed ? '✓ PLACED · LOCKED' : 'IN PROGRESS';
    byId('selected-details').textContent = playerDetails(player, 'R');
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
    ? `${spacing} ${spacing === 1 ? 'tile' : 'tiles'} between bases · ${3 + spacing}-coordinate step`
    : 'Spacing is the number of empty tiles between bases.';
  renderFormation(plan);
  renderResults(plan);
}

byId('setup-form').addEventListener('submit', event => event.preventDefault());
byId('setup-form').addEventListener('input', () => {
  const patch = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
  if (!change(value => updateTileDraft(value, patch))) syncFields();
});
function syncFields() { for (const [key, input] of Object.entries(fields)) input.value = draft[key]; }

byId('close-placement').addEventListener('click', () => change(value => ({ ...value, selectedPlayerId: null }), 'setup-title'));
byId('confirm-placement').addEventListener('click', () => change(value => confirmTilePlacement(value, value.selectedPlayerId), 'undo-confirmation'));
byId('undo-confirmation').addEventListener('click', () => change(value => undoTileConfirmation(value, value.selectedPlayerId), 'confirm-placement'));
byId('cancel-placement').addEventListener('click', () => change(value => cancelTilePlacement(value, value.selectedPlayerId), 'setup-title'));

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

function editFormation(kind, from, to) { return change(value => moveTile(value, kind, from, to)); }
byId('expand-map').addEventListener('click', () => {
  mapPadding++;
  render();
  byId('reorder-status').textContent = 'More empty tiles added around the formation.';
});
reorder = setupFormationReorder({ grid: byId('formation-grid'), map: byId('map-scroll'), obstacleTool: byId('add-obstacle'),
  announce: message => { byId('reorder-status').textContent = message; }, onDrop: editFormation });

try {
  const saved = loadWorkspace(window.localStorage);
  draft = migrateTileWorkspace(saved.draft, saved.session);
  if (saved.session) persist();
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
      showMessage('notice', `${players.length} players imported. Arrange the formation, then choose Place on any player.`);
    }
  },
});
if (!draft.rosterContext && imported.previousContext) { draft = { ...draft, rosterContext: imported.previousContext }; persist(); }
render();
