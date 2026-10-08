import { normalizeImportedPlayer, sortPoolPlayers } from './players.js';

export const BATTLE_KEY = 'basegrid.battles.v2';
export const LEGACY_BATTLE_KEY = 'basegrid.battles.v1';
export const ALLIES = Object.freeze({ id: 'battle:allies', name: 'Allies' });
const zone = (id, name, rect) => ({ id, name, rect });
const desertZone = (id, name, label, color, rect, bottom) => ({ id, name, rect, card: { label, color, bottom } });
export const BATTLE_MAPS = {
  canyon: { id: 'canyon', name: 'Canyon Storm', image: 'battle-canyon.png', zones: [
    zone('data-1', 'Data Center I', [.135, .197, .355, .055]),
    zone('data-2', 'Data Center II', [.637, .197, .350, .055]),
    zone('serum-1', 'Serum Factory I', [.020, .385, .258, .058]),
    zone('power', 'Power Tower', [.300, .359, .396, .087]),
    zone('defense-2', 'Defense System II', [.719, .359, .265, .087]),
    zone('defense-1', 'Defense System I', [.020, .560, .258, .080]),
    zone('virus', 'Virus Lab', [.300, .571, .396, .069]),
    zone('serum-2', 'Serum Factory II', [.721, .580, .261, .060]),
    zone('warehouse-1', 'Sample Warehouse I', [.020, .737, .230, .058]),
    zone('warehouse-2', 'Sample Warehouse II', [.272, .737, .220, .058]),
    zone('warehouse-3', 'Sample Warehouse III', [.509, .737, .226, .058]),
    zone('warehouse-4', 'Sample Warehouse IV', [.756, .737, .226, .058]),
  ] },
  desert: { id: 'desert', name: 'Desert Storm', image: 'battle-desert.png', zones: [
    desertZone('information', 'Information Center', 'CENTRO DE INFORMACIÓN', '#2154b6', [.230, .154, .224, .060], .255),
    desertZone('hospital-4', 'Hospital 4', 'HOSPITAL 4', '#bb302d', [.582, .154, .223, .060], .280),
    desertZone('arsenal', 'Arsenal', 'ARSENAL', '#795030', [.395, .299, .224, .060], .393),
    desertZone('oil-1', 'Oil Refinery 1', 'REFINERÍA DE PETROLEO 1', '#25312f', [.067, .355, .224, .060], .478),
    desertZone('hospital-2', 'Hospital 2', 'HOSPITAL 2', '#bb302d', [.749, .388, .223, .060], .482),
    desertZone('silo', 'Nuclear Silo', 'SILO NUCLEAR', '#795030', [.395, .501, .224, .060], .600),
    desertZone('hospital-1', 'Hospital 1', 'HOSPITAL 1', '#bb302d', [.067, .559, .224, .060], .710),
    desertZone('oil-2', 'Oil Refinery 2', 'REFINERÍA DE PETROLEO 2', '#25312f', [.749, .578, .223, .060], .710),
    desertZone('mercenary', 'Mercenary Factory', 'FÁBRICA DE MERCENARIOS', '#795030', [.395, .703, .224, .060], .803),
    desertZone('hospital-3', 'Hospital 3', 'HOSPITAL 3', '#bb302d', [.219, .817, .224, .061], .928),
    desertZone('research', 'Research Center', 'CENTRO DE INVESTIGACIÓN', '#2154b6', [.588, .817, .223, .061], .928),
  ] },
};

export function emptyBattle() { return { title: 'Team A', players: [], assignments: {} }; }

const validPower = value => Number.isSafeInteger(value) && value >= 0;
const normalizePlayerSort = value => ['rank', 'power', 'name'].includes(value) ? value : 'rank';

export function sortBattlePlayers(players, order = 'rank') {
  if (normalizePlayerSort(order) === 'rank') return sortPoolPlayers(players);
  return [...players].sort((a, b) => {
    if (order === 'power') {
      const difference = (validPower(b.power) ? b.power : -1) - (validPower(a.power) ? a.power : -1);
      if (difference) return difference;
    }
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
  });
}

export function cleanBattlePlayer(player) {
  if (!player || typeof player.id !== 'string' || !player.id || player.id === ALLIES.id || typeof player.name !== 'string' || !player.name.trim()) {
    throw new Error('Invalid battle player.');
  }
  const { hqLevel, group } = normalizeImportedPlayer(player);
  return { id: player.id, name: player.name.trim(), hqLevel, group, power: validPower(player.power) ? player.power : null };
}

