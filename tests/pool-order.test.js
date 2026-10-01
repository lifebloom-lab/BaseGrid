import test from 'node:test';
import assert from 'node:assert/strict';
import { sortPoolPlayers } from '../players.js';

test('pool sorts R5 through R1, highest HQ within rank, and names for ties without changing records or input order', () => {
  const players = [
    { id: 'a', name: 'Zed', group: 4, hqLevel: 30 },
    { id: 'b', name: 'Leader', group: 5, hqLevel: 29 },
    { id: 'c', name: 'High HQ', group: 1, hqLevel: 40 },
    { id: 'd', name: 'Alpha', group: 4, hqLevel: 30 },
    { id: 'e', name: 'Higher HQ', group: 4, hqLevel: 35 },
  ];
  const before = structuredClone(players);
  const sorted = sortPoolPlayers(players);
  assert.deepEqual(sorted.map(p => p.id), ['b', 'e', 'd', 'a', 'c']);
  assert.deepEqual(players, before);
  assert.equal(sorted[0], players[1]);
});

test('missing or invalid ranks and HQ levels sort last at each level; legacy rank values are supported', () => {
  const players = [
    { id: 'a', name: 'No details' },
    { id: 'b', name: 'Unknown rank', hqLevel: 50 },
    { id: 'c', name: 'No HQ', group: 3 },
    { id: 'd', name: 'Known', group: 3, hqLevel: 20 },
    { id: 'e', name: 'Legacy', rank: 5, hqLevel: 31 },
    { id: 'f', name: 'Invalid', group: 9, hqLevel: -1 },
    { id: 'g', name: 'Explicitly unknown', group: null, rank: 5, hqLevel: 32 },
  ];
  assert.deepEqual(sortPoolPlayers(players).map(p => p.id), ['e', 'd', 'c', 'b', 'g', 'f', 'a']);
});

test('manual players sort by name, keep duplicate identities, and an empty pool stays empty', () => {
  const players = ['Zulu', 'base 10', 'Base 2', 'Base 2'].map((name, index) => ({ id: String(index), name }));
  assert.deepEqual(sortPoolPlayers(players).map(p => p.id), ['2', '3', '1', '0']);
  assert.deepEqual(sortPoolPlayers([]), []);
});
