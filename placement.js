/** Pure placement engine. No DOM, storage, API calls, or rank assumptions. */
export const BASE_SIZE = 3;
export const SESSION_VERSION = 1;

function integer(value, label, minimum = Number.MIN_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be ${minimum === 0 ? 'a non-negative ' : 'a safe '}whole number.`);
  }
  return value;
}

/** The single boundary for interpreting map coordinates; currently upper-left. */
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
  const lastSlot = session.slotIndex + session.players.length - session.playerIndex - 1;
  if (lastSlot < session.slotIndex) return;
  // Check both the greatest X and greatest Y, including a partial last row.
  slotToCoordinate(session, Math.min(session.columns - 1, lastSlot));
  slotToCoordinate(session, lastSlot);
}

/** Data sources supply player records. Metadata is preserved for future adapters. */
export function createSession({ players, x0, y0, spacing }) {
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
    playerIndex: 0,
    slotIndex: 0,
    // Occupants also form the action history: one explicit record per consumed slot.
    occupants: [],
  };
  validateRemainingCoordinates(session);
  return session;
}

export function getProposal(session) {
  if (session.playerIndex === session.players.length) return null;
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
  const next = {
    ...session,
    playerIndex: session.playerIndex + (action === 'placed' ? 1 : 0),
    slotIndex: session.slotIndex + 1,
    occupants: [...session.occupants, occupant],
  };
  validateRemainingCoordinates(next);
  return next;
}

export function undoLastAction(session) {
  const last = session.occupants.at(-1);
  if (!last) return session;
  return {
    ...session,
    playerIndex: session.playerIndex - (last.type === 'player' ? 1 : 0),
    slotIndex: session.slotIndex - 1,
    occupants: session.occupants.slice(0, -1),
  };
}

/** Occupied slots are explicit; unprocessed positions are projections only. */
export function getFormation(session) {
  const occupied = session.occupants.map(occupant => ({
    ...occupant,
    status: occupant.type === 'obstacle' ? 'blocked' : 'placed',
  }));
  const remaining = session.players.slice(session.playerIndex).map((player, offset) => ({
    type: 'player',
    playerId: player.id,
    name: player.name,
    slotIndex: session.slotIndex + offset,
    status: offset === 0 ? 'current' : 'pending',
    ...slotToCoordinate(session, session.slotIndex + offset),
  }));
  return [...occupied, ...remaining];
}

/** Save inputs + actions; replay on load so coordinates and indices cannot drift. */
export function serializeSession(session) {
  return {
    version: SESSION_VERSION,
    players: session.players,
    x0: session.origin.x,
    y0: session.origin.y,
    spacing: session.spacing,
    actions: session.occupants.map(occupant => occupant.type === 'player' ? 'placed' : 'obstacle'),
  };
}

export function restoreSession(snapshot) {
  if (!snapshot || snapshot.version !== SESSION_VERSION || !Array.isArray(snapshot.actions)) {
    throw new Error('This saved session is not supported.');
  }
  return snapshot.actions.reduce(applyAction, createSession(snapshot));
}
