import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession, applyAction, undoLastAction, getProposal, getFormation,
  slotToCoordinate, serializeSession, restoreSession,
} from '../placement.js';
import { parseManualPlayers } from '../players.js';

const players = names => names.map(name => ({ name }));
const start = (names = ['A', 'B', 'C', 'D'], options = {}) => createSession({
  players: players(names), x0: 412, y0: 687, spacing: 1, ...options,
});
const run = (session, actions) => actions.reduce(applyAction, session);
const coordinates = session => session.occupants.map(({ x, y }) => [x, y]);

test('ordinary row-major placement has aligned rows and columns', () => {
  const state = run(start(), Array(4).fill('placed'));
  assert.deepEqual(coordinates(state), [[412, 687], [416, 687], [412, 691], [416, 691]]);
  assert.deepEqual(state.occupants.map(item => item.name), ['A', 'B', 'C', 'D']);
  assert.equal(state.playerIndex, 4);
  assert.equal(state.slotIndex, 4);
  assert.equal(getProposal(state), null);
  assert.throws(() => applyAction(state, 'placed'), /already placed/);
  assert.throws(() => applyAction(state, 'obstacle'), /already placed/);
});

test('one obstacle consumes a slot and keeps the current player', () => {
  const state = run(start(), ['placed', 'obstacle']);
  assert.equal(state.playerIndex, 1);
  assert.equal(state.slotIndex, 2);
  assert.deepEqual(state.occupants[1], { type: 'obstacle', slotIndex: 1, x: 416, y: 687 });
  assert.equal(getProposal(state).player.name, 'B');
  assert.deepEqual([getProposal(state).x, getProposal(state).y], [412, 691]);
  const finished = run(state, ['placed', 'placed', 'placed']);
  assert.deepEqual(finished.occupants.map(item => item.name ?? 'OBSTACLE'), ['A', 'OBSTACLE', 'B', 'C', 'D']);
});

test('consecutive obstacles keep the same player through multiple rows', () => {
  const state = run(start(), ['placed', 'obstacle', 'obstacle', 'obstacle']);
  assert.equal(state.playerIndex, 1);
  assert.equal(state.slotIndex, 4);
  assert.equal(getProposal(state).player.name, 'B');
  assert.deepEqual([getProposal(state).x, getProposal(state).y], [412, 695]);
  assert.equal(state.occupants.filter(item => item.type === 'obstacle').length, 3);
});

test('obstacles add rows without changing the initial number of columns', () => {
  const state = run(start(), ['obstacle', ...Array(4).fill('placed')]);
  assert.equal(state.columns, 2);
  assert.equal(Math.ceil(state.slotIndex / state.columns), 3);
  assert.deepEqual(coordinates(state).at(-1), [412, 695]);
  assert.equal(getFormation(state).length, 5);
});

for (const spacing of [0, 1, 2, 5, 20]) {
  test(`spacing p=${spacing} yields a step of ${3 + spacing} on both axes`, () => {
    const state = run(start(['A', 'B', 'C'], { x0: -12, y0: 0, spacing }), Array(3).fill('placed'));
    assert.deepEqual(coordinates(state), [[-12, 0], [-12 + 3 + spacing, 0], [-12, 3 + spacing]]);
  });
}

test('undoing placement restores both indices, proposal, and occupied slots', () => {
  const before = run(start(), ['obstacle', 'placed']);
  const after = applyAction(before, 'placed');
  assert.deepEqual(undoLastAction(after), before);
  assert.equal(getProposal(undoLastAction(after)).player.name, 'B');
});

test('undoing an obstacle restores the slot without changing player', () => {
  const before = applyAction(start(), 'placed');
  assert.deepEqual(undoLastAction(applyAction(before, 'obstacle')), before);
});

test('undo works after completion and repeatedly back to the initial session', () => {
  const initial = start(['Solo']);
  let state = run(initial, ['obstacle', 'obstacle', 'placed']);
  state = undoLastAction(state);
  assert.equal(getProposal(state).player.name, 'Solo');
  assert.equal(getProposal(state).y, 695);
  state = undoLastAction(undoLastAction(state));
  assert.deepEqual(state, initial);
  assert.equal(undoLastAction(state), state);
});

test('zero players and invalid player records are rejected', () => {
  for (const bad of [[], null, 'A', [{}], [{ name: '' }], [{ name: '  ' }], [null], ['A']]) {
    assert.throws(() => start([], { players: bad }));
  }
  assert.throws(() => start([], { players: [{ name: 'A', id: 'same' }, { name: 'B', id: 'same' }] }), /unique/);
});

test('fractional, missing, non-finite, and unsafe input is rejected', () => {
  for (const field of ['x0', 'y0', 'spacing']) {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => start(['A'], { [field]: bad }), `${field}=${bad}`);
    }
  }
  assert.throws(() => start(['A'], { spacing: -1 }));
  assert.throws(() => start(['A'], { spacing: Number.MAX_SAFE_INTEGER }));
  assert.throws(() => applyAction(start(), 'invalid'), /Unknown/);
});

