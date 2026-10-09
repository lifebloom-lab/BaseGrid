import { fetchAlliances, fetchMembers } from './lastwar-api.js';
import { normalizeImportedPlayer, normalizeRosterContext } from './players.js';

export const ROSTER_CACHE_KEY = 'basegrid.rosters.v1';
const allianceId = value => typeof value === 'string' && /^[a-f\d]{32}$/i.test(value);

function cleanPlayers(players) {
  if (!Array.isArray(players) || !players.length) throw new Error('Invalid saved roster.');
  const ids = new Set();
  return players.map(player => {
    if (!player || typeof player.id !== 'string' || !player.id.startsWith('lastwar:') ||
        ids.has(player.id) || typeof player.name !== 'string' || !player.name.trim()) throw new Error('Invalid saved player.');
    ids.add(player.id);
    // Store only player data, even if a caller accidentally supplies extra fields.
    const clean = { id: player.id, name: player.name };
    for (const field of ['hqLevel', 'group', 'rank', 'power', 'serverId', 'x', 'y']) {
      if (player[field] === null || Number.isSafeInteger(player[field])) clean[field] = player[field];
    }
    return normalizeImportedPlayer(clean);
  });
}

function cleanEntry(entry) {
  if (!entry || !Number.isSafeInteger(entry.savedAt) || entry.savedAt < 0 ||
      !Number.isFinite(new Date(entry.savedAt).getTime())) throw new Error('Invalid saved date.');
  let data;
  if (entry.kind === 'roster' && (allianceId(entry.id) || entry.id === 'previous-import')) {
    data = cleanPlayers(entry.data);
  } else if (entry.kind === 'alliances' && /^[1-9]\d{0,9}$/.test(entry.id) && Array.isArray(entry.data)) {
    const ids = new Set();
    data = entry.data.map(item => {
      if (!item || !allianceId(item.id) || ids.has(item.id.toLowerCase()) ||
          typeof item.name !== 'string' || typeof item.tag !== 'string') throw new Error('Invalid saved alliance.');
      ids.add(item.id.toLowerCase());
      return { id: item.id.toLowerCase(), name: item.name, tag: item.tag,
        ...(Number.isSafeInteger(item.memberCount) ? { memberCount: item.memberCount } : {}) };
    });
  } else throw new Error('Invalid saved lookup.');
  return { kind: entry.kind, id: entry.id.toLowerCase(), savedAt: entry.savedAt,
    label: typeof entry.label === 'string' ? entry.label : entry.id, data,
    ...(entry.kind === 'roster' ? { context: normalizeRosterContext({ ...entry.context,
      allianceId: allianceId(entry.id) ? entry.id : entry.context?.allianceId }) } : {}) };
}

export function normalizeRosterLibrary(value) {
  if (value?.version !== 1 || !Array.isArray(value.entries)) throw new Error('Invalid saved roster library.');
  const keys = new Set();
  const entries = value.entries.map(item => {
    const entry = cleanEntry(item);
    const key = entry.kind + ':' + entry.id;
    if (keys.has(key)) throw new Error('Duplicate saved lookup.');
    keys.add(key);
    return entry;
  });
  return { version: 1, entries };
}

/** Persistent, opt-in refreshes: no expiry, background requests, or saved credentials. */
export function createRosterCache({ getStorage = () => window.localStorage, onWarning = () => {},
  getAlliances = fetchAlliances, getMembers = fetchMembers, now = Date.now } = {}) {
  const entries = new Map();
  let loaded = false;
  const entryKey = (kind, id) => `${kind}:${String(id).toLowerCase()}`;
  const copy = entry => entry ? structuredClone(entry) : null;

  function read() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = getStorage().getItem(ROSTER_CACHE_KEY);
      if (raw === null) return;
      const saved = JSON.parse(raw);
      if (saved?.version !== 1 || !Array.isArray(saved.entries)) throw new Error('Invalid saved library.');
      for (const item of saved.entries) {
        const entry = cleanEntry(item);
        entries.set(entryKey(entry.kind, entry.id), { ...entry, persisted: true });
      }
    } catch {
      onWarning('Some saved lookups could not be opened. Any players loaded now will still be kept for this visit.');
    }
  }

  function withContext(entry) {
    if (!entry || entry.kind !== 'roster') return entry;
    const context = normalizeRosterContext(entry.context);
    // Older libraries already contain the server and alliance in saved searches.
    // Use only an unambiguous match, without requesting new data.
    const matches = [...entries.values()].filter(item => item.kind === 'alliances' &&
      (!context?.serverId || Number(item.id) === context.serverId))
      .flatMap(item => item.data.filter(alliance => alliance.id === entry.id)
        .map(alliance => ({ serverId: Number(item.id), allianceName: alliance.name, allianceTag: alliance.tag })));
    const known = Object.fromEntries(Object.entries(context ?? {}).filter(([, value]) => value !== null));
    return { ...entry, context: normalizeRosterContext({ ...(matches.length === 1 ? matches[0] : {}), ...known }) };
  }

  function remember(entry) {
    read();
    const clean = withContext(cleanEntry(entry));
    entries.set(entryKey(clean.kind, clean.id), { ...clean, persisted: false });
    try {
      getStorage().setItem(ROSTER_CACHE_KEY, JSON.stringify({ version: 1,
        entries: [...entries.values()].map(({ persisted, ...data }) => data) }));
      for (const value of entries.values()) value.persisted = true;
      onWarning('');
    } catch {
      onWarning('Could not save this lookup locally. Keep this tab open to reuse it without another API call.');
    }
    return copy(entries.get(entryKey(clean.kind, clean.id)));
  }

  function get(kind, id) {
    read();
    return copy(withContext(entries.get(entryKey(kind, id))));
  }

  async function lookup(kind, id, options, { refresh = false, label, context } = {}) {
    const cached = get(kind, id);
    const metadata = { label: label ?? cached?.label ?? id, context: context ?? cached?.context };
    if (cached && !refresh) {
      const updated = context || label ? remember({ ...cached, ...metadata }) : cached;
      return { ...updated, source: 'saved' };
    }
    const data = await (kind === 'roster' ? getMembers : getAlliances)(id, options);
    if (options?.signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    return { ...remember({ kind, id, ...metadata, savedAt: now(), data }), source: 'api' };
  }

  return {
    listRosters() {
      read();
      return [...entries.values()].filter(entry => entry.kind === 'roster')
        .sort((a, b) => b.savedAt - a.savedAt).map(entry => copy(withContext(entry)));
    },
    getRoster: id => get('roster', id),
    getAlliances: server => get('alliances', String(Number(server))),
    loadRoster: (id, options, settings) => lookup('roster', String(id).toLowerCase(), options, settings),
    loadAlliances: (server, options, settings) => lookup('alliances', String(Number(server)), options, settings),
    preservePreviousImport(players, context) {
      read();
      if (players?.length && ![...entries.values()].some(entry => entry.kind === 'roster')) {
        remember({ kind: 'roster', id: context?.allianceId ?? 'previous-import', label: 'Previous import', context, data: players, savedAt: now() });
      }
    },
  };
}
