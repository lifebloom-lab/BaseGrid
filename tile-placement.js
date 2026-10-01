import { createSession, getFormation } from './placement.js';
import { normalizeGridLayout, resolveGridLayout, layoutFromSlots, gridCoordinates, previewGridMove } from './grid-layout.js';
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
  const modern = draft.layout?.version === 2;
  const plan = createSession({ players: playersFromDraft(draft), x0: Number(draft.x), y0: Number(draft.y),
    spacing: Number(draft.spacing), layout: modern ? undefined : draft.layout,
    plannedObstacles: modern ? [] : draft.plannedObstacles });
  const layout = modern ? resolveGridLayout(plan.players, draft.layout, plan.columns, plan.spacing)
    : layoutFromSlots(plan, getFormation(plan));
  const players = new Map(plan.players.map(player => [player.id, player]));
  const occupants = [
    ...layout.players.map(tile => ({ ...tile, type: 'player', size: 3, name: players.get(tile.playerId).name })),
    ...layout.obstacles.map(tile => ({ ...tile, type: 'obstacle' })),
  ];
  const records = normalizeTilePlacements(draft.tilePlacements);
  const byId = new Map(records.map(record => [record.playerId, record]));
  const slots = occupants.map(occupant => {
    const slot = { ...occupant, ...gridCoordinates(plan.origin, occupant) };
    const record = byId.get(slot.playerId);
    return { ...slot,
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
  const assigned = new Set(layout.players.map(tile => tile.playerId));
  return { ...plan, layout, slots, pool: plan.players.filter(player => !assigned.has(player.id)) };
}

function freezePositions(draft, plan) {
  return { ...draft, orderedPlayers: plan.players, plannedObstacles: [], layout: { ...layoutFromSlots(plan, plan.slots), explicit: true } };
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

export function moveTile(draft, kind, from, to, size = 3) {
  const plan = getTilePlan(draft);
  const preview = previewGridMove(plan, kind, from, to, size);
  if (!preview.valid) throw new Error(preview.error);
  const next = freezePositions(draft, plan);
  const same = tile => tile.column === from?.column && tile.row === from?.row;
  const destination = preview.to ?? to;
  if (kind === 'player') {
    const source = next.layout.players.find(same);
    const target = preview.swap && next.layout.players.find(tile => tile.playerId === preview.swap.playerId);
    if (target) Object.assign(target, { column: source.column, row: source.row });
    Object.assign(source, { column: destination.column, row: destination.row });
  } else if (kind === 'new-player') {
    next.layout.players.push({ playerId: from.playerId, column: destination.column, row: destination.row });
  } else {
    if (kind === 'obstacle') next.layout.obstacles = next.layout.obstacles.filter(tile => !same(tile));
    if (destination) next.layout.obstacles.push({ column: destination.column, row: destination.row, size: preview.size });
  }
  next.layout = normalizeGridLayout(next.layout);
  getTilePlan(next); // Enforce locks and coordinate validity before saving.
  return next;
}

/** Returning to the pool cancels this placement, while keeping the roster record. */
export function returnBaseToPool(draft, playerId) {
  const { plan, tile } = selectedTile(draft, playerId);
  if (tile.status === 'placed') throw new Error('Undo this player’s confirmation before returning their base to the pool.');
  const next = setRecord(freezePositions(draft, plan), playerId, null);
  next.layout.players = next.layout.players.filter(position => position.playerId !== playerId);
  if (next.selectedPlayerId === playerId) next.selectedPlayerId = null;
  getTilePlan(next);
  return next;
}

/** Both choices start at the origin and skip obstacles and bases that stay fixed. */
export function autoPlaceBases(draft, mode = 'pool') {
  if (!['pool', 'rearrange'].includes(mode)) throw new Error('Choose which bases to auto place.');
  const plan = getTilePlan(draft);
  const next = freezePositions(draft, plan);
  if (mode === 'rearrange') {
    const locked = new Set(plan.slots.filter(slot => slot.status === 'placed').map(slot => slot.playerId));
    next.layout.players = next.layout.players.filter(tile => locked.has(tile.playerId));
  }
  next.layout = { ...resolveGridLayout(plan.players, { ...next.layout, explicit: false }, plan.columns, plan.spacing), explicit: true };
  getTilePlan(next);
  return next;
}

export function updateTileDraft(draft, patch) {
  const next = { ...draft, ...patch };
  const players = playersFromDraft(next);
  const ids = new Set(players.map(player => player.id));
  const records = normalizeTilePlacements(draft.tilePlacements);
  if ((patch.names !== undefined && patch.names !== draft.names) || patch.importedPlayers !== undefined) {
    // Freeze the old formation before roster additions; new members start in the pool.
    let layout = draft.layout;
    try { layout = freezePositions(draft, getTilePlan(draft)).layout; } catch { /* Keep incomplete setups editable. */ }
    if (!layout) layout = { version: 2, explicit: true, players: [], obstacles: [] };
    if (layout.version === 2) next.layout = { ...layout, explicit: true, players: layout.players.filter(tile => ids.has(tile.playerId)) };
    next.orderedPlayers = players;
  }
  if (records.some(record => record.status === 'placed')) {
    if (patch.spacing !== undefined && patch.spacing !== draft.spacing) throw new Error('Undo confirmations before changing spacing.');
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
  if (!session) {
    if (draft.layout?.version === 2 || (!draft.layout && !draft.plannedObstacles?.length)) return draft;
    // An unfinished setup remains editable; convert once its inputs form a valid plan.
    if (!playersFromDraft(draft).length || [draft.x, draft.y, draft.spacing].some(value =>
      typeof value !== 'string' || !value.trim() || !Number.isSafeInteger(Number(value))) || Number(draft.spacing) < 0) return draft;
    return freezePositions(draft, getTilePlan(draft));
  }
  const slots = getFormation(session);
  const next = freezePositions({ ...draft, names: session.players.map(player => player.name).join('\n'),
    x: String(session.origin.x), y: String(session.origin.y), spacing: String(session.spacing),
    selectedPlayerId: null, tilePlacements: slots.filter(slot => slot.type === 'player' && slot.status === 'placed')
      .map(slot => ({ playerId: slot.playerId, status: 'placed', confirmed: coordinates(slot) })),
  }, { ...session, slots });
  getTilePlan(next);
  return next;
}
