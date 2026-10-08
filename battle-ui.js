import { BATTLE_MAPS, emptyBattle, loadBattles, saveBattles, mergeBattlePlayers, restoreBattlePowers, sortBattlePlayers, assignBattlePlayer, reorderBattlePlayer, playerZone } from './battle-model.js';
import { drawBattle } from './battle-render.js';
import { loadWorkspace } from './storage.js';
import { playersFromDraft } from './players.js';
import { createRosterCache } from './roster-cache.js';

const compactPower = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const exactPower = new Intl.NumberFormat('en');

const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
let state = { version: 1, selectedMap: 'canyon', playerSort: 'rank', drafts: { canyon: emptyBattle(), desert: emptyBattle() } };
let storageReady = true;
try { state = loadBattles(window.localStorage); }
catch { storageReady = false; showError('Saved battle plans could not be opened. Changes will stay in this tab only; the existing saved data is preserved.'); }
const plan = () => state.drafts[state.selectedMap];
const map = () => BATTLE_MAPS[state.selectedMap];
const history = { canyon: [], desert: [] };
let selectedPlayer = null;
let selectedZone = map().zones[0].id;
let poolOnly = true;
let drag = null;
let dragFrame = null;
let suppressDragClick = false;
let lastDraw = null;
let renderVersion = 0;
let exportUrl = null;
const images = new Map();

