import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, getProposal, getFormation, applyAction, undoLastAction, canUndo,
  serializeSession, restoreSession } from '../placement.js';
import { changeDraftObstacle, moveDraftPlayer, playersFromDraft } from '../players.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace } from '../storage.js';

const players = ['A', 'B', 'C', 'D'].map((name, index) => ({ id: `lastwar:${index}`, name, hqLevel: 30 + index, group: index + 1 }));
const start = (plannedObstacles, extra = {}) => createSession({ players, x0: 412, y0: 687, spacing: 1, plannedObstacles, ...extra });

test('preplanned obstacles occupy exact tiles and shift players without changing columns', () => {
  const plan = start([3, 0, 2]);
  assert.equal(plan.columns, 2);
  assert.deepEqual(plan.plannedObstacles, [0, 2, 3]);
  assert.deepEqual(getFormation(plan).map(slot => slot.name ?? 'blocked'), ['blocked', 'A', 'blocked', 'blocked', 'B', 'C', 'D']);
  assert.equal(getProposal(plan).slotIndex, 1);
  assert.equal(getProposal(plan).player.id, 'lastwar:0');
  assert.equal(canUndo(plan), false);
  assert.equal(undoLastAction(plan), plan);
  const next = applyAction(plan, 'placed');
  assert.equal(getProposal(next).slotIndex, 4);
  assert.equal(getProposal(next).player.id, 'lastwar:1');
  assert.equal(getProposal(next).player.hqLevel, 31);
  assert.equal(next.occupants.filter(slot => slot.automatic).length, 3);
  assert.deepEqual(undoLastAction(next), plan);
});

test('completion records all blocked tiles and never assigns a player to one', () => {
  const initial = start([0, 2, 3]);
  const finished = Array(4).fill('placed').reduce(applyAction, initial);
  assert.equal(getProposal(finished), null);
  assert.equal(finished.columns, 2);
  assert.equal(finished.occupants.length, 7);
  assert.deepEqual(finished.occupants.filter(slot => slot.type === 'player').map(slot => slot.slotIndex), [1, 4, 5, 6]);
  assert.equal(new Set(finished.occupants.map(({ x, y }) => `${x},${y}`)).size, 7);
  assert.deepEqual(getFormation(finished).filter(slot => slot.type === 'obstacle').map(slot => slot.slotIndex), [0, 2, 3]);
});

test('manual obstacles and undo coexist with automatic skips, including after completion', () => {
  const initial = start([0, 2, 5]);
  const actions = ['obstacle', 'placed', 'placed', 'obstacle', 'placed', 'placed'];
  let state = initial;
  for (const action of actions) {
    const next = applyAction(state, action);
    assert.deepEqual(undoLastAction(next), state);
    state = next;
  }
  assert.equal(getProposal(state), null);
  assert.deepEqual(serializeSession(state).actions, actions);
  const restored = restoreSession(JSON.parse(JSON.stringify(serializeSession(state))));
  assert.deepEqual(restored, state);
  for (let i = 0; i < actions.length; i++) state = undoLastAction(state);
  assert.deepEqual(state, initial);
});

test('a single-player plan can block consecutive tiles at the origin', () => {
  const initial = start([0, 1], { players: players.slice(0, 1) });
  assert.equal(initial.columns, 1);
  assert.deepEqual([getProposal(initial).x, getProposal(initial).y], [412, 695]);
  assert.equal(getProposal(applyAction(initial, 'placed')), null);
  assert.deepEqual(undoLastAction(applyAction(initial, 'placed')), initial);
});

test('markers beyond the current roster stay visible and fixed if the roster becomes shorter', () => {
  const plan = start([7], { players: players.slice(0, 2) });
  const formation = getFormation(plan);
  assert.deepEqual(formation.map(slot => slot.slotIndex), [0, 1, 7]);
  assert.deepEqual([formation.at(-1).x, formation.at(-1).y], [416, 699]);
  const finished = ['placed', 'placed'].reduce(applyAction, plan);
  assert.equal(getFormation(finished).at(-1).type, 'obstacle');
  assert.deepEqual(restoreSession(serializeSession(finished)), finished);
});

test('invalid obstacle positions and coordinate overflow are rejected', () => {
  for (const invalid of [null, {}, '1', [1, 1], [-1], [1.5], [NaN], ['1'], [Number.MAX_SAFE_INTEGER + 1]]) {
    assert.throws(() => start(invalid));
  }
  assert.throws(() => start([Number.MAX_SAFE_INTEGER]));
  const original = start([1], { players: players.slice(0, 1), y0: Number.MAX_SAFE_INTEGER - 4 });
  assert.throws(() => applyAction(original, 'obstacle'));
  assert.equal(original.occupants.length, 0);
});

test('adding, moving, removing, and reordering do not mutate players or shift obstacle positions', () => {
  const draft = { ...DEFAULT_DRAFT, names: 'A\nB\nC\nD', importedPlayers: players };
  const added = changeDraftObstacle(draft, null, 1);
  const twice = changeDraftObstacle(added, null, 3);
  assert.equal(changeDraftObstacle(twice, null, 1), twice);
  assert.equal(changeDraftObstacle(twice, 3, 1), twice);
  const moved = changeDraftObstacle(twice, 3, 0);
  assert.deepEqual(moved.plannedObstacles, [0, 1]);
  const removed = changeDraftObstacle(moved, 1, null);
  assert.deepEqual(removed.plannedObstacles, [0]);
  const reordered = moveDraftPlayer(removed, 3, 0);
  assert.deepEqual(reordered.plannedObstacles, [0]);
  assert.deepEqual(playersFromDraft(reordered), [players[3], ...players.slice(0, 3)]);
  assert.deepEqual(playersFromDraft(draft), players);
  assert.equal(draft.plannedObstacles, undefined);
  assert.throws(() => changeDraftObstacle(draft, 0, null), /no planned obstacle/);
  assert.throws(() => changeDraftObstacle(draft, null, -1), /valid obstacle tile/);
});

test('draft markers and active plans survive local storage without duplicating skip actions', () => {
  let raw;
  const storage = { setItem: (_, value) => { raw = value; }, getItem: () => raw };
  const draft = { ...DEFAULT_DRAFT, names: 'A\nB\nC\nD', importedPlayers: players, plannedObstacles: [0, 2, 3] };
  const session = applyAction(start(draft.plannedObstacles), 'placed');
  saveWorkspace(storage, draft, session);
  const restored = loadWorkspace(storage);
  assert.deepEqual(restored, { draft, session });
  assert.equal(getProposal(restored.session).slotIndex, 4);
  assert.deepEqual(undoLastAction(restored.session), start(draft.plannedObstacles));
  saveWorkspace(storage, { ...draft, plannedObstacles: [-1] }, null);
  assert.throws(() => loadWorkspace(storage), /Obstacle position/);
});

test('older sessions without planned obstacles still restore normally', () => {
  const snapshot = serializeSession(applyAction(start([]), 'placed'));
  delete snapshot.plannedObstacles;
  const restored = restoreSession(snapshot);
  assert.deepEqual(restored.plannedObstacles, []);
  assert.equal(getProposal(restored).slotIndex, 1);
});