// Earlier battle drafts omitted power. Fill missing values by stable imported ID
// from locally saved rosters, without changing assignments or adding players.
export function restoreBattlePowers(plan, savedPlayers) {
  const powers = new Map();
  for (const player of savedPlayers) {
    if (player.id?.startsWith('lastwar:') && validPower(player.power) && !powers.has(player.id)) powers.set(player.id, player.power);
  }
  let changed = false;
  const players = plan.players.map(player => {
    if (validPower(player.power) || !powers.has(player.id)) return player;
    changed = true;
    return { ...player, power: powers.get(player.id) };
  });
  return changed ? { ...plan, players } : plan;
}

export function normalizeBattle(value, mapId) {
  if (!BATTLE_MAPS[mapId] || !value || !Array.isArray(value.players)) throw new Error('Invalid battle plan.');
  const players = value.players.map(cleanBattlePlayer);
  const ids = new Set(players.map(player => player.id));
  if (ids.size !== players.length) throw new Error('Duplicate player identity.');
  const assignments = {};
  for (const zone of BATTLE_MAPS[mapId].zones) {
    const assigned = new Set();
    const list = value.assignments?.[zone.id] ?? [];
    if (!Array.isArray(list)) throw new Error('Invalid team.');
    assignments[zone.id] = list.map(id => {
      if ((!ids.has(id) && id !== ALLIES.id) || assigned.has(id)) throw new Error('Invalid or repeated assignment.');
      assigned.add(id);
      return id;
    });
  }
  return { title: typeof value.title === 'string' ? value.title.slice(0, 100) : 'Team A',
    players, assignments };
}

export function emptyBattles() {
  return { version: 2, selectedMap: 'canyon', playerSort: 'rank',
    selectedPlans: Object.fromEntries(Object.keys(BATTLE_MAPS).map(id => [id, 'initial-' + id])),
    plans: Object.fromEntries(Object.keys(BATTLE_MAPS).map(id => [id, [{ id: 'initial-' + id, ...emptyBattle() }]])) };
}

const titleKey = title => title.trim().normalize('NFKC').toLocaleLowerCase('en');
function checkTitle(plans, title, exceptId) {
  const clean = typeof title === 'string' ? title.trim() : '';
  if (!clean) throw new Error('Enter a plan title.');
  if (clean.length > 100) throw new Error('Use 100 characters or fewer.');
  if (plans.some(plan => plan.id !== exceptId && titleKey(plan.title) === titleKey(clean))) {
    throw new Error('A plan with this title already exists for this event. Choose another title.');
  }
  return clean;
}

function normalizeBattles(saved) {
  if (saved?.version !== 2 || !saved.plans) throw new Error('The saved battle plans could not be opened.');
  const ids = new Set();
  const plans = Object.fromEntries(Object.keys(BATTLE_MAPS).map(mapId => {
    if (!Array.isArray(saved.plans[mapId]) || !saved.plans[mapId].length) throw new Error('Missing battle plans.');
    const normalized = [];
    for (const value of saved.plans[mapId]) {
      if (typeof value?.id !== 'string' || !value.id || ids.has(value.id)) throw new Error('Invalid plan identity.');
      ids.add(value.id);
      const title = checkTitle(normalized, value.title);
      normalized.push({ id: value.id, ...normalizeBattle(value, mapId), title });
    }
    return [mapId, normalized];
  }));
  return { version: 2, selectedMap: BATTLE_MAPS[saved.selectedMap] ? saved.selectedMap : 'canyon',
    playerSort: normalizePlayerSort(saved.playerSort), plans,
    selectedPlans: Object.fromEntries(Object.keys(BATTLE_MAPS).map(id => [id,
      plans[id].some(plan => plan.id === saved.selectedPlans?.[id]) ? saved.selectedPlans[id] : plans[id][0].id])) };
}

export function loadBattles(storage) {
  const raw = storage.getItem(BATTLE_KEY);
  if (raw !== null) return normalizeBattles(JSON.parse(raw));
  const legacy = storage.getItem(LEGACY_BATTLE_KEY);
  const state = emptyBattles();
  if (legacy === null) return state;
  const saved = JSON.parse(legacy);
  if (saved?.version !== 1 || !saved.drafts) throw new Error('The saved battle plans could not be opened.');
  state.selectedMap = BATTLE_MAPS[saved.selectedMap] ? saved.selectedMap : 'canyon';
  state.playerSort = normalizePlayerSort(saved.playerSort);
  for (const mapId of Object.keys(BATTLE_MAPS)) {
    const draft = saved.drafts[mapId] ? normalizeBattle(saved.drafts[mapId], mapId) : emptyBattle();
    state.plans[mapId] = [{ id: state.selectedPlans[mapId], ...draft, title: draft.title.trim() || 'Team A' }];
  }
  return state;
}

export function saveBattles(storage, state) {
  // Keep the old single-draft data as a migration backup.
  storage.setItem(BATTLE_KEY, JSON.stringify(normalizeBattles(state)));
}

