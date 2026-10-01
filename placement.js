/** Pure placement engine. No DOM, storage, API calls, or rank assumptions. */
import { resolveFreeLayout, projectFreePositions } from './free-formation.js';
export const BASE_SIZE = 3;
export const SESSION_VERSION = 1;

function integer(value, label, minimum = Number.MIN_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be ${minimum === 0 ? 'a non-negative ' : 'a safe '}whole number.`);
  }
  return value;
}

export function tileToCoordinate({ origin, spacing }, { column, row }) {
  const step = integer(BASE_SIZE + spacing, 'Base step', 0);
  return {
    x: integer(origin.x + integer(integer(column, 'Column') * step, 'Horizontal offset'), 'Calculated X'),
    y: integer(origin.y + integer(integer(row, 'Row') * step, 'Vertical offset'), 'Calculated Y'),
  };
}

/** Legacy coarse-slot targets; their numeric coordinates are preserved on upgrade. */
export function slotToCoordinate({ origin, spacing, columns }, slotIndex) {
  integer(slotIndex, 'Slot index', 0);
  integer(columns, 'Columns', 1);
  integer(origin.x, 'Initial X');
  integer(origin.y, 'Initial Y');
  integer(spacing, 'Spacing', 0);
  const step = integer(BASE_SIZE + spacing, 'Base step', 0);
  const column = slotIndex % columns;
  const row = Math.floor(slotIndex / columns);
  const dx = integer(column * step, 'Horizontal offset', 0);
  const dy = integer(row * step, 'Vertical offset', 0);
  return {
    x: integer(origin.x + dx, 'Calculated X'),
    y: integer(origin.y + dy, 'Calculated Y'),
  };
}

function validateRemainingCoordinates(session) {
  if (session.layout) {
    for (const tile of [...session.layout.players, ...session.layout.obstacles, ...projectFreePositions(session)]) tileToCoordinate(session, tile);
    return;
  }
  let lastSlot = session.slotIndex + session.players.length - session.playerIndex - 1;
  for (const blocked of session.plannedObstacles) {
    slotToCoordinate(session, blocked);
    if (blocked >= session.slotIndex && blocked <= lastSlot) lastSlot++;
  }
  if (lastSlot < session.slotIndex) return;
  // Check both the greatest X and greatest Y, including a partial last row.
  slotToCoordinate(session, Math.min(session.columns - 1, lastSlot));
  slotToCoordinate(session, lastSlot);
}

export function normalizePlannedObstacles(obstacles = []) {
  if (!Array.isArray(obstacles)) throw new Error('Planned obstacles must be a list of tile positions.');
  const positions = obstacles.map(value => integer(value, 'Obstacle position', 0));
  if (new Set(positions).size !== positions.length) throw new Error('Each obstacle needs a different tile.');
  return [...positions].sort((a, b) => a - b);
}

function skipPlannedObstacles(session) {
  const blocked = new Set(session.plannedObstacles);
  let next = session;
  while (blocked.has(next.slotIndex)) {
    const occupant = { type: 'obstacle', automatic: true, slotIndex: next.slotIndex,
      ...slotToCoordinate(next, next.slotIndex) };
    next = { ...next, slotIndex: next.slotIndex + 1, occupants: [...next.occupants, occupant] };
  }
  return next;
}

/** Data sources supply player records. Metadata is preserved for future adapters. */
export function createSession({ players, x0, y0, spacing, plannedObstacles = [], layout }) {
  if (!Array.isArray(players) || players.length === 0) {
    throw new Error('Enter at least one player.');
  }
  const ids = new Set();
  const normalized = players.map((player, index) => {
    if (!player || typeof player !== 'object' || typeof player.name !== 'string' || !player.name.trim()) {
      throw new Error(`Player ${index + 1} needs a name.`);
    }
    const id = player.id ?? `player-${index + 1}`;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) {
      throw new Error('Each player must have a unique, non-empty ID.');
    }
    ids.add(id);
    return { ...player, id, name: player.name.trim() };
  });
  const session = {
    version: SESSION_VERSION,
    players: normalized,
    origin: { x: integer(x0, 'Initial X'), y: integer(y0, 'Initial Y') },
    spacing: integer(spacing, 'Spacing', 0),
    columns: Math.ceil(Math.sqrt(normalized.length)),
    plannedObstacles: normalizePlannedObstacles(plannedObstacles),
    playerIndex: 0,
    slotIndex: 0,
    // Occupants also form the action history: one explicit record per consumed slot.
    occupants: [],
  };
  if (layout !== undefined) {
    if (session.plannedObstacles.length) throw new Error('Free formations must store obstacles as grid positions.');
    session.layout = resolveFreeLayout(normalized, layout, session.columns);
  }
  validateRemainingCoordinates(session);
  return session.layout ? session : skipPlannedObstacles(session);
}

export function getProposal(session) {
  if (session.playerIndex === session.players.length) return null;
  if (session.layout) {
    const proposal = projectFreePositions(session)[0];
    return { ...proposal, slotIndex: session.slotIndex, ...tileToCoordinate(session, proposal) };
  }
  return {
    player: session.players[session.playerIndex],
    slotIndex: session.slotIndex,
    ...slotToCoordinate(session, session.slotIndex),
  };
}

/** An obstacle consumes space without consuming a player. Columns never change. */
export function applyAction(session, action) {
  if (action !== 'placed' && action !== 'obstacle') throw new Error('Unknown placement action.');
  const proposal = getProposal(session);
  if (!proposal) throw new Error('All players are already placed.');
  const { slotIndex, x, y, player } = proposal;
  const occupant = action === 'placed'
    ? { type: 'player', playerId: player.id, name: player.name, slotIndex, x, y }
    : { type: 'obstacle', slotIndex, x, y };
  if (session.layout) Object.assign(occupant, { column: proposal.column, row: proposal.row });
  const next = {
    ...session,
    playerIndex: session.playerIndex + (action === 'placed' ? 1 : 0),
    slotIndex: session.slotIndex + 1,
    occupants: [...session.occupants, occupant],
  };
  const advanced = session.layout ? next : skipPlannedObstacles(next);
  validateRemainingCoordinates(advanced);
  return advanced;
}

export function canUndo(session) {
  return session.occupants.some(occupant => !occupant.automatic);
}

export function undoLastAction(session) {
  const index = session.occupants.findLastIndex(occupant => !occupant.automatic);
  if (index === -1) return session;
  const last = session.occupants[index];
  return {
    ...session,
    playerIndex: session.playerIndex - (last.type === 'player' ? 1 : 0),
    slotIndex: last.slotIndex,
    occupants: session.occupants.slice(0, index),
  };
}

/** Occupied slots are explicit; unprocessed positions are projections only. */
export function getFormation(session) {
  const occupied = session.occupants.map(occupant => ({
    ...occupant,
    status: occupant.type === 'obstacle' ? 'blocked' : 'placed',
  }));
  if (session.layout) {
    const remaining = projectFreePositions(session).map(({ player, ...tile }, offset) => ({
      type: 'player', playerId: player.id, name: player.name, ...tile,
      slotIndex: session.slotIndex + offset, status: offset === 0 ? 'current' : 'pending', ...tileToCoordinate(session, tile),
    }));
    const planned = session.layout.obstacles.map(tile => ({ type: 'obstacle', automatic: true,
      ...tile, status: 'blocked', ...tileToCoordinate(session, tile) }));
    return [...occupied, ...remaining, ...planned].sort((a, b) => a.row - b.row || a.column - b.column);
  }
  const blocked = new Set(session.plannedObstacles);
  let slotIndex = session.slotIndex;
  const remaining = session.players.slice(session.playerIndex).map((player, offset) => {
    while (blocked.has(slotIndex)) slotIndex++;
    const position = slotIndex++;
    return { type: 'player', playerId: player.id, name: player.name, slotIndex: position,
      status: offset === 0 ? 'current' : 'pending', ...slotToCoordinate(session, position) };
  });
  const recorded = new Set(occupied.map(slot => slot.slotIndex));
  const planned = session.plannedObstacles.filter(index => !recorded.has(index)).map(index => ({
    type: 'obstacle', automatic: true, slotIndex: index, status: 'blocked', ...slotToCoordinate(session, index),
  }));
  return [...occupied, ...remaining, ...planned].sort((a, b) => a.slotIndex - b.slotIndex);
}

/** Save inputs + actions; replay on load so coordinates and indices cannot drift. */
export function serializeSession(session) {
  return {
    version: SESSION_VERSION,
    players: session.players,
    x0: session.origin.x,
    y0: session.origin.y,
    spacing: session.spacing,
    plannedObstacles: session.plannedObstacles,
    ...(session.layout ? { layout: session.layout } : {}),
    actions: session.occupants.filter(occupant => !occupant.automatic)
      .map(occupant => occupant.type === 'player' ? 'placed' : 'obstacle'),
  };
}

export function restoreSession(snapshot) {
  if (!snapshot || snapshot.version !== SESSION_VERSION || !Array.isArray(snapshot.actions)) {
    throw new Error('This saved session is not supported.');
  }
  return snapshot.actions.reduce(applyAction, createSession(snapshot));
}
