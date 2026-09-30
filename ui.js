import { createSession, applyAction, undoLastAction, canUndo, getProposal, getFormation, tileToCoordinate } from './placement.js';
import { parseManualPlayers, playersFromDraft, playerDetails, rosterContextLabels } from './players.js';
import { tileKey, changeDraftFormation, formationCanvas } from './free-formation.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace, clearWorkspace } from './storage.js';
import { setupRosterImport } from './import-ui.js';
import { setupFormationReorder } from './reorder-ui.js';
import { setupPlacementMessages } from './placement-messages.js';

const byId = id => document.getElementById(id);
const fields = { names: byId('players'), x: byId('initial-x'), y: byId('initial-y'), spacing: byId('spacing') };
let draft = { ...DEFAULT_DRAFT };
let session = null;
let reorder = null;
let mapPadding = 1;
const placementMessages = setupPlacementMessages();

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
    saveWorkspace(window.localStorage, draft, session);
    storageStatus('Saved on this device');
  } catch {
    storageStatus('Not saved', true);
    showMessage('notice', 'Browser storage is unavailable or full. You can keep planning, but this session may be lost when you close or refresh the page.');
  }
}

function sessionFromDraft(source = draft) {
  // Number('') is zero, so reject blank fields before conversion.
  if ([source.x, source.y, source.spacing].some(value => !value.trim())) {
    throw new Error('Enter initial X, initial Y, and spacing.');
  }
  return createSession({
    players: playersFromDraft(source),
    plannedObstacles: source.plannedObstacles,
    layout: source.layout,
    x0: Number(source.x), y0: Number(source.y), spacing: Number(source.spacing),
  });
}