export function currentBattle(state, mapId = state.selectedMap) {
  return state.plans[mapId].find(plan => plan.id === state.selectedPlans[mapId]);
}

export function selectBattlePlan(state, mapId, planId = state.selectedPlans[mapId]) {
  if (!state.plans[mapId]?.some(plan => plan.id === planId)) throw new Error('This plan could not be found.');
  return { ...state, selectedMap: mapId, selectedPlans: { ...state.selectedPlans, [mapId]: planId } };
}

export function updateBattlePlan(state, next) {
  const mapId = state.selectedMap;
  const id = currentBattle(state).id;
  const title = checkTitle(state.plans[mapId], next.title, id);
  const updated = { id, ...normalizeBattle(next, mapId), title };
  return { ...state, plans: { ...state.plans, [mapId]: state.plans[mapId].map(plan => plan.id === id ? updated : plan) } };
}

export function suggestedBattleTitle(state, duplicate = false) {
  const plans = state.plans[state.selectedMap];
  const taken = title => plans.some(plan => titleKey(plan.title) === titleKey(title));
  const base = duplicate ? currentBattle(state).title.slice(0, 85) + ' (copy)' : 'Team A';
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const title = duplicate ? base + ' ' + n : n <= 26 ? 'Team ' + String.fromCharCode(64 + n) : 'Team ' + n;
    if (!taken(title)) return title;
  }
}

export function createBattlePlan(state, title, { duplicate = false, id = crypto.randomUUID() } = {}) {
  const mapId = state.selectedMap;
  if (!id || Object.values(state.plans).some(plans => plans.some(plan => plan.id === id))) throw new Error('Invalid plan identity.');
  const cleanTitle = checkTitle(state.plans[mapId], title);
  const source = currentBattle(state);
  // Normalization copies players and assignment arrays; copies never share editable data.
  const created = { id, ...normalizeBattle({ ...source, title: cleanTitle, assignments: duplicate ? source.assignments : {} }, mapId) };
  return { ...state, selectedPlans: { ...state.selectedPlans, [mapId]: id },
    plans: { ...state.plans, [mapId]: [...state.plans[mapId], created] } };
}

export function mergeBattlePlayers(plan, incoming) {
  const players = new Map(plan.players.map(player => [player.id, player]));
  for (const player of incoming) players.set(player.id, cleanBattlePlayer(player));
  return { ...plan, players: [...players.values()] };
}

export function playerZone(plan, playerId) {
  return playerZones(plan, playerId)[0] ?? null;
}

export function playerZones(plan, playerId) {
  return Object.keys(plan.assignments).filter(id => plan.assignments[id].includes(playerId));
}

export function battlePlayer(plan, playerId) {
  return playerId === ALLIES.id ? ALLIES : plan.players.find(player => player.id === playerId);
}

export function battleCounts(plan) {
  const ids = Object.values(plan.assignments).flat();
  const unique = new Set(ids);
  const assigned = plan.players.filter(player => unique.has(player.id)).length;
  return { assigned, unassigned: plan.players.length - assigned, placementCount: ids.length,
    alliesZones: playerZones(plan, ALLIES.id).length };
}

// The roster adds another assignment. Moving a map capsule changes only its
// source zone, even when the player also covers other zones.
export function assignBattlePlayer(plan, mapId, playerId, zoneId, sourceZone = null) {
  if (!battlePlayer(plan, playerId)) throw new Error('Choose a player from this roster.');
  for (const id of [zoneId, sourceZone]) {
    if (id !== null && !BATTLE_MAPS[mapId]?.zones.some(zone => zone.id === id)) throw new Error('Choose a zone on this map.');
  }
  if (zoneId === sourceZone) return plan;
  if (sourceZone && !plan.assignments[sourceZone]?.includes(playerId)) return plan;
  if (!sourceZone && plan.assignments[zoneId]?.includes(playerId)) return plan;
  const assignments = { ...plan.assignments };
  if (sourceZone) assignments[sourceZone] = assignments[sourceZone].filter(value => value !== playerId);
  if (zoneId !== null && !assignments[zoneId]?.includes(playerId)) assignments[zoneId] = [...(assignments[zoneId] ?? []), playerId];
  return { ...plan, assignments };
}