function showError(message = '') { $('battle-error').textContent = message; $('battle-error').hidden = !message; }
function announce(message) { $('battle-status').textContent = message; }
function persist() {
  if (!storageReady) { $('battle-save').textContent = 'Kept in this tab only'; return; }
  try { saveBattles(window.localStorage, state); $('battle-save').textContent = 'Saved on this device'; }
  catch { $('battle-save').textContent = 'Not saved · keep this tab open'; showError('Browser storage is unavailable or full. Keep this tab open and export your plan before leaving.'); }
}
function change(next, message) {
  if (next === plan()) return;
  history[state.selectedMap].push(structuredClone(plan()));
  if (history[state.selectedMap].length > 30) history[state.selectedMap].shift();
  state.drafts[state.selectedMap] = next;
  persist(); render();
  if (message) announce(message);
}
function syncSettings() {
  $('battle-map').value = state.selectedMap;
  $('battle-title').value = plan().title;
  $('battle-sort').value = state.playerSort;
}
function getImage(template) {
  if (!images.has(template.id)) images.set(template.id, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { images.delete(template.id); reject(new Error('The map image could not load. Refresh to try again.')); };
    image.src = template.image;
  }));
  return images.get(template.id);
}
function sourcePlayers() {
  try { return playersFromDraft(loadWorkspace(window.localStorage).draft); }
  catch { return []; }
}
function renderSource() {
  const count = sourcePlayers().length;
  $('battle-copy-roster').disabled = !count;
  $('battle-copy-roster').textContent = count ? 'Use BaseGrid roster · ' + count : 'No saved BaseGrid roster';
  $('battle-roster-help').textContent = count ? 'Copies players into this battle. No API calls.' : 'Add names here, or load a roster in BaseGrid at this same address.';
}
function selection() {
  const player = plan().players.find(player => player.id === selectedPlayer);
  if (!player) selectedPlayer = null;
  $('battle-selection').hidden = !player;
  $('battle-selection-name').textContent = player ? player.name + ' selected — choose a zone' : '';
  document.querySelectorAll('.battle-chip-name').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.playerId === selectedPlayer)));
}
function choosePlayer(id) {
  selectedPlayer = selectedPlayer === id ? null : id;
  renderPlayers(); renderTeam(); selection();
  if (selectedPlayer) announce('Choose a zone for ' + plan().players.find(player => player.id === id).name + '.');
  else announce('Selection cancelled.');
  if (selectedPlayer && window.matchMedia('(max-width:650px)').matches) $('battle-map-scroll').scrollIntoView({ block: 'center' });
}
function assign(id, zoneId) {
  const player = plan().players.find(player => player.id === id);
  if (!player) return;
  try {
    const next = assignBattlePlayer(plan(), state.selectedMap, id, zoneId);
    selectedPlayer = null;
    if (zoneId) selectedZone = zoneId;
    if (next === plan()) { selection(); renderPlayers(); renderTeam(); announce('Assignment unchanged.'); return; }
    change(next, player.name + (zoneId ? ' assigned to ' + map().zones.find(zone => zone.id === zoneId).name + '.' : ' returned to the pool.'));
  } catch (error) { showError(error.message); }
}
function playerButton(player) {
  const button = make('button', 'battle-player');
  button.type = 'button';
  button.dataset.playerId = player.id;
  button.setAttribute('aria-pressed', String(selectedPlayer === player.id));
  button.setAttribute('aria-label', 'Select ' + player.name);
  const grip = make('span', 'battle-drag-grip', '⠿'); grip.setAttribute('aria-hidden', 'true'); grip.title = 'Drag to assign';
  button.append(grip, make('span', 'battle-player-name', player.name));
  const meta = make('span', 'battle-player-meta');
  if (player.hqLevel) meta.append(make('span', '', 'HQ ' + player.hqLevel));
  if (player.group) { const badge = make('span', 'rank-badge', 'R' + player.group); badge.dataset.rank = player.group; meta.append(badge); }
  if (player.power !== null && player.power !== undefined) {
    const power = make('span', 'battle-player-power', 'Power ' + compactPower.format(player.power));
    power.title = 'Power ' + exactPower.format(player.power);
    button.setAttribute('aria-description', power.title);
    meta.append(power);
  }
  if (meta.children.length) button.append(meta);
  const zoneId = playerZone(plan(), player.id);
  button.append(make('span', 'battle-player-location', map().zones.find(zone => zone.id === zoneId)?.name ?? 'Unassigned'));
  button.addEventListener('click', () => choosePlayer(player.id));
  return button;
}
function clearDropTargets() { document.querySelectorAll('.drop-target').forEach(node => node.classList.remove('drop-target')); }
function dragTarget(x, y) { return document.elementFromPoint(x, y)?.closest('.battle-zone, #battle-pool'); }
function cancelDrag() {
  if (!drag) return;
  drag.ghost?.remove(); drag.source.classList.remove('battle-drag-source');
  if (document.body.hasPointerCapture(drag.pointerId)) document.body.releasePointerCapture(drag.pointerId);
  drag = null; cancelAnimationFrame(dragFrame); dragFrame = null; clearDropTargets();
}
function animateDrag() {
  if (!drag?.active) return;
  const viewport = $('battle-map-scroll');
  const rect = viewport.getBoundingClientRect();
  const speed = (point, low, high) => point < low + 24 ? -8 : point > high - 24 ? 8 : 0;
  if (drag.x >= rect.left && drag.x <= rect.right && drag.y >= rect.top && drag.y <= rect.bottom) {
    viewport.scrollBy(speed(drag.x, rect.left, rect.right), speed(drag.y, rect.top, rect.bottom));
  } else window.scrollBy(0, speed(drag.y, 0, window.innerHeight));
  drag.ghost.style.left = drag.x + 14 + 'px'; drag.ghost.style.top = drag.y + 14 + 'px';
  clearDropTargets(); dragTarget(drag.x, drag.y)?.classList.add('drop-target');
  dragFrame = requestAnimationFrame(animateDrag);
}
document.addEventListener('pointerdown', event => {
  suppressDragClick = false;
  const source = event.target.closest('.battle-player, .battle-chip-name');
  if (!source || event.button !== 0 || !event.isPrimary || (event.pointerType === 'touch' && !source.matches('.battle-chip-name') && !event.target.closest('.battle-drag-grip'))) return;
  cancelDrag();
  drag = { source, id: source.dataset.playerId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
});
document.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX; drag.y = event.clientY;
  if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 8) {
    drag.active = true; document.body.setPointerCapture(drag.pointerId);
    drag.source.classList.add('battle-drag-source');
    drag.ghost = make('div', 'battle-drag-ghost', plan().players.find(player => player.id === drag.id).name);
    document.body.append(drag.ghost); animateDrag();
  }
  if (drag.active) event.preventDefault();
});
document.addEventListener('pointerup', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { id, active } = drag;
  const target = active ? dragTarget(event.clientX, event.clientY) : null;
  cancelDrag();
  if (!active) return;
  suppressDragClick = true;
  if (target) assign(id, target.dataset.zone ?? null); else announce('Move cancelled. Assignments unchanged.');
});
document.addEventListener('pointercancel', cancelDrag);
document.addEventListener('click', event => { if (suppressDragClick) { suppressDragClick = false; event.preventDefault(); event.stopPropagation(); } }, true);

