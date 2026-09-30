/** Signed grid positions keep a free formation independent of its visible rectangle. */
export const tileKey = ({ column, row }) => `${column},${row}`;
export const tilePosition = (slot, columns) => ({
  column: slot.column ?? slot.slotIndex % columns,
  row: slot.row ?? Math.floor(slot.slotIndex / columns),
});

function position(value) {
  if (!value || !Number.isSafeInteger(value.column) || !Number.isSafeInteger(value.row)) {
    throw new Error('Choose a valid whole-number tile position.');
  }
  return { column: value.column, row: value.row };
}

export function normalizeFreeLayout(layout) {
  if (!layout || !Array.isArray(layout.players) || !Array.isArray(layout.obstacles)) {
    throw new Error('The saved formation positions are invalid.');
  }
  const tiles = new Set();
  const ids = new Set();
  const claim = value => {
    const tile = position(value);
    if (tiles.has(tileKey(tile))) throw new Error('Two occupants cannot share a tile.');
    tiles.add(tileKey(tile));
    return tile;
  };
  return {
    players: layout.players.map(player => {
      if (typeof player?.playerId !== 'string' || !player.playerId.trim() || ids.has(player.playerId)) {
        throw new Error('Each formation position needs a unique player ID.');
      }
      ids.add(player.playerId);
      return { playerId: player.playerId, ...claim(player) };
    }),
    obstacles: layout.obstacles.map(claim),
  };
}

/** New roster members fill free default tiles; known players keep their chosen positions. */
export function resolveFreeLayout(players, layout, columns) {
  const clean = normalizeFreeLayout(layout);
  const ids = new Set(players.map(player => player.id));
  const known = new Map(clean.players.filter(tile => ids.has(tile.playerId)).map(tile => [tile.playerId, tile]));
  const taken = new Set([...known.values(), ...clean.obstacles].map(tileKey));
  let index = 0;
  return { players: players.map(player => {
    if (known.has(player.id)) return known.get(player.id);
    let tile;
    do { tile = { column: index % columns, row: Math.floor(index++ / columns) }; } while (taken.has(tileKey(tile)));
    taken.add(tileKey(tile));
    return { playerId: player.id, ...tile };
  }), obstacles: clean.obstacles };
}

export function nextFreeTile(from, taken, tiles, columns) {
  const min = Math.min(0, ...tiles.map(tile => tile.column));
  const max = Math.max(columns - 1, ...tiles.map(tile => tile.column));
  let { column, row } = position(from);
  do {
    if (column >= max) { column = min; row++; } else column++;
    position({ column, row });
  } while (taken.has(tileKey({ column, row })));
  return { column, row };
}

/** An unexpected obstacle relocates only the affected player, reserving everyone else's tile. */
export function projectFreePositions(session) {
  const remaining = session.layout.players.slice(session.playerIndex);
  const taken = new Set([...session.layout.obstacles, ...session.occupants].map(tileKey));
  const reserved = new Set(remaining.map(tileKey));
  const bounds = [...session.layout.players, ...session.layout.obstacles, ...session.occupants];
  return remaining.map((target, offset) => {
    reserved.delete(tileKey(target));
    const tile = taken.has(tileKey(target))
      ? nextFreeTile(target, new Set([...taken, ...reserved]), bounds, session.columns) : position(target);
    taken.add(tileKey(tile));
    return { ...tile, player: session.players[session.playerIndex + offset] };
  });
}

/** Move/swap positions, keeping IDs, roster order, other players, and intentional gaps intact. */
export function changeDraftFormation(draft, plan, slots, kind, from, to) {
  if (!['player', 'obstacle', 'new-obstacle'].includes(kind)) throw new Error('Unknown formation move.');
  if (from !== null) position(from);
  if (to !== null) position(to);
  const players = slots.filter(slot => slot.type === 'player').map(slot => ({ playerId: slot.playerId, ...tilePosition(slot, plan.columns) }));
  let obstacles = slots.filter(slot => slot.type === 'obstacle').map(slot => tilePosition(slot, plan.columns));
  const same = (a, b) => a && b && tileKey(a) === tileKey(b);
  if (same(from, to)) return draft;
  if (to && obstacles.some(tile => same(tile, to))) throw new Error('Remove or move the obstacle before using that tile.');
  const target = players.find(tile => same(tile, to));
  if (kind === 'player') {
    const source = players.find(tile => same(tile, from));
    if (!source || !to) throw new Error('Choose a player and a destination tile.');
    if (target) Object.assign(target, position(from));
    Object.assign(source, position(to));
  } else {
    if (kind === 'obstacle' && !obstacles.some(tile => same(tile, from))) throw new Error('That tile has no obstacle.');
    obstacles = obstacles.filter(tile => !same(tile, from));
    if (to) {
      obstacles.push(position(to));
      if (target) {
        const taken = new Set([...players, ...obstacles].map(tileKey));
        Object.assign(target, from ?? nextFreeTile(to, taken, [...players, ...obstacles], plan.columns));
      }
    }
  }
  return { ...draft, orderedPlayers: plan.players, plannedObstacles: [], layout: normalizeFreeLayout({ players, obstacles }) };
}

/** A fresh empty border appears after each move; wide saved layouts stay sparse. */
export function formationCanvas(plan, slots, padding = 0) {
  const tiles = slots.map(slot => ({ ...slot, ...tilePosition(slot, plan.columns) }));
  const minColumn = Math.min(0, ...tiles.map(tile => tile.column)) - padding;
  const minRow = Math.min(0, ...tiles.map(tile => tile.row)) - padding;
  const maxColumn = Math.max(plan.columns - 1, ...tiles.map(tile => tile.column)) + padding;
  const maxRow = Math.max(Math.ceil(plan.players.length / plan.columns) - 1, ...tiles.map(tile => tile.row)) + padding;
  const columns = maxColumn - minColumn + 1;
  const rows = maxRow - minRow + 1;
  const byTile = new Map(tiles.map(tile => [tileKey(tile), tile]));
  const addEmpty = (column, row) => {
    if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) return;
    const tile = { column, row, type: 'empty' };
    if (!byTile.has(tileKey(tile))) byTile.set(tileKey(tile), tile);
  };
  if (padding && columns * rows <= 4096) {
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) addEmpty(column, row);
    }
  } else if (padding) {
    for (const { column, row } of tiles) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) addEmpty(column + dx, row + dy);
    }
  }
  return { minColumn, minRow, columns, rows,
    tiles: [...byTile.values()].sort((a, b) => a.row - b.row || a.column - b.column) };
}
