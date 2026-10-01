import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGridLayout, gridCanvas, previewGridMove, overlaps, gridCoordinates, layoutFromSlots } from '../grid-layout.js';
import { formatPlacementMessage } from '../placement-messages.js';
import { createSession, getFormation } from '../placement.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace } from '../storage.js';
import { getTilePlan, moveTile, migrateTileWorkspace, openTilePlacement, confirmTilePlacement,
  updateTileDraft } from '../tile-placement.js';

const initial = () => ({ ...DEFAULT_DRAFT, names: 'A\nB\nC\nD' });
const slots = draft => getTilePlan(draft).slots;
const position = (column, row) => ({ column, row });
const obstacle = (draft, column, row, size) => moveTile(draft, 'new-obstacle', null, position(column, row), size);
const reload = draft => {
  let raw;
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  saveWorkspace(storage, draft, null);
  const saved = loadWorkspace(storage);
  return migrateTileWorkspace(saved.draft, saved.session);
};

test('base targets identify the center cell of their nine-cell footprint before and after a move', () => {
  let draft = initial();
  for (const target of [null, position(-4, 6)]) {
    if (target) draft = moveTile(draft, 'player', position(0, 0), target);
    const plan = getTilePlan(draft);
    const base = plan.slots[0];
    const expected = target ? { x: 408, y: 693 } : { x: 412, y: 687 };
    assert.deepEqual({ x: base.x, y: base.y }, expected);
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const cell = { column: base.column + dx, row: base.row + dy, size: 1 };
      assert.deepEqual(gridCoordinates(plan.origin, cell), { x: expected.x + dx - 1, y: expected.y + dy - 1 });
      assert.equal(previewGridMove(plan, 'new-obstacle', null, cell, 1).valid, false);
    }
    assert.match(formatPlacementMessage({ player: plan.players[0], ...base }), new RegExp(`X: ${expected.x}, Y: ${expected.y}`));
  }
});

test('both obstacle sizes share the same cell coordinates and round-trip without shifting', () => {
  let draft = obstacle(initial(), 3, 1, 1); // Gap immediately east of the first base's center row.
  draft = obstacle(draft, -4, -4, 3);
  const plan = getTilePlan(draft);
  assert.deepEqual(plan.slots.filter(s => s.type === 'obstacle').map(s => [s.x, s.y, s.size]), [[414, 687, 1], [408, 683, 3]]);
  assert.deepEqual(layoutFromSlots(plan, plan.slots), draft.layout);
  draft = openTilePlacement(draft, 'player-1');
  draft = confirmTilePlacement(draft, 'player-1');
  assert.deepEqual(draft.tilePlacements[0].confirmed, { x: 412, y: 687 });
  assert.deepEqual(getTilePlan(reload(draft)), getTilePlan(draft));
});

test('existing unit-grid saves retain base targets, copied messages, locks and relative obstacle positions', () => {
  const saved = { ...initial(), layout: { version: 2,
    players: [{ playerId: 'player-1', column: 0, row: 0 }, { playerId: 'player-2', column: 4, row: 0 },
      { playerId: 'player-3', column: 0, row: 4 }, { playerId: 'player-4', column: 4, row: 4 }],
    obstacles: [{ column: 3, row: 1, size: 1 }, { column: -4, row: 0, size: 3 }] },
    tilePlacements: [{ playerId: 'player-1', status: 'placed', confirmed: { x: 412, y: 687 } },
      { playerId: 'player-2', status: 'in-progress', copied: { x: 416, y: 687, name: 'B', language: 'en' } }] };
  const restored = reload(saved);
  const plan = getTilePlan(restored);
  assert.deepEqual(restored.layout, saved.layout);
  assert.deepEqual(restored.tilePlacements, saved.tilePlacements);
  assert.deepEqual(plan.slots.slice(0, 4).map(s => [s.x, s.y]), [[412, 687], [416, 687], [412, 691], [416, 691]]);
  assert.equal(plan.slots[0].status, 'placed');
  assert.equal(plan.slots[1].messageChanged, false);
  assert.deepEqual(layoutFromSlots(plan, plan.slots), saved.layout);
});

test('coordinate limits account for footprint edges on both sides of the center', () => {
  for (const x of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => gridCoordinates({ x, y: 0 }, { column: 0, row: 0, size: 3 }), /range/);
  }
  for (const x of [Number.MIN_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER - 1]) {
    assert.deepEqual(gridCoordinates({ x, y: 0 }, { column: 0, row: 0, size: 3 }), { x, y: 0 });
  }
});