test('coordinate overflow is rejected without corrupting the previous session', () => {
  assert.throws(() => start(['A', 'B'], { x0: Number.MAX_SAFE_INTEGER }));
  const state = start(['A'], { y0: Number.MAX_SAFE_INTEGER });
  assert.throws(() => applyAction(state, 'obstacle'));
  assert.equal(state.occupants.length, 0);
  assert.equal(getProposal(state).y, Number.MAX_SAFE_INTEGER);
});

test('one player uses the origin, with obstacles continuing down one fixed column', () => {
  const state = start(['Solo']);
  assert.equal(state.columns, 1);
  assert.deepEqual(slotToCoordinate(state, 0), { x: 412, y: 687 });
  assert.deepEqual(slotToCoordinate(state, 2), { x: 412, y: 695 });
  assert.equal(getProposal(applyAction(state, 'placed')), null);
});

for (const [count, expectedColumns] of [[1, 1], [2, 2], [3, 2], [4, 2], [5, 3], [8, 3], [9, 3], [10, 4], [100, 10]]) {
  test(`${count} players use ${expectedColumns} fixed columns`, () => {
    const state = start(Array.from({ length: count }, (_, i) => `Player ${i}`));
    assert.equal(state.columns, expectedColumns);
    const obstructed = run(state, Array(10).fill('obstacle'));
    assert.equal(obstructed.columns, expectedColumns);
  });
}

test('formation projections distinguish placed, blocked, current, and pending', () => {
  const state = run(start(), ['placed', 'obstacle']);
  const formation = getFormation(state);
  assert.deepEqual(formation.map(slot => slot.status), ['placed', 'blocked', 'current', 'pending', 'pending']);
  assert.deepEqual(formation.map(slot => slot.name ?? 'OBSTACLE'), ['A', 'OBSTACLE', 'B', 'C', 'D']);
  assert.equal(state.occupants.length, 2, 'projections must not become occupants');
});

test('transitions and rendering never mutate their input', () => {
  const initial = start();
  Object.freeze(initial.players);
  Object.freeze(initial.occupants);
  Object.freeze(initial.origin);
  Object.freeze(initial);
  const placed = applyAction(initial, 'placed');
  getFormation(initial);
  assert.equal(initial.playerIndex, 0);
  assert.equal(initial.occupants.length, 0);
  assert.notEqual(placed.occupants, initial.occupants);
  assert.deepEqual(undoLastAction(placed), initial);
});

test('manual input preserves ordering, trims whitespace, ignores blank lines, and supports duplicate names', () => {
  const records = parseManualPlayers('  Gaby  \r\n\r\nMbac\n Gaby\n');
  assert.deepEqual(records.map(record => record.name), ['Gaby', 'Mbac', 'Gaby']);
  assert.equal(new Set(records.map(record => record.id)).size, 3);
  assert.equal(createSession({ players: records, x0: 0, y0: 0, spacing: 0 }).players.length, 3);
  assert.deepEqual(parseManualPlayers(' \n\r\n'), []);
});

test('player metadata is preserved without sorting or implementing ranks', () => {
  const source = [{ id: 'game-id', name: ' Gaby ', rank: 'R4', power: 123 }];
  const state = start([], { players: source });
  assert.equal(state.players[0].rank, 'R4');
  assert.equal(state.players[0].name, 'Gaby');
  assert.equal(source[0].name, ' Gaby ');
  assert.equal(applyAction(state, 'placed').occupants[0].playerId, 'game-id');
});

test('serialization restores the exact session and allows undo after a refresh', () => {
  const state = run(start(), ['placed', 'obstacle', 'obstacle', 'placed']);
  const restored = restoreSession(JSON.parse(JSON.stringify(serializeSession(state))));
  assert.deepEqual(restored, state);
  assert.deepEqual(undoLastAction(restored), undoLastAction(state));
  const finished = run(state, ['placed', 'placed']);
  assert.deepEqual(restoreSession(serializeSession(finished)), finished);
});

test('unsupported and inconsistent saved sessions are rejected', () => {
  const snapshot = serializeSession(start(['A']));
  for (const invalid of [null, {}, { ...snapshot, version: 2 }, { ...snapshot, actions: null },
    { ...snapshot, actions: ['bogus'] }, { ...snapshot, actions: ['placed', 'placed'] }]) {
    assert.throws(() => restoreSession(invalid));
  }
});

test('a mixed action sequence is deterministic and reverses cleanly', () => {
  const initial = start(Array.from({ length: 20 }, (_, i) => `P${i}`));
  const actions = Array.from({ length: 20 }, (_, i) => i % 3 === 0 ? ['obstacle', 'obstacle', 'placed'] : ['placed']).flat();
  let state = run(initial, actions);
  assert.deepEqual(run(initial, actions), state);
  assert.equal(new Set(state.occupants.map(({ x, y }) => `${x},${y}`)).size, actions.length);
  assert.equal(state.columns, 5);
  for (let i = 0; i < actions.length; i++) state = undoLastAction(state);
  assert.deepEqual(state, initial);
});