export function reorderBattlePlayer(plan, zoneId, playerId, direction) {
  const team = [...(plan.assignments[zoneId] ?? [])];
  const from = team.indexOf(playerId);
  const to = from + direction;
  if (from < 0 || ![-1, 1].includes(direction) || to < 0 || to >= team.length) return plan;
  [team[from], team[to]] = [team[to], team[from]];
  return { ...plan, assignments: { ...plan.assignments, [zoneId]: team } };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function wrapName(name, width, font, measure, wrapping) {
  if (wrapping === 'none') return measure(name, font) <= width ? [name] : null;
  const lines = [];
  let line = '';
  for (const word of name.trim().split(/\s+/u)) {
    const next = line ? line + ' ' + word : word;
    if (measure(next, font) <= width) { line = next; continue; }
    if (line) { lines.push(line); line = ''; }
    if (wrapping === 'words' && measure(word, font) > width) return null;
    for (const { segment } of graphemes.segment(word)) {
      if (measure(segment, font) > width) return null;
      if (line && measure(line + segment, font) > width) { lines.push(line); line = ''; }
      line += segment;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Try all usable column counts and font sizes with whole names first, then wrap
// at spaces. Breaking a long word is a last resort and keeps graphemes intact.
export function layoutNames(names, width, maxHeight, measure, { maxFont = 38, minFont = 24, minHeight = 0, maxColumns = 2 } = {}) {
  if (!names.length) return { fontSize: maxFont, columns: 1, lineHeight: maxFont * 1.24, height: minHeight, items: [], rowDividers: [], overflow: false };
  const gap = 22;
  let requiredHeight = Infinity;
  for (const wrapping of ['none', 'words', 'graphemes']) {
    for (let step = 0; step <= Math.ceil((maxFont - minFont) / 2); step++) {
      const font = Math.max(minFont, maxFont - step * 2);
      const candidates = [];
      for (let columns = 1; columns <= Math.min(maxColumns, names.length); columns++) {
        const cellWidth = (width - gap * (columns - 1)) / columns;
        if (cellWidth < font * 3) continue;
        const wrapped = names.map(name => wrapName(name, cellWidth, font, measure, wrapping));
        if (wrapped.some(lines => !lines)) continue;
        const lineHeight = font * 1.24;
        const rowGap = font * .2;
        const items = [];
        const rowDividers = [];
        let height = 0;
        for (let start = 0; start < names.length; start += columns) {
          if (start) { rowDividers.push(height + rowGap / 2); height += rowGap; }
          const rowHeight = Math.max(...wrapped.slice(start, start + columns).map(lines => lines.length)) * lineHeight;
          for (let column = 0; column < columns && start + column < names.length; column++) {
            const index = start + column;
            items.push({ name: names[index], lines: wrapped[index], width: cellWidth,
              x: column * (cellWidth + gap) + cellWidth / 2,
              y: height + lineHeight / 2, height: wrapped[index].length * lineHeight });
          }
          height += rowHeight;
        }
        requiredHeight = Math.min(requiredHeight, height);
        if (height > maxHeight) continue;
        // Once type needs to shrink, the card has reached its available height.
        // Keep that space as names reflow instead of making the card jump in size.
        const fittedHeight = font < maxFont ? maxHeight : Math.max(height, minHeight);
        const offset = (fittedHeight - height) / 2;
        candidates.push({ fontSize: font, columns, lineHeight, height: fittedHeight, contentHeight: height,
          items: items.map(item => ({ ...item, y: item.y + offset })),
          rowDividers: rowDividers.map(y => y + offset), overflow: false });
      }
      if (candidates.length) {
        // Small teams use a full-width list when possible; larger teams favor the
        // shorter layout, so cards grow only as much as their contents need.
        if (names.length < 4 && candidates[0].columns === 1) return candidates[0];
        return candidates.sort((a, b) => a.contentHeight - b.contentHeight || a.columns - b.columns)[0];
      }
    }
  }
  return { fontSize: minFont, columns: maxColumns, height: maxHeight, items: [], rowDividers: [], overflow: true, requiredHeight };
}

// These bounds are also the drop targets. Desert card limits reserve clear space
// before the next building/label; Canyon names stay inside existing panels.
export function layoutBattleZones(map, plan, width, height, measure) {
  const players = new Map(plan.players.map(player => [player.id, player]));
  players.set(ALLIES.id, ALLIES);
  return map.zones.map(zone => {
    const [rx, ry, rw, rh] = zone.rect;
    const names = (plan.assignments[zone.id] ?? []).map(id => players.get(id)?.name).filter(Boolean);
    const x = rx * width, y = ry * height, w = rw * width;
    const scale = width / 2496;
    const padding = zone.card ? 14 * scale : 8 * scale;
    const headerHeight = zone.card ? 52 * scale : 0;
    const maxHeight = zone.card ? (zone.card.bottom - ry) * height : rh * height;
    const minBodyHeight = Math.max(0, rh * height - headerHeight - padding * 2);
    const text = layoutNames(names, w - padding * 2, maxHeight - headerHeight - padding * 2, measure,
      { maxFont: zone.card ? 36 * scale : 38, minFont: zone.card ? 28 * scale : 24,
        minHeight: minBodyHeight, maxColumns: zone.card ? 2 : 4 });
    const h = headerHeight + padding * 2 + text.height;
    return { ...zone, names, x, y, w, h, headerHeight, padding, text };
  });
}