function renderPlayers() {
  const roster = plan().players;
  const unassigned = roster.filter(player => playerZone(plan(), player.id) === null);
  const query = $('battle-search').value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  const players = sortBattlePlayers(poolOnly ? unassigned : roster, state.playerSort).filter(player => player.name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(query));
  $('battle-player-count').textContent = roster.length + ' players';
  $('battle-unassigned-count').textContent = unassigned.length;
  $('battle-unassigned-tab').setAttribute('aria-pressed', String(poolOnly));
  $('battle-all-tab').setAttribute('aria-pressed', String(!poolOnly));
  $('battle-player-list').replaceChildren(...players.map(player => { const li = make('li'); li.append(playerButton(player)); return li; }));
  $('battle-pool-empty').hidden = Boolean(players.length);
  $('battle-pool-empty').textContent = query ? 'No matching players.' : !roster.length ? 'Add your players to get started.' : 'Everyone is assigned. Choose All players to reassign.';
}
function renderTeam() {
  const zone = map().zones.find(zone => zone.id === selectedZone) ?? map().zones[0];
  selectedZone = zone.id;
  const ids = plan().assignments[zone.id] ?? [];
  $('battle-zone-title').textContent = zone.name;
  $('battle-zone-count').textContent = ids.length + ' assigned';
  const select = $('battle-zone-select');
  select.replaceChildren(...map().zones.map(zone => { const option = make('option', '', zone.name); option.value = zone.id; return option; }));
  select.value = zone.id;
  $('battle-team-help').textContent = ids.length ? 'Drag to reassign. Use × to return a player to the pool.' : 'This team is empty. Select a player, then choose this zone on the map.';
  $('battle-team-list').replaceChildren(...ids.map((id, index) => {
    const player = plan().players.find(player => player.id === id);
    const row = make('li'); row.append(playerButton(player));
    const actions = make('div', 'battle-team-actions');
    for (const [label, text, disabled, action] of [
      ['Move ' + player.name + ' up', '↑', index === 0, () => change(reorderBattlePlayer(plan(), zone.id, id, -1))],
      ['Move ' + player.name + ' down', '↓', index === ids.length - 1, () => change(reorderBattlePlayer(plan(), zone.id, id, 1))],
      ['Return ' + player.name + ' to pool', '×', false, () => assign(id, null)],
    ]) { const button = make('button', '', text); button.type = 'button'; button.disabled = disabled; button.setAttribute('aria-label', label); button.title = label; button.addEventListener('click', action); actions.append(button); }
    row.append(actions); return row;
  }));
  for (const button of $('battle-zones').children) button.classList.toggle('active', button.dataset.zone === zone.id);
}

function zoneControl(zone, canvas, snapshot) {
  const container = make('div', 'battle-zone');
  container.dataset.zone = zone.id;
  container.setAttribute('role', 'group'); container.setAttribute('aria-label', zone.name + ' team');
  container.style.left = zone.x / canvas.width * 100 + '%';
  container.style.top = (zone.y + zone.headerHeight) / canvas.height * 100 + '%';
  container.style.width = zone.w / canvas.width * 100 + '%';
  container.style.height = (zone.h - zone.headerHeight) / canvas.height * 100 + '%';
  container.classList.toggle('active', zone.id === selectedZone);
  container.classList.toggle('crowded', zone.text.overflow);
  const target = make('button', 'battle-zone-target'); target.type = 'button';
  target.setAttribute('aria-label', zone.name + ', ' + zone.names.length + ' assigned');
  target.title = zone.name + ' · Select team or drop names here';
  if (!zone.names.length) target.append(make('span', 'zone-placeholder', '+ Names'));
  container.append(target);
  container.addEventListener('click', event => {
    if (event.target.closest('.battle-chip')) return;
    if (selectedPlayer) assign(selectedPlayer, zone.id);
    else { selectedZone = zone.id; renderTeam(); announce(zone.name + ' · ' + zone.names.length + ' assigned.'); }
  });
  if (zone.names.length) {
    const list = make('ul', 'battle-zone-players'); list.setAttribute('aria-label', 'Players in ' + zone.name);
    for (const id of snapshot.assignments[zone.id] ?? []) {
      const player = snapshot.players.find(player => player.id === id);
      if (!player) continue;
      const chip = make('li', 'battle-chip');
      const name = make('button', 'battle-chip-name', player.name); name.type = 'button';
      name.dataset.playerId = id; name.setAttribute('aria-label', 'Select ' + player.name);
      name.setAttribute('aria-pressed', String(selectedPlayer === id)); name.title = player.name + ' · Drag or select to move';
      name.addEventListener('click', () => choosePlayer(id));
      const remove = make('button', 'battle-chip-remove'); remove.type = 'button'; remove.dataset.playerId = id;
      const label = 'Return ' + player.name + ' to pool'; remove.setAttribute('aria-label', label); remove.title = label;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true', focusable: 'false' })) icon.setAttribute(key, value);
      const circle = document.createElementNS(icon.namespaceURI, 'circle');
      circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9');
      const cross = document.createElementNS(icon.namespaceURI, 'path'); cross.setAttribute('d', 'M9 9l6 6M15 9l-6 6');
      icon.append(circle, cross); remove.append(icon);
      remove.addEventListener('click', () => assign(id, null));
      chip.append(name, remove); list.append(chip);
    }
    container.append(list);
  }
  return container;
}

