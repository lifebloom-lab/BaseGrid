import test from 'node:test';
import assert from 'node:assert/strict';
import { moveDraftPlayer, playersFromDraft } from '../players.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace } from '../storage.js';
import { createSession, getFormation, getProposal } from '../placement.js';

const draft = () => ({ ...DEFAULT_DRAFT, names: 'Gaby\nMbac\nZoe\nLance' });
const names = data => playersFromDraft(data).map(player => player.name);

test('moving forward or backward shifts intervening players without losing or duplicating them', () => {
  const original = draft();
  const moved = moveDraftPlayer(original, 0, 3);
  assert.deepEqual(names(moved), ['Mbac', 'Zoe', 'Lance', 'Gaby']);
  assert.deepEqual(names(moveDraftPlayer(moved, 3, 1)), ['Mbac', 'Gaby', 'Zoe', 'Lance']);
  assert.equal(original.names, 'Gaby\nMbac\nZoe\nLance');
  assert.equal(original.orderedPlayers, undefined);
  assert.deepEqual(playersFromDraft(moveDraftPlayer(moved, 3, 0)), playersFromDraft(original));
});

test('dropping on the same position is a no-op and out-of-range moves are rejected', () => {
  const original = draft();
  assert.equal(moveDraftPlayer(original, 1, 1), original);
  for (const [from, to] of [[-1, 0], [0, 4], [4, 0], [0, 1.5], [NaN, 0]]) {
    assert.throws(() => moveDraftPlayer(original, from, to), /existing player/);
  }
  assert.throws(() => moveDraftPlayer({ names: '' }, 0, 0), /existing player/);
  assert.equal(moveDraftPlayer({ names: 'Solo' }, 0, 0).names, 'Solo');
});

test('duplicate names keep their distinct imported identities, levels, and groups after moving and reloading', () => {
  const importedPlayers = [
    { id: 'lastwar:1', name: 'Same', hqLevel: 35, group: 4, rank: 4, power: 900 },
    { id: 'lastwar:2', name: 'Other', hqLevel: 29, group: 3, rank: 3, power: 700 },
    { id: 'lastwar:3', name: 'Same', hqLevel: 31, group: 2, rank: 2, power: 800 },
  ];
  const moved = moveDraftPlayer({ ...DEFAULT_DRAFT, names: 'Same\nOther\nSame', importedPlayers }, 2, 0);
  assert.deepEqual(playersFromDraft(moved), [importedPlayers[2], importedPlayers[0], importedPlayers[1]]);
  let raw;
  const storage = { setItem: (_, value) => { raw = value; }, getItem: () => raw };
  saveWorkspace(storage, moved, null);
  const restored = loadWorkspace(storage).draft;
  assert.deepEqual(playersFromDraft(restored), playersFromDraft(moved));
  assert.deepEqual(importedPlayers.map(p => p.id), ['lastwar:1', 'lastwar:2', 'lastwar:3']);
  const plan = createSession({ players: playersFromDraft(restored), x0: 412, y0: 687, spacing: 1 });
  assert.equal(getProposal(plan).player.id, 'lastwar:3');
  assert.equal(getProposal(plan).player.hqLevel, 31);
  assert.equal(getProposal(plan).player.group, 2);
  assert.deepEqual(getFormation(plan).map(({ playerId, x, y }) => ({ playerId, x, y })), [
    { playerId: 'lastwar:3', x: 412, y: 687 },
    { playerId: 'lastwar:1', x: 416, y: 687 },
    { playerId: 'lastwar:2', x: 412, y: 691 },
  ]);
});

test('editing a manually reordered roster preserves matching IDs and allocates unique IDs for new names', () => {
  const moved = moveDraftPlayer(draft(), 0, 3);
  const edited = { ...moved, names: 'New player\nMbac\nZoe\nLance\nGaby' };
  const players = playersFromDraft(edited);
  assert.deepEqual(players.slice(1), moved.orderedPlayers);
  assert.equal(new Set(players.map(p => p.id)).size, 5);
  assert.equal(players[0].id, 'player-5');
  assert.doesNotThrow(() => createSession({ players, x0: 0, y0: 0, spacing: 0 }));
});

test('malformed saved orders are rejected instead of attaching metadata to the wrong player', () => {
  for (const orderedPlayers of [null, {}, [null], [{ id: '', name: 'Gaby' }],
    [{ id: 'same', name: 'Gaby' }, { id: 'same', name: 'Zoe' }]]) {
    const storage = { getItem: () => JSON.stringify({ version: 1, draft: { ...draft(), orderedPlayers }, session: null }) };
    assert.throws(() => loadWorkspace(storage), /player order/);
  }
});
