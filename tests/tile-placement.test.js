import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace } from '../storage.js';
import { createSession, applyAction, getFormation } from '../placement.js';
import { getTilePlan, openTilePlacement, confirmTilePlacement, undoTileConfirmation, cancelTilePlacement,
  recordCopiedMessage, moveTile, updateTileDraft, resetTileProgress, migrateTileWorkspace } from '../tile-placement.js';

const roster = ['A', 'B', 'C', 'D'].map((name, i) => ({ id: 'lastwar:' + i, name, hqLevel: 30 + i, group: i + 1 }));
const initial = () => ({ ...DEFAULT_DRAFT, names: 'A\nB\nC\nD', importedPlayers: roster });
const tile = (draft, id) => getTilePlan(draft).slots.find(slot => slot.playerId === id);
const proposal = (draft, id) => ({ player: roster.find(player => player.id === id), x: tile(draft, id).x, y: tile(draft, id).y });
const xy = (draft, id) => { const { x, y } = tile(draft, id); return [x, y]; };
const confirm = (draft, id) => confirmTilePlacement(openTilePlacement(draft, id), id);

test('any player can be started and confirmed independently, with multiple placements in progress', () => {
  let draft = openTilePlacement(initial(), 'lastwar:3');
  draft = openTilePlacement(draft, 'lastwar:1');
  assert.equal(tile(draft, 'lastwar:0').status, 'planned');
  assert.equal(tile(draft, 'lastwar:3').status, 'in-progress');
  draft = confirmTilePlacement(draft, 'lastwar:3');
  assert.equal(tile(draft, 'lastwar:3').status, 'placed');
  assert.equal(tile(draft, 'lastwar:1').status, 'in-progress');
  assert.equal(draft.selectedPlayerId, 'lastwar:1');
  assert.equal(getTilePlan(draft).players[3].hqLevel, 33);
  assert.throws(() => confirmTilePlacement(draft, 'lastwar:0'), /panel/);
});

test('copying does not confirm arrival; moving a copied base warns until updated coordinates are copied', () => {
  let draft = openTilePlacement(initial(), 'lastwar:0');
  draft = recordCopiedMessage(draft, proposal(draft, 'lastwar:0'), 'fr');
  assert.equal(tile(draft, 'lastwar:0').status, 'in-progress');
  draft = moveTile(draft, 'player', { column: 0, row: 0 }, { column: -2, row: 0 });
  assert.equal(tile(draft, 'lastwar:0').messageChanged, true);
  assert.deepEqual(xy(draft, 'lastwar:0'), [404, 687]);
  draft = recordCopiedMessage(draft, proposal(draft, 'lastwar:0'), 'ko');
  assert.equal(tile(draft, 'lastwar:0').messageChanged, false);
  assert.equal(draft.tilePlacements[0].copied.language, 'ko');
});

test('pending clipboard completion records the old coordinates after a move and ignores cancelled placement', () => {
  let draft = openTilePlacement(initial(), 'lastwar:0');
  const pending = proposal(draft, 'lastwar:0');
  draft = moveTile(draft, 'player', { column: 0, row: 0 }, { column: 0, row: -1 });
  draft = recordCopiedMessage(draft, pending, 'en');
  assert.equal(tile(draft, 'lastwar:0').messageChanged, true);
  draft = cancelTilePlacement(draft, 'lastwar:0');
  assert.deepEqual(recordCopiedMessage(draft, pending, 'en'), draft);
});

test('confirmed bases cannot be moved, swapped, or displaced by obstacles, while other bases remain movable', () => {
  let draft = confirm(initial(), 'lastwar:0');
  assert.throws(() => moveTile(draft, 'player', { column: 0, row: 0 }, { column: 3, row: 0 }), /confirmed/);
  assert.throws(() => moveTile(draft, 'player', { column: 1, row: 0 }, { column: 0, row: 0 }), /confirmed/);
  assert.throws(() => moveTile(draft, 'new-obstacle', null, { column: 0, row: 0 }), /confirmed/);
  draft = moveTile(draft, 'player', { column: 1, row: 0 }, { column: 3, row: 0 });
  draft = moveTile(draft, 'new-obstacle', null, { column: 1, row: 1 });
  assert.deepEqual(xy(draft, 'lastwar:0'), [412, 687]);
  assert.equal(tile(draft, 'lastwar:0').status, 'placed');
  assert.equal(tile(draft, 'lastwar:1').column, 3);
});

test('swapping two in-progress players invalidates both copied messages and leaves their status intact', () => {
  let draft = initial();
  for (const id of ['lastwar:0', 'lastwar:1']) {
    draft = openTilePlacement(draft, id);
    draft = recordCopiedMessage(draft, proposal(draft, id), 'en');
  }
  draft = moveTile(draft, 'player', { column: 0, row: 0 }, { column: 1, row: 0 });
  for (const id of ['lastwar:0', 'lastwar:1']) {
    assert.equal(tile(draft, id).messageChanged, true);
    assert.equal(tile(draft, id).status, 'in-progress');
  }
});