async function renderMap() {
  const version = ++renderVersion;
  const template = map();
  const snapshot = structuredClone(plan());
  const focused = document.activeElement;
  const focusZone = focused.closest('.battle-zone')?.dataset.zone;
  const focusClass = focused.matches('.battle-chip-remove') ? 'battle-chip-remove' : 'battle-chip-name';
  const focusIndex = focusZone ? [...focused.closest('.battle-zone').querySelectorAll('.' + focusClass)].indexOf(focused) : -1;
  const zoneScroll = new Map([...$('battle-zones').children].map(zone => [zone.dataset.zone, zone.querySelector('.battle-zone-players')?.scrollTop ?? 0]));
  $('battle-export').disabled = true;
  $('battle-map-stage').setAttribute('aria-busy', 'true');
  try {
    const image = await getImage(template);
    if (version !== renderVersion) return;
    lastDraw = drawBattle(template, snapshot, image, { editing: true });
    const canvas = $('battle-canvas');
    canvas.width = lastDraw.canvas.width; canvas.height = lastDraw.canvas.height;
    canvas.getContext('2d').drawImage(lastDraw.canvas, 0, 0);
    $('battle-zones').replaceChildren(...lastDraw.zones.map(zone => zoneControl(zone, canvas, snapshot)));
    for (const zone of $('battle-zones').children) {
      const list = zone.querySelector('.battle-zone-players');
      if (list) list.scrollTop = zoneScroll.get(zone.dataset.zone) ?? 0;
    }
    if (focusZone && document.activeElement === document.body) {
      const zone = [...$('battle-zones').children].find(node => node.dataset.zone === focusZone);
      const buttons = [...(zone?.querySelectorAll('.' + focusClass) ?? [])];
      const next = buttons.find(button => button.dataset.playerId === focused.dataset.playerId) ?? buttons[Math.min(focusIndex, buttons.length - 1)] ?? zone?.querySelector('.battle-zone-target');
      next?.focus({ preventScroll: true });
    }
    $('battle-overflow').hidden = !lastDraw.overflow.length;
    $('battle-overflow-text').textContent = 'Names need more room in ' + lastDraw.overflow.map(zone => zone.name).join(', ') + '. Move some players to another zone before exporting.';
    $('battle-export').disabled = !lastDraw.assigned || Boolean(lastDraw.overflow.length);
  } catch (error) { if (version === renderVersion) { showError(error.message); lastDraw = null; } }
  finally { if (version === renderVersion) $('battle-map-stage').setAttribute('aria-busy', 'false'); }
}
function render() {
  $('battle-map-name').textContent = map().name;
  $('battle-progress').textContent = plan().players.filter(player => playerZone(plan(), player.id) !== null).length + ' assigned · ' + plan().players.filter(player => playerZone(plan(), player.id) === null).length + ' unassigned';
  $('battle-undo').disabled = !history[state.selectedMap].length;
  $('battle-reset').disabled = !Object.values(plan().assignments).some(ids => ids.length);
  renderPlayers(); renderTeam(); selection(); renderMap();
}

