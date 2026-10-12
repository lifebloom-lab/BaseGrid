import { BATTLE_KEY, LEGACY_BATTLE_KEY, loadBattles } from './battle-model.js?v=20261012-power';
import { STORAGE_KEY, loadWorkspace } from './storage.js';
import { ROSTER_CACHE_KEY, normalizeRosterLibrary } from './roster-cache.js?v=20261012-update';
import { normalizeImportedPlayer } from './players.js';
import { DATA_IMPORT_KEY, commitDataImport } from './data-transfer.js';

const allianceId = id => typeof id === 'string' && /^[a-f\d]{32}$/i.test(id);

// Refresh statistics only. Names, identities, membership, positions and order
// belong to the user's plan, including members no longer returned by the API.
export function refreshPlayerStats(players, incoming) {
  const byId = new Map(incoming.filter(player => player.id?.startsWith('lastwar:')).map(player => [player.id, player]));
  let changed = false;
  const next = players.map(player => {
    const fresh = byId.get(player.id);
    if (!fresh) return player;
    const stats = {};
    if (Number.isSafeInteger(fresh.power) && fresh.power >= 0) stats.power = fresh.power;
    const { hqLevel, group } = normalizeImportedPlayer(fresh);
    if (hqLevel !== null) stats.hqLevel = hqLevel;
    if (group !== null) { stats.group = group; if ('rank' in player) stats.rank = group; }
    if (Object.entries(stats).every(([key, value]) => player[key] === value)) return player;
    changed = true;
    return { ...player, ...stats };
  });
  return changed ? next : players;
}

export function rosterUpdateSources(players, entries, draft) {
  const known = new Set(players.filter(player => player.id.startsWith('lastwar:')).map(player => player.id));
  const candidates = entries.filter(entry => entry.kind === 'roster' && allianceId(entry.id));
  const context = draft?.rosterContext;
  if (allianceId(context?.allianceId) && !candidates.some(entry => entry.id === context.allianceId)) {
    candidates.push({ kind: 'roster', id: context.allianceId, context,
      label: context.allianceName || 'Alliance ' + context.allianceId.slice(0, 8), data: draft.importedPlayers ?? [] });
  }
  return candidates.map(entry => ({ ...entry, matches: new Set([
    ...entry.data,
    ...(context?.allianceId === entry.id ? draft.importedPlayers ?? [] : []),
  ].filter(player => known.has(player.id)).map(player => player.id)).size }))
    .filter(entry => entry.matches).sort((a, b) => b.matches - a.matches || (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export function readRosterLibrary(storage) {
  const raw = storage.getItem(ROSTER_CACHE_KEY);
  return raw === null ? { version: 1, entries: [] } : normalizeRosterLibrary(JSON.parse(raw));
}

export function prepareRosterUpdate(storage, incoming) {
  // Validation also strips credentials and any unknown provider fields.
  const entry = normalizeRosterLibrary({ version: 1, entries: [{ ...incoming, kind: 'roster', statsUpdatedAt: incoming.savedAt }] }).entries[0];
  if (!allianceId(entry.id)) throw new Error('Choose an imported alliance to update.');
  const before = new Map();
  const read = key => { if (!before.has(key)) before.set(key, storage.getItem(key)); return before.get(key); };
  const source = { getItem: read };
  const changes = new Map();
  const updated = new Set();
  const matched = new Set();
  const incomingIds = new Set(entry.data.map(player => player.id));
  const update = players => {
    const next = refreshPlayerStats(players, entry.data);
    players.forEach((player, index) => {
      if (incomingIds.has(player.id)) matched.add(player.id);
      if (next[index] !== player) updated.add(player.id);
    });
    return next;
  };
  let plansUpdated = 0;
  if (read(BATTLE_KEY) !== null || read(LEGACY_BATTLE_KEY) !== null) {
    const battles = loadBattles(source);
    for (const plans of Object.values(battles.plans)) for (const plan of plans) {
      const players = update(plan.players);
      if (players !== plan.players) { plan.players = players; plansUpdated++; }
    }
    if (plansUpdated) changes.set(BATTLE_KEY, JSON.stringify(battles));
  }
  const workspace = read(STORAGE_KEY);
  if (workspace !== null) {
    loadWorkspace(source); // Reject invalid saved data before changing any key.
    const saved = JSON.parse(workspace);
    let changed = false;
    for (const [owner, key] of [[saved.draft, 'importedPlayers'], [saved.draft, 'orderedPlayers'], [saved.session, 'players']]) {
      if (!owner?.[key]) continue;
      const players = update(owner[key]);
      if (players !== owner[key]) { owner[key] = players; changed = true; }
    }
    if (changed) changes.set(STORAGE_KEY, JSON.stringify(saved));
  }
  const library = readRosterLibrary(source);
  const index = library.entries.findIndex(value => value.kind === 'roster' && value.id === entry.id);
  if (index < 0) library.entries.push(entry); else library.entries[index] = entry;
  changes.set(ROSTER_CACHE_KEY, JSON.stringify(library));
  // Reuse the existing data-change signal so other open planners reload their
  // saved state and cannot autosave old statistics over the refreshed values.
  changes.set(DATA_IMPORT_KEY, crypto.randomUUID());
  for (const key of changes.keys()) read(key);
  return { before, changes, entry, summary: { updated: updated.size, matched: matched.size, plansUpdated } };
}

export function commitRosterUpdate(storage, prepared) {
  return commitDataImport(storage, prepared);
}
