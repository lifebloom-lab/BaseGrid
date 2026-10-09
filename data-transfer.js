import { BATTLE_KEY, LEGACY_BATTLE_KEY, BATTLE_MAPS, emptyBattles, loadBattles, normalizeBattles } from './battle-model.js?v=2';
import { STORAGE_KEY, DEFAULT_DRAFT, loadWorkspace } from './storage.js';
import { ROSTER_CACHE_KEY, normalizeRosterLibrary } from './roster-cache.js?v=2';
import { serializeSession } from './placement.js';
import { MESSAGE_LANGUAGE_KEY, MESSAGE_LANGUAGES } from './placement-messages.js';

export const DATA_IMPORT_KEY = 'basegrid.data-import.v1';
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const ZOOM_KEY = 'basegrid.map-zoom.v1';
const FORMAT = 'basegrid-backup';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => own(value, key)).map(key => [key, value[key]]));

function cleanPlayer(player) {
  if (!player || typeof player.id !== 'string' || !player.id.trim() || typeof player.name !== 'string' || !player.name.trim()) throw new Error('Invalid player in formation.');
  const clean = { id: player.id, name: player.name };
  for (const key of ['hqLevel', 'group', 'rank', 'power', 'serverId', 'x', 'y']) {
    if (player[key] === null || Number.isSafeInteger(player[key])) clean[key] = player[key];
  }
  return clean;
}

// Copy known fields only. Local drafts may contain additional application data;
// none of that, nor arbitrary fields supplied in a file, belongs in a backup.
function cleanWorkspace(value) {
  if (value === null) return null;
  if (value?.version !== 1 || !value.draft) throw new Error('Invalid formation in data file.');
  const draft = pick(value.draft, [...Object.keys(DEFAULT_DRAFT), 'setupMethod', 'importedPlayers', 'orderedPlayers',
    'rosterContext', 'layout', 'plannedObstacles', 'tilePlacements', 'selectedPlayerId']);
  for (const key of ['importedPlayers', 'orderedPlayers']) {
    if (own(draft, key)) {
      if (!Array.isArray(draft[key])) throw new Error('Invalid formation roster.');
      draft[key] = draft[key].map(cleanPlayer);
    }
  }
  if (!['manual', 'import'].includes(draft.setupMethod)) delete draft.setupMethod;
  let session = value.session;
  if (session !== null) {
    if (!session || !Array.isArray(session.players)) throw new Error('Invalid formation session.');
    session = { ...pick(session, ['version', 'x0', 'y0', 'spacing', 'plannedObstacles', 'layout', 'actions']), players: session.players.map(cleanPlayer) };
  }
  const clean = loadWorkspace({ getItem: () => JSON.stringify({ version: 1, draft, session }) });
  return { version: 1, draft: clean.draft, session: clean.session ? serializeSession(clean.session) : null };
}

function cleanPreferences(value = {}) {
  const clean = {};
  if (MESSAGE_LANGUAGES.some(language => language.id === value?.messageLanguage)) clean.messageLanguage = value.messageLanguage;
  if (typeof value?.mapZoom === 'number' && Number.isFinite(value.mapZoom) && value.mapZoom >= .0625 && value.mapZoom <= 2) clean.mapZoom = value.mapZoom;
  return clean;
}

export function normalizeDataBackup(value) {
  if (value?.format !== FORMAT || value.version !== 1) throw new Error('Choose a supported BaseGrid data file (.basegrid.json).');
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error('The data file has an invalid date.');
  return { format: FORMAT, version: 1, exportedAt: value.exportedAt,
    workspace: cleanWorkspace(value.workspace), battles: value.battles === null ? null : normalizeBattles(value.battles),
    rosters: normalizeRosterLibrary(value.rosters), preferences: cleanPreferences(value.preferences) };
}

export function parseDataBackup(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('Choose a data file smaller than 10 MB.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('This is not a valid BaseGrid data file.'); }
  return normalizeDataBackup(value);
}

export function exportDataBackup(storage, now = new Date()) {
  const workspace = storage.getItem(STORAGE_KEY);
  const rosters = storage.getItem(ROSTER_CACHE_KEY);
  return normalizeDataBackup({ format: FORMAT, version: 1, exportedAt: now.toISOString(),
    workspace: workspace === null ? null : JSON.parse(workspace),
    battles: storage.getItem(BATTLE_KEY) !== null || storage.getItem(LEGACY_BATTLE_KEY) !== null ? loadBattles(storage) : null,
    rosters: rosters === null ? { version: 1, entries: [] } : JSON.parse(rosters),
    preferences: { messageLanguage: storage.getItem(MESSAGE_LANGUAGE_KEY), mapZoom: Number(storage.getItem(ZOOM_KEY)) } });
}

const titleKey = title => title.trim().normalize('NFKC').toLocaleLowerCase('en');
function importedTitle(title, existing) {
  const taken = next => existing.some(plan => titleKey(plan.title) === titleKey(next));
  if (!taken(title)) return title;
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? ' (imported)' : ' (imported ' + number + ')';
    const next = title.slice(0, 100 - suffix.length) + suffix;
    if (!taken(next)) return next;
  }
}
const starter = (plan, mapId) => plan.id === 'initial-' + mapId && plan.title === 'Team A' && !plan.players.length && !Object.values(plan.assignments).some(ids => ids.length);

