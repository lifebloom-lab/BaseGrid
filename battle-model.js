import { normalizeImportedPlayer, sortPoolPlayers } from './players.js';

export const BATTLE_KEY = 'basegrid.battles.v1';
const zone = (id, name, rect) => ({ id, name, rect });
export const BATTLE_MAPS = {
  canyon: { id: 'canyon', name: 'Canyon Storm', image: 'battle-canyon.png', zones: [
    zone('data-1', 'Data Center I', [.137, .201, .350, .049]),
    zone('data-2', 'Data Center II', [.641, .201, .343, .049]),
    zone('serum-1', 'Serum Factory I', [.020, .385, .258, .058]),
    zone('power', 'Power Tower', [.303, .363, .393, .078]),
    zone('defense-2', 'Defense System II', [.721, .363, .261, .078]),
    zone('defense-1', 'Defense System I', [.020, .565, .258, .071]),
    zone('virus', 'Virus Lab', [.303, .578, .393, .058]),
    zone('serum-2', 'Serum Factory II', [.721, .584, .261, .052]),
    zone('warehouse-1', 'Sample Warehouse I', [.020, .742, .230, .053]),
    zone('warehouse-2', 'Sample Warehouse II', [.272, .742, .220, .053]),
    zone('warehouse-3', 'Sample Warehouse III', [.509, .742, .226, .053]),
    zone('warehouse-4', 'Sample Warehouse IV', [.756, .742, .226, .053]),
  ] },
  desert: { id: 'desert', name: 'Desert Storm', image: 'battle-desert.png', zones: [
    zone('information', 'Information Center', [.234, .158, .217, .024]),
    zone('hospital-4', 'Hospital 4', [.585, .158, .216, .024]),
    zone('arsenal', 'Arsenal', [.399, .302, .217, .025]),
    zone('oil-1', 'Oil Refinery 1', [.071, .357, .216, .026]),
    zone('hospital-2', 'Hospital 2', [.753, .390, .216, .026]),
    zone('silo', 'Nuclear Silo', [.399, .504, .217, .025]),
    zone('hospital-1', 'Hospital 1', [.071, .561, .216, .026]),
    zone('oil-2', 'Oil Refinery 2', [.753, .580, .216, .026]),
    zone('mercenary', 'Mercenary Factory', [.399, .705, .217, .026]),
    zone('hospital-3', 'Hospital 3', [.223, .820, .215, .026]),
    zone('research', 'Research Center', [.592, .820, .216, .026]),
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
  if (!player || typeof player.id !== 'string' || !player.id || typeof player.name !== 'string' || !player.name.trim()) {
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
  const assigned = new Set();
  const assignments = {};
  for (const zone of BATTLE_MAPS[mapId].zones) {
    const list = value.assignments?.[zone.id] ?? [];
    if (!Array.isArray(list)) throw new Error('Invalid team.');
    assignments[zone.id] = list.map(id => {
      if (!ids.has(id) || assigned.has(id)) throw new Error('Invalid or repeated assignment.');
      assigned.add(id);
      return id;
    });
  }
  return { title: typeof value.title === 'string' ? value.title.slice(0, 100) : 'Team A',
    players, assignments };
}

export function loadBattles(storage) {
  const raw = storage.getItem(BATTLE_KEY);
  if (!raw) return { version: 1, selectedMap: 'canyon', playerSort: 'rank', drafts: { canyon: emptyBattle(), desert: emptyBattle() } };
  const saved = JSON.parse(raw);
  if (saved?.version !== 1 || !saved.drafts) throw new Error('The saved battle plans could not be opened.');
  return { version: 1, selectedMap: BATTLE_MAPS[saved.selectedMap] ? saved.selectedMap : 'canyon',
    playerSort: normalizePlayerSort(saved.playerSort),
    drafts: Object.fromEntries(Object.keys(BATTLE_MAPS).map(id => [id, saved.drafts[id] ? normalizeBattle(saved.drafts[id], id) : emptyBattle()])) };
}

export function saveBattles(storage, state) {
  storage.setItem(BATTLE_KEY, JSON.stringify({ version: 1, selectedMap: state.selectedMap,
    playerSort: normalizePlayerSort(state.playerSort),
    drafts: Object.fromEntries(Object.keys(BATTLE_MAPS).map(id => [id, normalizeBattle(state.drafts[id], id)])) }));
}

export function mergeBattlePlayers(plan, incoming) {
  const players = new Map(plan.players.map(player => [player.id, player]));
  for (const player of incoming) players.set(player.id, cleanBattlePlayer(player));
  return { ...plan, players: [...players.values()] };
}

export function playerZone(plan, playerId) {
  return Object.keys(plan.assignments).find(id => plan.assignments[id].includes(playerId)) ?? null;
}

export function assignBattlePlayer(plan, mapId, playerId, zoneId) {
  if (!plan.players.some(player => player.id === playerId)) throw new Error('Choose a player from this roster.');
  if (zoneId !== null && !BATTLE_MAPS[mapId]?.zones.some(zone => zone.id === zoneId)) throw new Error('Choose a zone on this map.');
  if (playerZone(plan, playerId) === zoneId) return plan;
  const assignments = Object.fromEntries(Object.entries(plan.assignments).map(([id, players]) => [id, players.filter(value => value !== playerId)]));
  if (zoneId !== null) assignments[zoneId] = [...(assignments[zoneId] ?? []), playerId];
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

// Fit whole names into equal-width columns. Never truncate an exported name.
export function layoutNames(names, width, height, measure, { maxFont = 38, minFont = 24 } = {}) {
  if (!names.length) return { fontSize: maxFont, items: [], overflow: false };
  const gap = 18;
  for (let font = maxFont; font >= minFont; font -= 2) {
    for (let columns = 1; columns <= Math.min(4, names.length); columns++) {
      const cellWidth = (width - gap * (columns - 1)) / columns;
      if (cellWidth < font * 3 || names.some(name => measure(name, font) > cellWidth)) continue;
      const rows = Math.ceil(names.length / columns);
      const line = font * 1.35;
      if (rows * line > height) continue;
      return { fontSize: font, overflow: false, items: names.map((name, index) => ({ name,
        x: (index % columns) * (cellWidth + gap) + cellWidth / 2,
        y: (height - rows * line) / 2 + Math.floor(index / columns) * line + line / 2 })) };
    }
  }
  return { fontSize: minFont, items: [], overflow: true };
}
