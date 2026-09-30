import { createSession, getFormation } from './placement.js';
import { changeDraftFormation, normalizeFreeLayout, tilePosition, tileKey } from './free-formation.js';
import { playersFromDraft } from './players.js';

function coordinates(value) {
  if (!value || !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y)) throw new Error('Saved placement coordinates are invalid.');
  return { x: value.x, y: value.y };
}

export function normalizeTilePlacements(records = []) {
  if (!Array.isArray(records)) throw new Error('Saved player placements are invalid.');
  const ids = new Set();
  return records.map(record => {
    if (!record || typeof record.playerId !== 'string' || !record.playerId.trim() || ids.has(record.playerId) ||
        !['in-progress', 'placed'].includes(record.status)) throw new Error('Saved player placement status is invalid.');
    ids.add(record.playerId);
    return { playerId: record.playerId, status: record.status,
      ...(record.status === 'placed' ? { confirmed: coordinates(record.confirmed) } : {}),
      ...(record.copied ? { copied: { ...coordinates(record.copied),
        name: typeof record.copied.name === 'string' ? record.copied.name : '',
        language: typeof record.copied.language === 'string' ? record.copied.language : 'en' } } : {}),
    };
  });
}

export function getTilePlan(draft) {
  if ([draft.x, draft.y, draft.spacing].some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('Enter initial X, initial Y, and spacing.');
  }
  const plan = createSession({ players: playersFromDraft(draft), x0: Number(draft.x), y0: Number(draft.y),
    spacing: Number(draft.spacing), layout: draft.layout, plannedObstacles: draft.plannedObstacles });
  const records = normalizeTilePlacements(draft.tilePlacements);
  const byId = new Map(records.map(record => [record.playerId, record]));
  const slots = getFormation(plan).map(slot => {
    const record = byId.get(slot.playerId);
    return { ...slot, ...tilePosition(slot, plan.columns),
      status: slot.type === 'obstacle' ? 'blocked' : record?.status ?? 'planned',
      messageChanged: Boolean(record?.copied && (record.copied.x !== slot.x || record.copied.y !== slot.y || record.copied.name !== slot.name)),
    };
  });
  for (const record of records.filter(record => record.status === 'placed')) {
    const tile = slots.find(slot => slot.playerId === record.playerId);
    if (!tile || tile.x !== record.confirmed.x || tile.y !== record.confirmed.y) {
      throw new Error('Undo the affected player’s confirmation before changing their position or removing them.');
    }
  }
  return { ...plan, slots };
}

function freezePositions(draft, plan) {
  return { ...draft, orderedPlayers: plan.players, plannedObstacles: [], layout: normalizeFreeLayout({
    players: plan.slots.filter(slot => slot.type === 'player').map(slot => ({ playerId: slot.playerId, ...tilePosition(slot, plan.columns) })),
    obstacles: plan.slots.filter(slot => slot.type === 'obstacle').map(slot => tilePosition(slot, plan.columns)),
  }) };
}

function selectedTile(draft, playerId) {
  const plan = getTilePlan(draft);
  const tile = plan.slots.find(slot => slot.playerId === playerId);
  if (!tile) throw new Error('Choose a player in this formation.');
  return { plan, tile };
}

function setRecord(draft, playerId, record) {
  const records = normalizeTilePlacements(draft.tilePlacements).filter(item => item.playerId !== playerId);
  return { ...draft, tilePlacements: record ? [...records, record] : records };
}

export function openTilePlacement(draft, playerId) {
  const { plan, tile } = selectedTile(draft, playerId);
  let next = freezePositions(draft, plan);
  if (tile.status === 'planned') next = setRecord(next, playerId, { playerId, status: 'in-progress' });
  return { ...next, selectedPlayerId: playerId };
}

export function confirmTilePlacement(draft, playerId) {
  const { plan, tile } = selectedTile(draft, playerId);
  if (tile.status !== 'in-progress') throw new Error('Open the player’s placement panel before confirming their arrival.');
  const record = normalizeTilePlacements(draft.tilePlacements).find(item => item.playerId === playerId);
  return setRecord(freezePositions(draft, plan), playerId, { ...record, status: 'placed', confirmed: { x: tile.x, y: tile.y } });
}

export function undoTileConfirmation(draft, playerId) {
  const { tile } = selectedTile(draft, playerId);
  if (tile.status !== 'placed') return draft;
  const record = normalizeTilePlacements(draft.tilePlacements).find(item => item.playerId === playerId);
  const { confirmed, ...rest } = record;
  return setRecord(draft, playerId, { ...rest, status: 'in-progress' });
}

export function cancelTilePlacement(draft, playerId) {
  const { tile } = selectedTile(draft, playerId);
  if (tile.status === 'placed') throw new Error('Undo this player’s confirmation first.');
  return { ...setRecord(draft, playerId, null), selectedPlayerId: null };
}

/** Save the coordinates actually copied, even if a pending copy finishes after a drag. */
export function recordCopiedMessage(draft, proposal, language) {
  const record = normalizeTilePlacements(draft.tilePlacements).find(item => item.playerId === proposal.player.id);
  if (record?.status !== 'in-progress') return draft;
  return setRecord(draft, record.playerId, { ...record,
    copied: { ...coordinates(proposal), name: proposal.player.name, language } });
}

export function moveTile(draft, kind, from, to) {
  const plan = getTilePlan(draft);
  const locked = plan.slots.filter(slot => slot.status === 'placed');
  if (locked.some(slot => (from && tileKey(slot) === tileKey(from)) || (to && tileKey(slot) === tileKey(to)))) {
    throw new Error('This base is confirmed. Undo its confirmation before moving it or using its tile.');
  }
  const next = changeDraftFormation(draft, plan, plan.slots, kind, from, to);
  getTilePlan(next); // Enforce locks and coordinate validity before saving.
  return next;
}

export function updateTileDraft(draft, patch) {
  const next = { ...draft, ...patch };
  const players = playersFromDraft(next);
  const ids = new Set(players.map(player => player.id));
  const records = normalizeTilePlacements(draft.tilePlacements);
  if (records.some(record => record.status === 'placed')) {
    getTilePlan(next);
    const oldNames = new Map(playersFromDraft(draft).map(player => [player.id, player.name]));
    if (records.some(record => record.status === 'placed' && players.find(player => player.id === record.playerId)?.name !== oldNames.get(record.playerId))) {
      throw new Error('Undo a player’s confirmation before changing their name.');
    }
  }
  next.tilePlacements = records.filter(record => ids.has(record.playerId));
  if (!ids.has(next.selectedPlayerId)) next.selectedPlayerId = null;
  return next;
}

export function resetTileProgress(draft) {
  return { ...draft, tilePlacements: [], selectedPlayerId: null };
}

/** Upgrade a saved sequential session without losing confirmed bases or discovered obstacles. */
export function migrateTileWorkspace(draft, session) {
  if (!session) return draft;
  const slots = getFormation(session).map(slot => ({ ...slot, ...tilePosition(slot, session.columns) }));
  const next = freezePositions({ ...draft, names: session.players.map(player => player.name).join('\n'),
    x: String(session.origin.x), y: String(session.origin.y), spacing: String(session.spacing),
    selectedPlayerId: null, tilePlacements: slots.filter(slot => slot.type === 'player' && slot.status === 'placed')
      .map(slot => ({ playerId: slot.playerId, status: 'placed', confirmed: coordinates(slot) })),
  }, { ...session, slots });
  getTilePlan(next);
  return next;
}