export function prepareDataImport(storage, input, { includeFormation = false } = {}) {
  const backup = normalizeDataBackup(input);
  const before = new Map();
  const read = key => { if (!before.has(key)) before.set(key, storage.getItem(key)); return before.get(key); };
  const changes = new Map();
  const summary = { plans: [], rostersAdded: 0, rostersKept: 0, searchesAdded: 0,
    hasFormation: backup.workspace !== null, hasExistingFormation: read(STORAGE_KEY) !== null, formationIncluded: false };
  if (backup.battles) {
    const current = read(BATTLE_KEY) !== null || read(LEGACY_BATTLE_KEY) !== null ? loadBattles({ getItem: read }) : emptyBattles();
    const allIds = new Set(Object.values(current.plans).flat().map(plan => plan.id));
    for (const mapId of Object.keys(BATTLE_MAPS)) {
      const originals = current.plans[mapId];
      const plans = originals.filter(plan => !starter(plan, mapId));
      const addedIds = new Map();
      for (const imported of backup.battles.plans[mapId]) {
        const title = importedTitle(imported.title, plans);
        let id;
        do { id = crypto.randomUUID(); } while (allIds.has(id));
        allIds.add(id); addedIds.set(imported.id, id);
        plans.push({ ...structuredClone(imported), id, title });
        summary.plans.push({ event: BATTLE_MAPS[mapId].name, title, originalTitle: imported.title, players: imported.players.length });
      }
      current.plans[mapId] = plans;
      if (!plans.some(plan => plan.id === current.selectedPlans[mapId])) current.selectedPlans[mapId] = addedIds.get(backup.battles.selectedPlans[mapId]);
    }
    // Keep the recipient's view preferences unless this is a fresh library.
    if (read(BATTLE_KEY) === null && read(LEGACY_BATTLE_KEY) === null) {
      current.selectedMap = backup.battles.selectedMap; current.playerSort = backup.battles.playerSort;
    }
    changes.set(BATTLE_KEY, JSON.stringify(normalizeBattles(current)));
  }
  const rawRosters = read(ROSTER_CACHE_KEY);
  const library = rawRosters === null ? { version: 1, entries: [] } : normalizeRosterLibrary(JSON.parse(rawRosters));
  const keys = new Set(library.entries.map(entry => entry.kind + ':' + entry.id));
  for (const entry of backup.rosters.entries) {
    const key = entry.kind + ':' + entry.id;
    if (keys.has(key)) { if (entry.kind === 'roster') summary.rostersKept++; continue; }
    keys.add(key); library.entries.push(entry);
    if (entry.kind === 'roster') summary.rostersAdded++; else summary.searchesAdded++;
  }
  if (summary.rostersAdded || summary.searchesAdded) changes.set(ROSTER_CACHE_KEY, JSON.stringify(library));
  if (includeFormation && backup.workspace) {
    changes.set(STORAGE_KEY, JSON.stringify(backup.workspace)); summary.formationIncluded = true;
  }
  // Display preferences fill gaps, but never overwrite the recipient's choices.
  for (const [key, value] of [[MESSAGE_LANGUAGE_KEY, backup.preferences.messageLanguage], [ZOOM_KEY, backup.preferences.mapZoom]]) {
    if (value !== undefined && read(key) === null) changes.set(key, String(value));
  }
  changes.set(DATA_IMPORT_KEY, crypto.randomUUID());
  for (const key of changes.keys()) read(key);
  return { summary, before, changes };
}

export function commitDataImport(storage, prepared) {
  for (const [key, value] of prepared.before) {
    if (storage.getItem(key) !== value) throw new Error('Your saved data changed. Choose the file again to review the latest changes.');
  }
  const written = [];
  try {
    for (const [key, value] of prepared.changes) { storage.setItem(key, value); written.push(key); }
  } catch {
    let restored = true;
    for (const key of written.reverse()) {
      try {
        const previous = prepared.before.get(key);
        if (previous === null) storage.removeItem(key); else storage.setItem(key, previous);
      } catch { restored = false; }
    }
    throw new Error(restored ? 'Import could not be saved. Your previous data is unchanged. Free some browser storage and try again.'
      : 'Import could not finish and some data could not be restored. Keep this tab open and your data file for recovery.');
  }
  return prepared.summary;
}
