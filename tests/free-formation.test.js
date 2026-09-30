import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, getFormation, getProposal, applyAction, undoLastAction, serializeSession, restoreSession, tileToCoordinate } from '../placement.js';
import { changeDraftFormation, formationCanvas, normalizeFreeLayout, tileKey } from '../free-formation.js';
import { playersFromDraft } from '../players.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace } from '../storage.js';
import { formatPlacementMessage } from '../placement-messages.js';

const roster = ['A', 'B', 'C', 'D'].map((name, index) => ({ id: `lastwar:${index}`, name, hqLevel: 30 + index, group: index + 1 }));
const initial = () => ({ ...DEFAULT_DRAFT, names: 'A\nB\nC\nD', importedPlayers: roster });
const plan = draft => createSession({ players: playersFromDraft(draft), x0: Number(draft.x), y0: Number(draft.y),
  spacing: Number(draft.spacing), plannedObstacles: draft.plannedObstacles, layout: draft.layout });
function move(draft, kind, from, to) {
  const session = plan(draft);
  return changeDraftFormation(draft, session, getFormation(session), kind, from, to);
}
const at = (session, id) => getFormation(session).find(slot => slot.playerId === id);

test('players can move beyond all four original edges, retaining gaps, metadata, and everyone else’s position', () => {
  const original = initial();
  for (const to of [{ column: -2, row: 0 }, { column: 4, row: 0 }, { column: 0, row: -3 }, { column: 0, row: 5 }]) {
    const draft = move(original, 'player', { column: 0, row: 0 }, to);
    const session = plan(draft);
    assert.deepEqual(playersFromDraft(draft), roster);
    assert.deepEqual([at(session, 'lastwar:0').x, at(session, 'lastwar:0').y], [412 + to.column * 4, 687 + to.row * 4]);
    assert.deepEqual([at(session, 'lastwar:1').x, at(session, 'lastwar:1').y], [416, 687]);
    assert.equal(getFormation(session).some(tile => tile.column === 0 && tile.row === 0), false);
    assert.equal(getProposal(session).player.hqLevel, 30);
    assert.equal(getProposal(session).player.group, 1);
  }
  assert.equal(original.layout, undefined);
});

test('occupied player drops swap two positions without moving a third player or changing placement order', () => {
  const draft = move(initial(), 'player', { column: 0, row: 0 }, { column: 1, row: 1 });
  const session = plan(draft);
  assert.deepEqual(session.players, roster);
  assert.equal(at(session, 'lastwar:0').column, 1);
  assert.equal(at(session, 'lastwar:0').row, 1);
  assert.equal(at(session, 'lastwar:3').column, 0);
  assert.equal(at(session, 'lastwar:3').row, 0);
  assert.equal(at(session, 'lastwar:1').column, 1);
  assert.equal(at(session, 'lastwar:1').row, 0);
});

test('obstacles can be added, moved, and removed beyond the rectangle without shifting other players', () => {
  const outside = { column: -1, row: -1 };
  const added = move(initial(), 'new-obstacle', null, outside);
  assert.deepEqual(added.layout.obstacles, [outside]);
  const moved = move(added, 'obstacle', outside, { column: 0, row: 0 });
  assert.deepEqual(moved.layout.obstacles, [{ column: 0, row: 0 }]);
  assert.equal(at(plan(moved), 'lastwar:0').column, -1);
  assert.equal(at(plan(moved), 'lastwar:0').row, -1);
  assert.equal(at(plan(moved), 'lastwar:1').x, 416);
  const removed = move(moved, 'obstacle', { column: 0, row: 0 }, null);
  assert.deepEqual(removed.layout.obstacles, []);
  assert.equal(at(plan(removed), 'lastwar:0').x, 408);
  assert.throws(() => move(added, 'player', { column: 0, row: 0 }, outside), /obstacle/);
});

test('dropping a new obstacle on a player finds a free tile without moving other reserved players', () => {
  const draft = move(initial(), 'new-obstacle', null, { column: 0, row: 0 });
  const session = plan(draft);
  assert.deepEqual([at(session, 'lastwar:0').column, at(session, 'lastwar:0').row], [0, 2]);
  assert.deepEqual([at(session, 'lastwar:1').column, at(session, 'lastwar:1').row], [1, 0]);
  assert.equal(new Set(getFormation(session).map(tileKey)).size, 5);
});

