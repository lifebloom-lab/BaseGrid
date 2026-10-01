/** Layout v2 stores footprint corners relative to the first base's corner.
 * The game origin and all reported X/Y coordinates denote footprint centers. */
export const GRID_LAYOUT_VERSION = 2;
export const BASE_SIZE = 3;

export function gridPosition(value, size = BASE_SIZE) {
  if (!value || ![value.column, value.row, value.column + size - 1, value.row + size - 1].every(Number.isSafeInteger)) {
    throw new Error('Choose a valid whole-number tile position.');
  }
  return { column: value.column, row: value.row };
}

export function obstacleSize(size) {
  if (size !== 1 && size !== 3) throw new Error('Choose a 1 × 1 or 3 × 3 obstacle.');
  return size;
}

export function overlaps(a, b) {
  const aSize = a.size ?? BASE_SIZE;
  const bSize = b.size ?? BASE_SIZE;
  return a.column < b.column + bSize && a.column + aSize > b.column &&
    a.row < b.row + bSize && a.row + aSize > b.row;
}

export function gridCoordinates(origin, tile) {
  const size = tile.size ?? BASE_SIZE;
  const radius = (size - 1) / 2;
  // The first 3 × 3 base is centered on origin, so grid cell (0, 0) is origin − 1.
  const x = origin.x + tile.column + (size - BASE_SIZE) / 2;
  const y = origin.y + tile.row + (size - BASE_SIZE) / 2;
  if (![x, y, x - radius, y - radius, x + radius, y + radius].every(Number.isSafeInteger)) {
    throw new Error('Formation coordinates are out of range.');
  }
  return { x, y };
}

export function normalizeGridLayout(layout) {
  if (layout?.version !== GRID_LAYOUT_VERSION || !Array.isArray(layout.players) || !Array.isArray(layout.obstacles)) {
    throw new Error('The saved grid layout is invalid or from an unsupported version.');
  }
  const ids = new Set();
  if (layout.explicit !== undefined && typeof layout.explicit !== 'boolean') throw new Error('The saved placement mode is invalid.');
  const occupied = [];
  const claim = (value, size) => {
    const tile = { ...gridPosition(value, size), size };
    if (occupied.some(other => overlaps(tile, other))) throw new Error('Base and obstacle footprints cannot overlap.');
    occupied.push(tile);
    return tile;
  };
  return {
    version: GRID_LAYOUT_VERSION,
    ...(layout.explicit !== undefined ? { explicit: layout.explicit } : {}),
    players: layout.players.map(player => {
      if (typeof player?.playerId !== 'string' || !player.playerId.trim() || ids.has(player.playerId)) {
        throw new Error('Each formation position needs a unique player ID.');
      }
      ids.add(player.playerId);
      const { size, ...position } = claim(player, BASE_SIZE);
      return { playerId: player.playerId, ...position };
    }),
    obstacles: layout.obstacles.map(obstacle => claim(obstacle, obstacleSize(obstacle?.size))),
  };
}

/** Roster additions use initial spacing; existing positions and gaps remain untouched. */
export function resolveGridLayout(players, layout, columns, spacing) {
  const clean = normalizeGridLayout(layout);
  const ids = new Set(players.map(player => player.id));
  const known = new Map(clean.players.filter(tile => ids.has(tile.playerId)).map(tile => [tile.playerId, tile]));
  // Explicit plans keep absent roster members in the pool until the user adds them.
  if (clean.explicit) return { ...clean, players: players.filter(player => known.has(player.id)).map(player => known.get(player.id)) };
  const occupied = [...known.values(), ...clean.obstacles];
  let index = 0;
  const step = BASE_SIZE + spacing;
  return { ...clean, players: players.map(player => {
    if (known.has(player.id)) return known.get(player.id);
    let tile;
    do {
      tile = gridPosition({ column: (index % columns) * step, row: Math.floor(index++ / columns) * step });
    } while (occupied.some(other => overlaps(tile, other)));
    occupied.push(tile);
    return { playerId: player.id, ...tile };
  }) };
}

/** Use actual coordinates to upgrade old coarse slots without changing their location. */
export function layoutFromSlots(plan, slots) {
  const position = slot => {
    const offset = ((slot.size ?? BASE_SIZE) - BASE_SIZE) / 2;
    return { column: slot.x - plan.origin.x - offset, row: slot.y - plan.origin.y - offset };
  };
  return normalizeGridLayout({ version: GRID_LAYOUT_VERSION,
    ...(plan.layout?.explicit !== undefined ? { explicit: plan.layout.explicit } : {}),
    players: slots.filter(slot => slot.type === 'player').map(slot => ({ playerId: slot.playerId, ...position(slot) })),
    obstacles: slots.filter(slot => slot.type === 'obstacle').map(slot => ({ ...position(slot), size: slot.size ?? BASE_SIZE })),
  });
}

/** Preview and commit share validation. Base swaps exchange two existing footprints exactly. */
export function previewGridMove(plan, kind, from, to, size = BASE_SIZE) {
  try {
    if (!['player', 'obstacle', 'new-obstacle', 'new-player'].includes(kind)) throw new Error('Unknown formation move.');
    const adding = kind.startsWith('new-');
    if (kind === 'new-player' && !plan.pool?.some(player => player.id === from?.playerId)) throw new Error('Choose a base from the pool.');
    const source = adding ? null : plan.slots.find(slot => slot.type === kind &&
      slot.column === from?.column && slot.row === from?.row);
    if (!adding && !source) throw new Error('Choose a base or obstacle to move.');
    if (source?.status === 'placed') throw new Error('This base is confirmed. Undo its confirmation before moving it.');
    size = kind === 'new-player' ? BASE_SIZE : source?.size ?? obstacleSize(size);
    if (!to) {
      if (kind !== 'obstacle') throw new Error('Choose a destination on the map.');
      return { valid: true, size };
    }
    const candidate = { ...gridPosition(to, size), size };
    gridCoordinates(plan.origin, candidate);
    if (kind === 'player') {
      const center = { column: candidate.column + 1, row: candidate.row + 1, size: 1 };
      const target = plan.slots.find(slot => slot !== source && slot.type === 'player' && overlaps(center, slot));
      if (target?.status === 'placed') throw new Error('This base is confirmed. Undo its confirmation before swapping it.');
      if (target) {
        // Both bases have the same footprint, so exchanging their exact positions leaves all other occupants untouched.
        return { valid: true, size, to: { column: target.column, row: target.row },
          swap: { playerId: target.playerId, name: target.name } };
      }
    }
    const collision = plan.slots.find(slot => slot !== source && overlaps(candidate, slot));
    if (collision?.status === 'placed') throw new Error('This footprint overlaps a confirmed base. Choose an empty area.');
    if (collision) throw new Error('This footprint overlaps a base or obstacle. Choose an empty area.');
    return { valid: true, size, to: { column: candidate.column, row: candidate.row } };
  } catch (error) {
    return { valid: false, size, error: error.message };
  }
}

/** Only occupants become DOM elements; empty cells are a lightweight grid background. */
export function gridCanvas(slots, padding = 1) {
  const minColumn = Math.min(0, ...slots.map(tile => tile.column)) - padding;
  const minRow = Math.min(0, ...slots.map(tile => tile.row)) - padding;
  const maxColumn = Math.max(2, ...slots.map(tile => tile.column + tile.size - 1)) + padding;
  const maxRow = Math.max(2, ...slots.map(tile => tile.row + tile.size - 1)) + padding;
  return { minColumn, minRow, columns: maxColumn - minColumn + 1, rows: maxRow - minRow + 1 };
}
