/** LastWarTools adapter. Requests go through our same-origin, read-only relay. */
import { normalizeImportedPlayer } from './players.js';

const ALLIANCE_ID = /^[a-f\d]{32}$/i;
const RELAY_HELP = 'Imports need the BaseGrid import server. Start the app with python3 server.py, then try again.';

function validKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 1024 || /[\r\n]/.test(apiKey)) {
    throw new Error('Enter your LastWarTools API key.');
  }
  return apiKey.trim();
}

const responseErrors = {
  401: 'The API key was not accepted. Check your LastWarTools key and try again.',
  402: 'LastWarTools requires more API credits for this request.',
  403: 'This API key does not have access to the requested data.',
  404: 'The alliance or server was not found. Check your selection and try again.',
  429: 'LastWarTools is rate limiting requests. Wait a little before trying again.',
  502: 'LastWarTools could not be reached or returned an invalid response. Try again shortly.',
  503: 'LastWarTools is busy or has no game connection available. Try again shortly.',
  504: 'LastWarTools took too long to respond. Try again shortly.',
};

async function request(path, { apiKey, signal, fetchImpl = fetch, timeoutMs = 120_000 }) {
  const key = validKey(apiKey);
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetchImpl(`/api/lastwar${path}`, {
      headers: { 'X-API-Key': key, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    if (response.headers.get('X-BaseGrid-Relay') !== '1') throw new Error(RELAY_HELP);
    if (!response.ok) throw new Error(responseErrors[response.status] ?? `Import failed (HTTP ${response.status}). Try again shortly.`);
    try { return await response.json(); } catch { throw new Error('LastWarTools returned an unreadable response. Try again.'); }
  } catch (error) {
    if (timedOut) throw new Error('The request timed out. The shared service may be busy; try again shortly.');
    if (controller.signal.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    if (error instanceof TypeError) throw new Error('Could not connect to the import service. Check your connection and that BaseGrid is running.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function normalizeAlliances(data) {
  if (!Array.isArray(data)) throw new Error('LastWarTools returned an unexpected alliance list.');
  const ids = new Set();
  return data.map(item => {
    if (!item || !ALLIANCE_ID.test(item.id) || ids.has(item.id.toLowerCase()) ||
        typeof item.name !== 'string' || !item.name.trim() || typeof item.abbr !== 'string') {
      throw new Error('LastWarTools returned an invalid alliance entry. Try again.');
    }
    ids.add(item.id.toLowerCase());
    return { id: item.id.toLowerCase(), name: item.name.trim(), tag: item.abbr.trim(), memberCount: item.member_count };
  });
}

export function normalizeMembers(data, allianceId) {
  if (!data || typeof data.alliance_id !== 'string' || data.alliance_id.toLowerCase() !== allianceId.toLowerCase() || !Array.isArray(data.members)) {
    throw new Error('LastWarTools returned a roster for an unexpected alliance. Try again.');
  }
  if (!data.members.length) throw new Error('This alliance returned no players. Your current roster has not changed.');
  if (!Number.isSafeInteger(data.member_count) || data.member_count !== data.members.length) {
    throw new Error('LastWarTools returned an incomplete roster. Try again before importing.');
  }
  const ids = new Set();
  return data.members.map(member => {
    if (!member || typeof member.uid !== 'string' || !member.uid.trim() || ids.has(member.uid) ||
        typeof member.name !== 'string' || !member.name.trim()) {
      throw new Error('LastWarTools returned an invalid or duplicate player. Try again.');
    }
    ids.add(member.uid);
    // Only retain known player fields, never authentication or arbitrary API data.
    const player = { id: `lastwar:${member.uid}`, name: member.name.replace(/\s+/g, ' ').trim() };
    for (const [source, target] of [['rank', 'rank'], ['power', 'power'], ['hq_level', 'hqLevel'], ['server_id', 'serverId'], ['x', 'x'], ['y', 'y']]) {
      if (Number.isSafeInteger(member[source])) player[target] = member[source];
    }
    return normalizeImportedPlayer(player);
  });
}

export async function fetchAlliances(serverId, options) {
  if (!/^\d+$/.test(String(serverId)) || !Number.isSafeInteger(Number(serverId)) || Number(serverId) < 1 || Number(serverId) > 9999999999) {
    throw new Error('Enter a positive whole-number server number.');
  }
  return normalizeAlliances(await request(`/rankings/${Number(serverId)}/alliances`, options));
}

export async function fetchMembers(allianceId, options) {
  if (typeof allianceId !== 'string' || !ALLIANCE_ID.test(allianceId)) throw new Error('Select an alliance or enter its 32-character alliance ID.');
  return normalizeMembers(await request(`/alliance/${allianceId.toLowerCase()}/members`, options), allianceId);
}

export function orderPlayers(players, order = 'power') {
  if (!['power', 'name'].includes(order)) throw new Error('Choose a supported placement order.');
  return [...players].sort((a, b) => {
    if (order === 'power') {
      const difference = (b.power ?? -1) - (a.power ?? -1);
      if (difference) return difference;
    }
    return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
  });
}