$('battle-map').addEventListener('change', () => {
  state.selectedMap = $('battle-map').value;
  selectedPlayer = null; cancelDrag(); selectedZone = map().zones[0].id; lastDraw = null;
  $('battle-search').value = ''; $('battle-map-scroll').scrollTo(0, 0);
  $('battle-zones').replaceChildren(); $('battle-canvas').width = 0;
  syncSettings(); persist(); render(); announce('Opened your ' + map().name + ' draft.');
});
$('battle-title').addEventListener('input', () => { state.drafts[state.selectedMap] = { ...plan(), title: $('battle-title').value }; persist(); renderMap(); });
$('battle-search').addEventListener('input', renderPlayers);
$('battle-sort').addEventListener('change', () => {
  state.playerSort = $('battle-sort').value;
  persist(); renderPlayers();
});
$('battle-unassigned-tab').addEventListener('click', () => { poolOnly = true; renderPlayers(); });
$('battle-all-tab').addEventListener('click', () => { poolOnly = false; renderPlayers(); });
$('battle-zone-select').addEventListener('change', () => {
  selectedZone = $('battle-zone-select').value;
  if (selectedPlayer) assign(selectedPlayer, selectedZone); else renderTeam();
});
$('battle-cancel-selection').addEventListener('click', () => { selectedPlayer = null; renderPlayers(); renderTeam(); selection(); announce('Selection cancelled.'); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (drag) { event.preventDefault(); cancelDrag(); announce('Move cancelled.'); }
  else if (selectedPlayer && !document.querySelector('dialog[open]')) { event.preventDefault(); $('battle-cancel-selection').click(); }
});
$('battle-zoom').addEventListener('click', () => {
  const enlarged = $('battle-map-stage').classList.toggle('enlarged');
  $('battle-zoom').setAttribute('aria-pressed', String(enlarged));
  $('battle-zoom').textContent = enlarged ? 'Fit map' : 'Enlarge map';
});
$('battle-copy-roster').addEventListener('click', () => {
  const players = sourcePlayers();
  if (!players.length) { renderSource(); return; }
  change(mergeBattlePlayers(plan(), players), 'BaseGrid roster copied. Existing battle assignments are kept.');
});
$('battle-add-names').addEventListener('click', () => { $('battle-names').value = ''; $('battle-names-dialog').showModal(); $('battle-names').focus(); });
$('battle-names-cancel').addEventListener('click', () => $('battle-names-dialog').close());
$('battle-names-form').addEventListener('submit', event => {
  event.preventDefault();
  const names = $('battle-names').value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (!names.length) { $('battle-names').focus(); return; }
  change(mergeBattlePlayers(plan(), names.map(name => ({ id: 'battle:' + crypto.randomUUID(), name }))), names.length + ' players added to this battle.');
  $('battle-names-dialog').close();
});
$('battle-undo').addEventListener('click', () => {
  const previous = history[state.selectedMap].pop();
  if (!previous) return;
  state.drafts[state.selectedMap] = previous; selectedPlayer = null;
  syncSettings(); persist(); render(); announce('Last change undone.');
});
$('battle-reset').addEventListener('click', () => { $('battle-reset-dialog').returnValue = 'cancel'; $('battle-reset-dialog').showModal(); });
$('battle-reset-dialog').addEventListener('close', () => {
  if ($('battle-reset-dialog').returnValue === 'clear') { selectedPlayer = null; change({ ...plan(), assignments: {} }, 'Assignments cleared. All players are back in the pool.'); }
});
$('battle-export').addEventListener('click', async () => {
  if (!lastDraw || lastDraw.overflow.length || !lastDraw.assigned) return;
  const template = map(); const snapshot = structuredClone(plan());
  const button = $('battle-export'); button.disabled = true; button.textContent = 'Preparing PNG…'; button.setAttribute('aria-busy', 'true');
  try {
    const drawing = drawBattle(template, snapshot, await getImage(template));
    const blob = await new Promise((resolve, reject) => drawing.canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not create the PNG.')), 'image/png'));
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(blob);
    $('battle-export-image').src = exportUrl;
    $('battle-download').href = exportUrl;
    $('battle-download').download = 'basegrid-' + template.id + '-' + new Date().toISOString().slice(0, 10) + '.png';
    const missing = snapshot.players.length - drawing.assigned;
    $('battle-export-summary').textContent = drawing.canvas.width + ' × ' + drawing.canvas.height + ' PNG · ' + drawing.assigned + ' assigned' + (missing ? ' · ' + missing + ' unassigned players are not shown' : ' · Everyone included');
    $('battle-export-dialog').showModal();
  } catch (error) { showError(error.message || 'Could not create the PNG. Please try again.'); }
  finally { button.textContent = 'Preview & export PNG'; button.disabled = !lastDraw?.assigned || Boolean(lastDraw?.overflow.length); button.removeAttribute('aria-busy'); }
});
$('battle-export-close').addEventListener('click', () => $('battle-export-dialog').close());
$('battle-export-dialog').addEventListener('close', () => {
  $('battle-export-image').removeAttribute('src'); $('battle-download').removeAttribute('href');
  if (exportUrl) URL.revokeObjectURL(exportUrl); exportUrl = null;
});
window.addEventListener('focus', renderSource);
const savedPlayers = [...sourcePlayers(), ...createRosterCache().listRosters().flatMap(roster => roster.data)];
for (const id of Object.keys(BATTLE_MAPS)) state.drafts[id] = restoreBattlePowers(state.drafts[id], savedPlayers);
syncSettings(); renderSource(); persist(); render();
