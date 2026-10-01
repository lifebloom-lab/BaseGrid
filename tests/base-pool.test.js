import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace } from '../storage.js';
import { overlaps, previewGridMove } from '../grid-layout.js';
import { getTilePlan, updateTileDraft, moveTile, returnBaseToPool, autoPlaceBases,
  openTilePlacement, confirmTilePlacement, undoTileConfirmation, recordCopiedMessage, migrateTileWorkspace } from '../tile-placement.js';

const roster = ['A', 'B', 'C', 'D'].map((name, index) => ({ id: `lastwar:${index}`, name, hqLevel: 30 + index, group: index + 1 }));
const fresh = () => updateTileDraft({ ...DEFAULT_DRAFT }, { names: roster.map(p => p.name).join('\n'), importedPlayers: roster });
const find = (draft, id) => getTilePlan(draft).slots.find(slot => slot.playerId === id);
const add = (draft, id, column = 0, row = 0) => moveTile(draft, 'new-player', { playerId: id }, { column, row });
const confirm = (draft, id) => confirmTilePlacement(openTilePlacement(draft, id), id);
function reload(draft) {
  let raw;
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  saveWorkspace(storage, draft, null);
  const saved = loadWorkspace(storage);
  return migrateTileWorkspace(saved.draft, saved.session);
}

test('new rosters start in a persistent pool; manual insertion keeps identity, rank and HQ', () => {
  const draft = fresh();
  assert.deepEqual(getTilePlan(draft).pool, roster);
  assert.deepEqual(getTilePlan(reload(draft)).slots, []);
  const inserted = add(draft, roster[2].id, -3, 6);
  assert.deepEqual(getTilePlan(inserted).pool, [roster[0], roster[1], roster[3]]);
  assert.deepEqual(getTilePlan(inserted).players, roster);
  assert.deepEqual([find(inserted, roster[2].id).x, find(inserted, roster[2].id).y], [409, 693]);
  assert.deepEqual(getTilePlan(reload(inserted)), getTilePlan(inserted));
  assert.equal(getTilePlan(draft).slots.length, 0);
});

test('returning an in-progress base clears its message and selection, preserves metadata and permits reinsertion', () => {
  let draft = openTilePlacement(add(fresh(), roster[0].id), roster[0].id);
  const proposal = { player: roster[0], x: 412, y: 687 };
  draft = recordCopiedMessage(draft, proposal, 'fr');
  const pooled = returnBaseToPool(draft, roster[0].id);
  assert.deepEqual(getTilePlan(pooled).pool, roster);
  assert.equal(pooled.selectedPlayerId, null);
  assert.deepEqual(pooled.tilePlacements, []);
  assert.deepEqual(recordCopiedMessage(pooled, proposal, 'fr'), pooled);
  const inserted = add(reload(pooled), roster[0].id, 8, -3);
  assert.equal(find(inserted, roster[0].id).status, 'planned');
  assert.equal(find(inserted, roster[0].id).messageChanged, false);
  assert.deepEqual(getTilePlan(inserted).players[0], roster[0]);
});

test('confirmed bases cannot return to the pool until confirmation is undone', () => {
  const locked = confirm(add(fresh(), roster[0].id), roster[0].id);
  assert.throws(() => returnBaseToPool(locked, roster[0].id), /confirmation/);
  assert.equal(find(locked, roster[0].id).status, 'placed');
  const unlocked = undoTileConfirmation(locked, roster[0].id);
  assert.equal(getTilePlan(returnBaseToPool(unlocked, roster[0].id)).pool.length, 4);
});

test('pool insertion enforces full footprints, rejects duplicate/unknown players, and never swaps', () => {
  const draft = moveTile(add(fresh(), roster[0].id), 'new-obstacle', null, { column: 4, row: 0 }, 1);
  for (const to of [{ column: 0, row: 0 }, { column: 2, row: 2 }, { column: 4, row: 0 }]) {
    const preview = previewGridMove(getTilePlan(draft), 'new-player', { playerId: roster[1].id }, to);
    assert.equal(preview.valid, false);
    assert.throws(() => add(draft, roster[1].id, to.column, to.row), /overlap/);
  }
  for (const id of [roster[0].id, 'missing', undefined]) assert.throws(() => add(draft, id, 10, 10), /pool/);
  assert.equal(find(add(draft, roster[1].id, 5, 0), roster[1].id).size, 3);
});

test('pool auto placement starts at origin, follows spacing, and keeps arranged bases, progress and obstacles', () => {
  for (const spacing of ['0', '1', '3']) {
    let draft = { ...fresh(), spacing };
    draft = add(draft, roster[2].id, -4, -4);
    draft = openTilePlacement(draft, roster[2].id);
    draft = moveTile(draft, 'new-obstacle', null, { column: 0, row: 0 }, 3);
    const before = structuredClone(draft);
    const placed = autoPlaceBases(draft, 'pool');
    const plan = getTilePlan(placed);
    assert.deepEqual(draft, before);
    assert.deepEqual(find(placed, roster[2].id), find(draft, roster[2].id));
    assert.equal(find(placed, roster[0].id).x, 412 + 3 + Number(spacing));
    assert.deepEqual(plan.pool, []);
    assert.deepEqual(plan.layout.obstacles, draft.layout.obstacles);
    for (let i = 0; i < plan.slots.length; i++) for (let j = i + 1; j < plan.slots.length; j++) assert.equal(overlaps(plan.slots[i], plan.slots[j]), false);
    assert.deepEqual(getTilePlan(autoPlaceBases(placed, 'pool')), plan);
  }
});

test('rearrange includes the pool, preserves confirmed positions and marks moved copied messages as changed', () => {
  let draft = confirm(add(fresh(), roster[0].id, 0, 0), roster[0].id);
  draft = openTilePlacement(add(draft, roster[1].id, 15, 15), roster[1].id);
  draft = recordCopiedMessage(draft, { player: roster[1], x: 427, y: 702 }, 'en');
  draft = moveTile(draft, 'new-obstacle', null, { column: 4, row: 0 }, 1);
  const result = autoPlaceBases(draft, 'rearrange');
  assert.deepEqual(find(result, roster[0].id), find(draft, roster[0].id));
  assert.deepEqual(result.tilePlacements, draft.tilePlacements);
  assert.deepEqual(result.layout.obstacles, draft.layout.obstacles);
  assert.equal(find(result, roster[1].id).status, 'in-progress');
  assert.equal(find(result, roster[1].id).messageChanged, true);
  assert.equal(find(result, roster[1].id).column, 0);
  assert.equal(find(result, roster[1].id).row, 4);
  assert.equal(getTilePlan(result).pool.length, 0);
  assert.deepEqual(getTilePlan(reload(result)), getTilePlan(result));
  assert.throws(() => autoPlaceBases(draft, 'invalid'), /Choose/);
});

test('legacy saved formations stay arranged; roster additions join the pool without moving existing bases', () => {
  const legacy = { ...DEFAULT_DRAFT, names: 'A\nB', importedPlayers: roster.slice(0, 2) };
  const previous = getTilePlan(reload(legacy)).slots;
  const added = updateTileDraft(legacy, { names: 'A\nB\nC\nD', importedPlayers: roster });
  assert.deepEqual(getTilePlan(added).slots, previous);
  assert.deepEqual(getTilePlan(added).pool, roster.slice(2));
  assert.deepEqual(getTilePlan(reload(added)), getTilePlan(added));
  const removed = updateTileDraft(added, { names: 'A\nB\nD' });
  assert.deepEqual(getTilePlan(removed).pool, [roster[3]]);
});