const statusLabels = { placed: 'Placed', blocked: 'Obstacle', current: 'Current', pending: 'Upcoming' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderFormation(plan, preview = false) {
  reorder?.cancel();
  const canReorder = preview && Boolean(plan);
  byId('reorder-help').hidden = !canReorder;
  byId('obstacle-tools').hidden = !canReorder;
  byId('add-obstacle').disabled = !canReorder;
  byId('map-empty').hidden = Boolean(plan);
  byId('map-scroll').hidden = !plan;
  const grid = byId('formation-grid');
  grid.replaceChildren();
  if (!plan) {
    byId('grid-size').textContent = 'Awaiting roster';
    byId('formation-summary').textContent = 'Add players to start shaping your formation.';
    return;
  }
  const slots = getFormation(plan);
  const canvas = formationCanvas(plan, slots, preview ? mapPadding : 0);
  const playersById = new Map(plan.players.map(player => [player.id, player]));
  const playerNumbers = new Map(plan.players.map((player, index) => [player.id, index + 1]));
  grid.style.setProperty('--columns', canvas.columns);
  grid.dataset.minColumn = canvas.minColumn;
  grid.dataset.minRow = canvas.minRow;
  grid.dataset.rows = canvas.rows;
  const fragment = document.createDocumentFragment();
  for (const slot of canvas.tiles) {
    const empty = slot.type === 'empty';
    let coordinates;
    try { coordinates = tileToCoordinate(plan, slot); } catch { if (empty) continue; throw new Error('Formation coordinates are out of range.'); }
    const status = empty ? 'empty-slot' : slot.type === 'obstacle' ? 'blocked' : preview ? 'pending' : slot.status;
    const cell = element('li', `slot ${status}`);
    cell.dataset.tile = tileKey(slot);
    cell.dataset.column = slot.column;
    cell.dataset.row = slot.row;
    cell.dataset.x = coordinates.x;
    cell.dataset.y = coordinates.y;
    cell.dataset.kind = slot.type;
    cell.style.gridColumn = String(slot.column - canvas.minColumn + 1);
    cell.style.gridRow = String(slot.row - canvas.minRow + 1);
    if (status === 'current') cell.setAttribute('aria-current', 'step');
    const top = element('div', 'slot-top');
    top.append(element('span', 'slot-number', empty ? 'OPEN' : slot.type === 'obstacle' ? '×' : String(playerNumbers.get(slot.playerId)).padStart(2, '0')));
    if (canReorder) {
      cell.classList.add('slot-reorderable');
      const handle = element('button', empty ? 'slot-drop' : 'slot-move', empty ? '+' : '⠿');
      handle.type = 'button';
      handle.setAttribute('aria-label', `${empty ? 'Empty tile' : `Move ${slot.type === 'obstacle' ? 'obstacle' : slot.name}`}, X ${coordinates.x}, Y ${coordinates.y}`);
      handle.setAttribute('aria-describedby', 'reorder-help');
      if (!empty) handle.setAttribute('aria-pressed', 'false');
      handle.title = empty ? 'Drop a player or obstacle here' : 'Drag to move, or press Space and use the arrow keys';
      top.append(handle);
    } else top.append(element('span', 'slot-state', statusLabels[status]));
    cell.append(top, element('span', 'slot-name', empty ? 'Drop here' : slot.type === 'obstacle' ? '× Blocked' : slot.name));
    const details = playerDetails(playersById.get(slot.playerId), 'R');
    if (details) cell.append(element('span', 'player-details', details));
    if (canReorder && slot.type === 'obstacle') {
      const remove = element('button', 'text-button obstacle-remove', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove obstacle at X ${coordinates.x}, Y ${coordinates.y}`);
      remove.addEventListener('click', () => {
        if (session) return;
        if (!editFormation('obstacle', slot, null)) return;
        byId('add-obstacle').focus({ preventScroll: true });
        byId('reorder-status').textContent = `Obstacle removed at ${coordinates.x}, ${coordinates.y}.`;
      });
      cell.append(remove);
    }
    cell.append(element('span', 'slot-coordinates', `${coordinates.x}, ${coordinates.y}`));
    fragment.append(cell);
  }
  grid.append(fragment);
  byId('grid-size').textContent = `${canvas.columns} columns × ${canvas.rows} rows${preview ? ' · expandable' : ''}`;
  const blocked = slots.filter(occupant => occupant.type === 'obstacle').length;
  byId('formation-summary').textContent = preview
    ? `Preview · ${blocked ? `${blocked} ${blocked === 1 ? 'blocked tile' : 'blocked tiles'} · ` : ''}Empty tiles stay empty. Drag to shape the formation.`
    : `${plan.playerIndex} placed · ${blocked} ${blocked === 1 ? 'obstacle' : 'obstacles'} · ${plan.players.length - plan.playerIndex} remaining`;
}

function renderResults() {
  byId('results-panel').hidden = !session;
  const body = byId('results-body');
  body.replaceChildren();
  if (!session) return;
  const done = !getProposal(session);
  byId('results-title').textContent = done ? 'Final coordinates' : 'Placement log';
  const recorded = getFormation(session).filter(slot => slot.status === 'placed' || slot.type === 'obstacle');
  byId('results-count').textContent = `${recorded.length} occupied slots`;
  byId('results-empty').hidden = recorded.length > 0;
  const fragment = document.createDocumentFragment();
  const playersById = new Map(session.players.map(player => [player.id, player]));
  for (const occupant of recorded) {
    const blocked = occupant.type === 'obstacle';
    const row = element('tr', blocked ? 'blocked-row' : '');
    for (const value of [blocked ? '—' : session.players.findIndex(player => player.id === occupant.playerId) + 1, blocked ? 'Obstacle' : occupant.name, occupant.x, occupant.y]) {
      row.append(element('td', '', String(value)));
    }
    const details = playerDetails(playersById.get(occupant.playerId));
    if (details) row.children[1].append(element('span', 'player-details', details));
    const status = element('td');
    status.append(element('span', 'status-badge', blocked ? '× Blocked' : '✓ Placed'));
    row.append(status);
    fragment.append(row);
  }
  body.append(fragment);
}

function render() {
  placementMessages.render(session ? getProposal(session) : null);
  byId('roster-context').hidden = !draft.importedPlayers?.length;
  const context = rosterContextLabels(draft.rosterContext);
  byId('roster-server').textContent = context.server;
  byId('roster-alliance').textContent = context.alliance;
  byId('setup-panel').hidden = Boolean(session);
  byId('placement-panel').hidden = !session;
  if (!session) {
    const count = parseManualPlayers(draft.names).length;
    byId('player-count').textContent = `${count} ${count === 1 ? 'player' : 'players'}`;
    const spacing = Number(draft.spacing);
    byId('spacing-help').textContent = draft.spacing.trim() && Number.isSafeInteger(spacing) && spacing >= 0
      ? `${spacing} ${spacing === 1 ? 'tile' : 'tiles'} between bases · ${3 + spacing}-coordinate step`
      : 'Spacing is the number of empty tiles between bases.';
    let preview = null;
    try { preview = sessionFromDraft(); } catch { /* Incomplete input is normal while editing. */ }
    renderFormation(preview, true);
  } else {
    const proposal = getProposal(session);
    byId('placement-title').textContent = proposal ? 'Next up' : 'Formation complete';
    const sectionLabel = byId('placement-panel').querySelector('.section-label');
    sectionLabel.replaceChildren(element('span', 'live-dot'), document.createTextNode(proposal ? 'PLACEMENT IN PROGRESS' : 'ALL PLAYERS PLACED'));
    byId('placement-count').textContent = `${session.playerIndex} / ${session.players.length} placed`;
    byId('placement-progress').max = session.players.length;
    byId('placement-progress').value = session.playerIndex;
    byId('proposal').hidden = !proposal;
    byId('placement-panel').querySelector('.placement-actions').hidden = !proposal;
    byId('placement-panel').querySelector('.action-help').hidden = !proposal;
    byId('complete').hidden = Boolean(proposal);
    if (proposal) {
      byId('current-player').textContent = proposal.player.name;
      showMessage('current-player-details', playerDetails(proposal.player));
      byId('proposed-x').textContent = proposal.x;
      byId('proposed-y').textContent = proposal.y;
    }
    byId('undo').disabled = !canUndo(session);
    byId('origin-summary').textContent = `${session.origin.x}, ${session.origin.y}`;
    byId('spacing-summary').textContent = `${session.spacing} ${session.spacing === 1 ? 'tile' : 'tiles'} · step ${3 + session.spacing}`;
    byId('columns-summary').textContent = session.layout ? 'Custom positions' : `${session.columns} columns`;
    renderFormation(session);
  }
  renderResults();
}

/** Scroll only inside the map: mobile action buttons stay under the user's thumb. */
function revealCurrentSlot() {
  const map = byId('map-scroll');
  const cell = byId('formation-grid').querySelector('[aria-current]');
  if (!cell) return;
  const viewport = map.getBoundingClientRect();
  const bounds = cell.getBoundingClientRect();
  if (bounds.right > viewport.right) map.scrollLeft += bounds.right - viewport.right + 20;
  if (bounds.left < viewport.left) map.scrollLeft -= viewport.left - bounds.left + 20;
  if (bounds.bottom > viewport.bottom) map.scrollTop += bounds.bottom - viewport.bottom + 20;
  if (bounds.top < viewport.top) map.scrollTop -= viewport.top - bounds.top + 20;
}

function takeAction(action) {
  if (!session) return;
  try {
    session = action === 'undo' ? undoLastAction(session) : applyAction(session, action);
    showMessage('error');
    persist();
    render();
    revealCurrentSlot();
    if (!getProposal(session)) byId('undo').focus({ preventScroll: true });
  } catch (error) { showMessage('error', error.message); }
}

byId('setup-form').addEventListener('input', () => {
  draft = { ...draft, ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])) };
  showMessage('error');
  persist();
  render();
});

byId('setup-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    session = sessionFromDraft();
    showMessage('error');
    showMessage('notice');
    persist();
    render();
    byId('placed').focus({ preventScroll: true });
  } catch (error) { showMessage('error', error.message); }
});

byId('placed').addEventListener('click', () => takeAction('placed'));
byId('obstacle').addEventListener('click', () => takeAction('obstacle'));
byId('undo').addEventListener('click', () => takeAction('undo'));
byId('reset').addEventListener('click', () => {
  byId('reset-dialog').returnValue = 'cancel';
  byId('reset-dialog').showModal();
});

function clearSavedData() {
  try {
    clearWorkspace(window.localStorage);
    storageStatus('Saved session cleared');
    showMessage('notice');
  } catch {
    storageStatus('Storage unavailable', true);
    showMessage('notice', 'The plan was reset on screen, but browser storage could not be cleared.');
  }
}

byId('reset-dialog').addEventListener('close', () => {
  if (byId('reset-dialog').returnValue !== 'reset') return;
  session = null;
  clearSavedData();
  showMessage('error');
  render();
  byId('players').focus({ preventScroll: true });
});

byId('clear-draft').addEventListener('click', () => {
  draft = { ...DEFAULT_DRAFT };
  session = null;
  mapPadding = 1;
  for (const [key, input] of Object.entries(fields)) input.value = draft[key];
  clearSavedData();
  showMessage('error');
  render();
});

function editFormation(kind, from, to) {
  if (session) return false;
  try {
    const plan = sessionFromDraft();
    const updated = changeDraftFormation(draft, plan, getFormation(plan), kind, from, to);
    sessionFromDraft(updated); // Validate coordinates before replacing the saved plan.
    draft = updated;
    showMessage('error');
    persist();
    render();
    return true;
  } catch (error) {
    showMessage('error', error.message);
    return false;
  }
}

byId('expand-map').addEventListener('click', () => {
  if (session) return;
  mapPadding++;
  render();
  byId('reorder-status').textContent = 'More empty tiles added around the formation.';
});

reorder = setupFormationReorder({
  grid: byId('formation-grid'),
  map: byId('map-scroll'),
  obstacleTool: byId('add-obstacle'),
  announce: message => { byId('reorder-status').textContent = message; },
  onDrop: editFormation,
});

try {
  ({ draft, session } = loadWorkspace(window.localStorage));
  if (session) storageStatus('Session restored');
} catch {
  storageStatus('Saved data unavailable', true);
  showMessage('notice', 'The saved plan could not be opened. Start a new plan, or clear the saved session.');
}
for (const [key, input] of Object.entries(fields)) input.value = draft[key];
const imported = setupRosterImport({
  hasRoster: () => parseManualPlayers(draft.names).length > 0,
  previousPlayers: draft.importedPlayers,
  previousContext: draft.rosterContext,
  onImport(players, rosterContext) {
    if (session) return;
    draft = { ...draft, names: players.map(player => player.name).join('\n'), importedPlayers: players, orderedPlayers: players, rosterContext };
    fields.names.value = draft.names;
    showMessage('error');
    showMessage('notice', `${players.length} players imported. Review the names and placement order, then start your plan.`);
    persist();
    render();
  },
});
if (!draft.rosterContext && imported.previousContext) {
  draft = { ...draft, rosterContext: imported.previousContext };
  persist();
}
render();
revealCurrentSlot();