test('undo unlocks only the selected base; cancellation returns it to planned; reset preserves geometry', () => {
  let draft = confirm(confirm(initial(), 'lastwar:0'), 'lastwar:1');
  assert.throws(() => cancelTilePlacement(draft, 'lastwar:0'), /confirmation/);
  draft = undoTileConfirmation(draft, 'lastwar:0');
  draft = moveTile(draft, 'player', { column: 0, row: 0 }, { column: -1, row: -1 });
  assert.equal(tile(draft, 'lastwar:1').status, 'placed');
  draft = cancelTilePlacement(draft, 'lastwar:0');
  assert.equal(tile(draft, 'lastwar:0').status, 'planned');
  const reset = resetTileProgress(draft);
  assert.deepEqual(reset.layout, draft.layout);
  assert.equal(getTilePlan(reset).slots.every(slot => slot.status === 'planned'), true);
  assert.equal(reset.selectedPlayerId, null);
});

test('starting point, spacing and roster edits cannot invalidate confirmed coordinates or identities', () => {
  const draft = confirm(initial(), 'lastwar:1');
  assert.throws(() => updateTileDraft(draft, { x: '500' }), /confirmation/);
  assert.throws(() => updateTileDraft(draft, { spacing: '5' }), /confirmation/);
  assert.throws(() => updateTileDraft(draft, { names: 'A\nC\nD' }), /confirmation/);
  assert.throws(() => updateTileDraft(draft, { names: 'A\nRenamed\nC\nD' }), /confirmation/);
  assert.deepEqual(xy(draft, 'lastwar:1'), [416, 687]);
});

test('removing an unconfirmed player clears progress and selection without giving it to a replacement', () => {
  let draft = openTilePlacement(initial(), 'lastwar:1');
  draft = updateTileDraft(draft, { names: 'A\nNew player\nC\nD' });
  assert.equal(draft.selectedPlayerId, null);
  assert.deepEqual(draft.tilePlacements, []);
  assert.equal(getTilePlan(draft).slots.every(slot => slot.status === 'planned'), true);
});

test('statuses, selected player, copied coordinates, metadata and custom positions survive local reload', () => {
  let draft = confirm(initial(), 'lastwar:0');
  draft = openTilePlacement(draft, 'lastwar:2');
  draft = recordCopiedMessage(draft, proposal(draft, 'lastwar:2'), 'pt-BR');
  draft = moveTile(draft, 'player', { column: 0, row: 1 }, { column: -1, row: 1 });
  let raw;
  const storage = { setItem: (key, value) => { raw = value; }, getItem: () => raw };
  saveWorkspace(storage, draft, null);
  const loaded = loadWorkspace(storage);
  assert.equal(loaded.session, null);
  assert.deepEqual(getTilePlan(loaded.draft), getTilePlan(draft));
  assert.equal(loaded.draft.selectedPlayerId, 'lastwar:2');
  assert.equal(tile(loaded.draft, 'lastwar:2').messageChanged, true);
});

test('legacy sequential plans migrate confirmed bases and discovered obstacles at their actual coordinates', () => {
  for (const custom of [false, true]) {
    let session = createSession({ players: roster, x0: 412, y0: 687, spacing: 1,
      ...(custom ? { layout: { players: roster.map((p, i) => ({ playerId: p.id, column: i - 2, row: -1 })), obstacles: [{ column: 2, row: 2 }] } } : {}) });
    for (const action of ['placed', 'obstacle', 'placed']) session = applyAction(session, action);
    const old = getFormation(session);
    const draft = migrateTileWorkspace(initial(), session);
    const slots = getTilePlan(draft).slots;
    for (const slot of old) {
      const match = slot.type === 'player' ? slots.find(item => item.playerId === slot.playerId) : slots.find(item => item.type === 'obstacle' && item.x === slot.x && item.y === slot.y);
      assert.ok(match);
      assert.deepEqual([match.x, match.y], [slot.x, slot.y]);
      if (slot.status === 'placed') assert.equal(match.status, 'placed');
    }
    assert.equal(slots.filter(slot => slot.status === 'placed').length, 2);
  }
});

test('completed legacy plans migrate all confirmations and remain reversible one base at a time', () => {
  let session = createSession({ players: roster, x0: 412, y0: 687, spacing: 1 });
  for (const player of roster) session = applyAction(session, 'placed');
  let draft = migrateTileWorkspace(initial(), session);
  assert.equal(getTilePlan(draft).slots.every(slot => slot.status === 'placed'), true);
  draft = undoTileConfirmation(draft, 'lastwar:2');
  assert.equal(getTilePlan(draft).slots.filter(slot => slot.status === 'placed').length, 3);
});