test('initial spacing remains intact while manual movement snaps to a single coordinate', () => {
  for (const spacing of ['0', '1', '5']) {
    let draft = { ...initial(), spacing };
    assert.deepEqual(slots(draft).map(s => [s.column, s.row, s.size]), [
      [0, 0, 3], [3 + Number(spacing), 0, 3], [0, 3 + Number(spacing), 3], [3 + Number(spacing), 3 + Number(spacing), 3],
    ]);
    const before = slots(draft);
    draft = moveTile(draft, 'player', position(0, 0), position(-1, 0));
    assert.equal(slots(draft)[0].x, 411);
    assert.deepEqual(slots(draft).slice(1), before.slice(1));
    draft = updateTileDraft(draft, { spacing: '9' });
    assert.equal(slots(draft)[0].x, 411);
    assert.deepEqual(slots(draft).slice(1), before.slice(1));
  }
});

test('one-cell obstacles fit in gaps, larger footprints reject partial overlaps without mutation', () => {
  const original = initial();
  const before = structuredClone(original);
  for (const [x, y, size] of [[2, 1, 1], [3, 1, 3], [-2, -2, 3]]) {
    assert.throws(() => obstacle(original, x, y, size), /overlap/);
  }
  assert.deepEqual(original, before);
  let draft = obstacle(original, 3, 1, 1);
  assert.deepEqual(slots(draft).slice(0, 4), slots(original));
  assert.throws(() => obstacle(draft, 3, 1, 1), /overlap/);
  draft = obstacle(draft, 7, 0, 3); // Edge contact is allowed.
  draft = moveTile(draft, 'obstacle', position(7, 0), position(8, -1));
  assert.equal(slots(draft).at(-1).size, 3);
  draft = moveTile(draft, 'obstacle', position(3, 1), position(3, 2));
  assert.equal(slots(draft).find(s => s.column === 3 && s.row === 2).size, 1);
  assert.deepEqual(reload(draft), draft);
  draft = moveTile(draft, 'obstacle', position(3, 2), null);
  assert.equal(slots(draft).filter(s => s.type === 'obstacle').length, 1);
});

test('preview and commit agree for every anchor near a base and both obstacle sizes', () => {
  const draft = obstacle(initial(), 3, 1, 1);
  const plan = getTilePlan(draft);
  for (const size of [1, 3]) for (let row = -3; row <= 8; row++) for (let column = -3; column <= 8; column++) {
    const to = position(column, row);
    const preview = previewGridMove(plan, 'new-obstacle', null, to, size);
    if (preview.valid) assert.doesNotThrow(() => obstacle(draft, column, row, size));
    else assert.throws(() => obstacle(draft, column, row, size), /overlap/);
  }
});

test('confirmed bases protect all nine cells, and moving a base may overlap its own previous footprint', () => {
  let draft = confirmTilePlacement(openTilePlacement(initial(), 'player-1'), 'player-1');
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    assert.throws(() => obstacle(draft, column, row, 1), /confirmed/);
  }
  draft = moveTile(draft, 'player', position(4, 0), position(3, 0));
  assert.equal(slots(draft)[0].status, 'placed');
  assert.equal(slots(draft)[1].x, 415);
});

test('base previews and commits agree on swaps, empty moves, obstacles, and partial overlaps', () => {
  const draft = obstacle(initial(), 3, 1, 1);
  const plan = getTilePlan(draft);
  const source = plan.slots[0];
  const before = structuredClone(draft);
  for (let row = -3; row <= 8; row++) for (let column = -3; column <= 8; column++) {
    const to = position(column, row);
    const preview = previewGridMove(plan, 'player', source, to);
    if (!preview.valid) {
      assert.throws(() => moveTile(draft, 'player', source, to), /overlap/);
      continue;
    }
    const result = slots(moveTile(draft, 'player', source, to));
    assert.deepEqual(position(result[0].column, result[0].row), preview.to);
    for (let index = 1; index < result.length; index++) {
      const old = plan.slots[index];
      if (preview.swap && old.playerId === preview.swap.playerId) {
        assert.deepEqual(position(result[index].column, result[index].row), position(source.column, source.row));
      } else assert.deepEqual(result[index], old);
    }
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) assert.equal(overlaps(result[i], result[j]), false);
  }
  assert.deepEqual(draft, before);
  assert.deepEqual(previewGridMove(plan, 'player', source, position(5, 1)).swap, { playerId: 'player-2', name: 'B' });
  assert.equal(previewGridMove(plan, 'obstacle', position(3, 1), position(4, 1)).valid, false);
});