test('custom positions drive placement and messages; unexpected obstacles preserve other assignments and undo exactly', () => {
  const draft = move(initial(), 'player', { column: 0, row: 0 }, { column: -1, row: -1 });
  const start = plan(draft);
  assert.match(formatPlacementMessage(getProposal(start)), /A!.*X: 408, Y: 683/);
  let session = start;
  const actions = ['obstacle', 'obstacle', 'placed', 'obstacle', 'placed', 'placed', 'placed'];
  for (const action of actions) {
    const next = applyAction(session, action);
    assert.deepEqual(undoLastAction(next), session);
    assert.equal(new Set(getFormation(next).map(tileKey)).size, getFormation(next).length);
    session = next;
  }
  assert.equal(getProposal(session), null);
  assert.deepEqual(restoreSession(JSON.parse(JSON.stringify(serializeSession(session)))), session);
  for (const action of actions) session = undoLastAction(session);
  assert.deepEqual(session, start);
});

test('free drafts and active placements survive reload with imported details and obstacles', () => {
  let draft = { ...initial(), plannedObstacles: [0, 7] };
  draft = move(draft, 'player', { column: 1, row: 0 }, { column: 3, row: -2 });
  assert.deepEqual(draft.plannedObstacles, []);
  assert.deepEqual(draft.layout.obstacles, [{ column: 0, row: 0 }, { column: 1, row: 3 }]);
  const session = applyAction(plan(draft), 'placed');
  let raw;
  const storage = { setItem: (_, value) => { raw = value; }, getItem: () => raw };
  saveWorkspace(storage, draft, session);
  assert.deepEqual(loadWorkspace(storage), { draft, session });
  assert.deepEqual(undoLastAction(loadWorkspace(storage).session), plan(draft));
});

test('roster edits retain matched positions and allocate new members without collisions', () => {
  const draft = move(initial(), 'player', { column: 0, row: 0 }, { column: -1, row: 2 });
  const edited = { ...draft, names: 'C\nA\nNew player' };
  const session = plan(edited);
  assert.deepEqual(session.players.map(player => player.name), ['C', 'A', 'New player']);
  assert.equal(at(session, 'lastwar:0').x, 408);
  assert.equal(at(session, 'lastwar:2').y, 691);
  assert.equal(new Set(getFormation(session).map(tileKey)).size, 3);
});

test('invalid layouts, overlapping occupants and unsafe coordinates are rejected before placement', () => {
  for (const invalid of [null, {}, { players: null, obstacles: [] },
    { players: [{ playerId: 'A', column: 0.5, row: 0 }], obstacles: [] },
    { players: [{ playerId: 'A', column: 0, row: 0 }, { playerId: 'A', column: 1, row: 0 }], obstacles: [] },
    { players: [{ playerId: 'A', column: 0, row: 0 }], obstacles: [{ column: 0, row: 0 }] }]) {
    assert.throws(() => normalizeFreeLayout(invalid));
  }
  const draft = move(initial(), 'player', { column: 0, row: 0 }, { column: Number.MAX_SAFE_INTEGER, row: 0 });
  assert.throws(() => plan(draft), /offset/);
  assert.throws(() => tileToCoordinate(plan(initial()), { column: 0, row: Number.MIN_SAFE_INTEGER }), /offset/);
});

test('preview provides empty drop targets on all sides, keeps internal gaps, and expands after a move', () => {
  const start = plan(initial());
  const canvas = formationCanvas(start, getFormation(start), 1);
  assert.equal(canvas.columns, 4);
  assert.equal(canvas.rows, 4);
  assert.equal(canvas.tiles.filter(tile => tile.type === 'empty').length, 12);
  const moved = plan(move(initial(), 'player', { column: 0, row: 0 }, { column: -1, row: -1 }));
  const expanded = formationCanvas(moved, getFormation(moved), 1);
  assert.equal(expanded.minColumn, -2);
  assert.equal(expanded.minRow, -2);
  assert.equal(expanded.tiles.find(tile => tile.column === 0 && tile.row === 0).type, 'empty');
  assert.equal(formationCanvas(moved, getFormation(moved), 2).columns, expanded.columns + 2);
  const sparse = plan(move(initial(), 'player', { column: 0, row: 0 }, { column: 10000, row: 10000 }));
  assert.ok(formationCanvas(sparse, getFormation(sparse), 1).tiles.length < 50);
});
