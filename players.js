const validLevel = value => Number.isSafeInteger(value) && value > 0;
const validGroup = value => Number.isInteger(value) && value >= 1 && value <= 5;

/** Import provenance is separate from a member's home server. Never infer one from the other. */
export function normalizeRosterContext(value) {
  if (!value || typeof value !== 'object') return null;
  const text = field => typeof value[field] === 'string' && value[field].trim() ? value[field].trim() : null;
  const context = {
    serverId: Number.isSafeInteger(value.serverId) && value.serverId > 0 ? value.serverId : null,
    allianceId: /^[a-f\d]{32}$/i.test(text('allianceId') ?? '') ? text('allianceId').toLowerCase() : null,
    allianceName: text('allianceName'),
    allianceTag: text('allianceTag'),
  };
  return Object.values(context).some(value => value !== null) ? context : null;
}

export function rosterContextLabels(value) {
  const context = normalizeRosterContext(value);
  return {
    server: context?.serverId ? `#${context.serverId}` : 'Not provided',
    alliance: [context?.allianceTag ? `[${context.allianceTag}]` : '', context?.allianceName].filter(Boolean).join(' ')
      || (context?.allianceId ? `ID ${context.allianceId}` : 'Not provided'),
  };
}

/** Group numbers are provider codes, not a verified mapping to in-game R1–R5. */
export function normalizeImportedPlayer(player) {
  const group = player.group === undefined ? player.rank : player.group;
  return {
    ...player,
    hqLevel: validLevel(player.hqLevel) ? player.hqLevel : null,
    group: validGroup(group) ? group : null,
  };
}

export function playerDetails(player, groupPrefix = 'Group ') {
  if (!player || (!player.id?.startsWith('lastwar:') && player.hqLevel === undefined && player.group === undefined)) return '';
  const details = normalizeImportedPlayer(player);
  return `${details.hqLevel === null ? 'HQ unknown' : `HQ ${details.hqLevel}`} · ${details.group === null ? 'Group unknown' : `${groupPrefix}${details.group}`}`;
}

/** Manual input is an adapter. The engine only receives player records. */
export function parseManualPlayers(text) {
  return text.split(/\r?\n/).map(name => name.trim()).filter(Boolean)
    .map((name, index) => ({ id: `player-${index + 1}`, name }));
}

/** Match edited/reordered names to imported records, including duplicate names. */
export function playersFromDraft({ names, importedPlayers = [], orderedPlayers = [] }) {
  const byName = new Map();
  const knownIds = new Set();
  for (const player of [...orderedPlayers, ...importedPlayers]) {
    if (knownIds.has(player.id)) continue;
    knownIds.add(player.id);
    if (!byName.has(player.name)) byName.set(player.name, []);
    byName.get(player.name).push(player);
  }
  const manual = parseManualPlayers(names);
  const matched = manual.map(player => byName.get(player.name)?.shift());
  const usedIds = new Set(matched.filter(Boolean).map(player => player.id));
  return manual.map((player, index) => {
    if (matched[index]) return matched[index];
    let suffix = index + 1;
    while (usedIds.has(`player-${suffix}`)) suffix++;
    const id = `player-${suffix}`;
    usedIds.add(id);
    return { ...player, id };
  });
}

/** Move an entire record, including duplicate-name identities and imported details. */
export function moveDraftPlayer(draft, from, to) {
  const players = playersFromDraft(draft);
  if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < players.length)) {
    throw new Error('Choose an existing player position.');
  }
  if (from === to) return draft;
  const orderedPlayers = [...players];
  orderedPlayers.splice(to, 0, ...orderedPlayers.splice(from, 1));
  return { ...draft, names: orderedPlayers.map(player => player.name).join('\n'), orderedPlayers };
}

/** Obstacles belong to tile positions, independently of the player order. */
export function changeDraftObstacle(draft, from, to) {
  const positions = draft.plannedObstacles ?? [];
  for (const index of [from, to]) {
    if (index !== null && (!Number.isSafeInteger(index) || index < 0)) throw new Error('Choose a valid obstacle tile.');
  }
  if (from !== null && !positions.includes(from)) throw new Error('That tile has no planned obstacle.');
  if (from === to || (to !== null && positions.includes(to))) return draft;
  return { ...draft, plannedObstacles: [...positions.filter(index => index !== from), ...(to === null ? [] : [to])].sort((a, b) => a - b) };
}