test('legacy layouts migrate actual signed coordinates, metadata, locks, copy state, and 3 × 3 obstacles once', () => {
  const players = ['A', 'B'].map((name, i) => ({ id: `lastwar:${i}`, name, hqLevel: 35, group: 4 }));
  let old = { ...DEFAULT_DRAFT, names: 'A\nB', spacing: '2', importedPlayers: players,
    rosterContext: { serverId: 123, allianceId: 'a'.repeat(32), allianceName: 'Test', allianceTag: 'T' },
    selectedPlayerId: players[1].id,
    layout: { players: [{ playerId: players[0].id, column: -2, row: 1 }, { playerId: players[1].id, column: 1, row: -3 }],
      obstacles: [position(0, 0), position(2, -2)] },
    tilePlacements: [
      { playerId: players[0].id, status: 'placed', confirmed: { x: 402, y: 692 } },
      { playerId: players[1].id, status: 'in-progress', copied: { x: 417, y: 672, name: 'B', language: 'fr' } },
    ],
  };
  const next = reload(old);
  assert.deepEqual(slots(next).map(s => [s.x, s.y, s.size]).sort(), [[402, 692, 3], [417, 672, 3], [412, 687, 3], [422, 677, 3]].sort());
  assert.equal(slots(next)[0].status, 'placed');
  assert.equal(slots(next)[1].messageChanged, false);
  assert.deepEqual(next.tilePlacements, old.tilePlacements);
  assert.deepEqual(next.importedPlayers, players);
  assert.deepEqual(next.rosterContext, old.rosterContext);
  assert.equal(next.selectedPlayerId, players[1].id);
  assert.deepEqual(reload(next), next);
  assert.equal(migrateTileWorkspace(next, null), next);
});

test('old planned obstacle indexes preserve the initial projected coordinates', () => {
  const draft = { ...initial(), plannedObstacles: [0, 3, 8] };
  const before = getFormation(createSession({ players: getTilePlan(initial()).players, x0: 412, y0: 687, spacing: 1, plannedObstacles: draft.plannedObstacles }));
  const next = migrateTileWorkspace(draft, null);
  assert.deepEqual(slots(next).map(s => [s.type, s.x, s.y]).sort(), before.map(s => [s.type, s.x, s.y]).sort());
});

test('unfinished legacy setups remain editable and migrate once their input is complete', () => {
  const draft = { ...initial(), x: '', layout: { players: [{ playerId: 'player-1', column: -1, row: 0 }], obstacles: [] } };
  assert.equal(migrateTileWorkspace(draft, null), draft);
  const completed = migrateTileWorkspace({ ...draft, x: '412' }, null);
  assert.equal(slots(completed)[0].x, 408);
  assert.equal(completed.layout.version, 2);
});

test('adding roster members avoids every footprint while preserving existing placements and obstacles', () => {
  let draft = obstacle(initial(), 7, 0, 1);
  draft = moveTile(draft, 'player', position(4, 4), position(8, 2));
  const before = slots(draft);
  draft = updateTileDraft(draft, { names: 'A\nB\nC\nD\nE\nF' });
  for (const previous of before) {
    assert.deepEqual(slots(draft).find(s => previous.playerId ? s.playerId === previous.playerId : s.type === 'obstacle'), previous);
  }
  const after = slots(draft);
  for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) assert.equal(overlaps(after[i], after[j]), false);
});

test('invalid sizes, overlapping saved footprints, unsupported versions, and unsafe footprint edges are rejected', () => {
  const empty = { version: 2, players: [], obstacles: [] };
  for (const size of [0, 2, 4, 1.5, '1', undefined]) assert.throws(() => normalizeGridLayout({ ...empty, obstacles: [{ column: 0, row: 0, size }] }));
  assert.throws(() => normalizeGridLayout({ ...empty, version: 3 }));
  assert.throws(() => normalizeGridLayout({ ...empty, players: [{ playerId: 'a', column: 0, row: 0 }], obstacles: [{ column: 2, row: 2, size: 1 }] }), /overlap/);
  assert.throws(() => obstacle(initial(), Number.MAX_SAFE_INTEGER - 412, 0, 3), /range/);
  assert.throws(() => moveTile(initial(), 'player', position(0, 0), position(0.5, 0)), /whole-number/);
});

test('canvas includes full footprints and stays sparse even for widely separated bases', () => {
  const canvas = gridCanvas([{ column: -10, row: -5, size: 1 }, { column: 1000, row: 2, size: 3 }], 3);
  assert.deepEqual(canvas, { minColumn: -13, minRow: -8, columns: 1019, rows: 16 });
  assert.equal(canvas.tiles, undefined);
});
