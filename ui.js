import { createSession, applyAction, undoLastAction, getProposal, getFormation } from './placement.js';
import { parseManualPlayers } from './players.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace, clearWorkspace } from './storage.js';

const byId = id => document.getElementById(id);
const fields = { names: byId('players'), x: byId('initial-x'), y: byId('initial-y'), spacing: byId('spacing') };
let draft = { ...DEFAULT_DRAFT };
let session = null;

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

function sessionFromDraft() {
  // Number('') is zero, so reject blank fields before conversion.
  if ([draft.x, draft.y, draft.spacing].some(value => !value.trim())) {
    throw new Error('Enter initial X, initial Y, and spacing.');
  }
  return createSession({
    players: parseManualPlayers(draft.names),
    x0: Number(draft.x), y0: Number(draft.y), spacing: Number(draft.spacing),
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
  byId('map-empty').hidden = Boolean(plan);
  byId('map-scroll').hidden = !plan;
  const grid = byId('formation-grid');
  grid.replaceChildren();
  if (!plan) {
    byId('grid-size').textContent = 'Awaiting roster';
    byId('formation-summary').textContent = 'Columns are fixed when placement starts.';
    return;
  }
  const slots = getFormation(plan);
  grid.style.setProperty('--columns', plan.columns);
  const fragment = document.createDocumentFragment();
  for (const slot of slots) {
    const status = preview ? 'pending' : slot.status;
    const cell = element('li', `slot ${status}`);
    cell.dataset.slotIndex = slot.slotIndex;
    if (status === 'current') cell.setAttribute('aria-current', 'step');
    const top = element('div', 'slot-top');
    top.append(element('span', 'slot-number', String(slot.slotIndex + 1).padStart(2, '0')),
      element('span', 'slot-state', statusLabels[status]));
    cell.append(top,
      element('span', 'slot-name', slot.type === 'obstacle' ? '× Blocked' : slot.name),
      element('span', 'slot-coordinates', `${slot.x}, ${slot.y}`));
    fragment.append(cell);
  }
  grid.append(fragment);
  const rows = Math.ceil(slots.length / plan.columns);
  byId('grid-size').textContent = `${plan.columns} ${plan.columns === 1 ? 'column' : 'columns'} × ${rows} ${rows === 1 ? 'row' : 'rows'}`;
  const blocked = plan.occupants.filter(occupant => occupant.type === 'obstacle').length;
  byId('formation-summary').textContent = preview
    ? 'Preview · Your roster fills each row in order.'
    : `${plan.playerIndex} placed · ${blocked} ${blocked === 1 ? 'obstacle' : 'obstacles'} · ${plan.players.length - plan.playerIndex} remaining`;
}

function renderResults() {
  byId('results-panel').hidden = !session;
  const body = byId('results-body');
  body.replaceChildren();
  if (!session) return;
  const done = !getProposal(session);
  byId('results-title').textContent = done ? 'Final coordinates' : 'Placement log';
  byId('results-count').textContent = `${session.occupants.length} occupied slots`;
  byId('results-empty').hidden = session.occupants.length > 0;
  const fragment = document.createDocumentFragment();
  for (const occupant of session.occupants) {
    const blocked = occupant.type === 'obstacle';
    const row = element('tr', blocked ? 'blocked-row' : '');
    for (const value of [occupant.slotIndex + 1, blocked ? 'Obstacle' : occupant.name, occupant.x, occupant.y]) {
      row.append(element('td', '', String(value)));
    }
    const status = element('td');
    status.append(element('span', 'status-badge', blocked ? '× Blocked' : '✓ Placed'));
    row.append(status);
    fragment.append(row);
  }
  body.append(fragment);
}

function render() {
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
      byId('proposed-x').textContent = proposal.x;
      byId('proposed-y').textContent = proposal.y;
    }
    byId('undo').disabled = session.occupants.length === 0;
    byId('origin-summary').textContent = `${session.origin.x}, ${session.origin.y}`;
    byId('spacing-summary').textContent = `${session.spacing} ${session.spacing === 1 ? 'tile' : 'tiles'} · step ${3 + session.spacing}`;
    byId('columns-summary').textContent = session.columns;
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
  draft = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
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
  for (const [key, input] of Object.entries(fields)) input.value = draft[key];
  clearSavedData();
  showMessage('error');
  render();
});

try {
  ({ draft, session } = loadWorkspace(window.localStorage));
  if (session) storageStatus('Session restored');
} catch {
  storageStatus('Saved data unavailable', true);
  showMessage('notice', 'The saved plan could not be opened. Start a new plan, or clear the saved session.');
}
for (const [key, input] of Object.entries(fields)) input.value = draft[key];
render();
revealCurrentSlot();
