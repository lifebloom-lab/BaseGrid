import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLE_KEY, BATTLE_MAPS, emptyBattle, loadBattles, saveBattles, normalizeBattle, mergeBattlePlayers, restoreBattlePowers, sortBattlePlayers, assignBattlePlayer, reorderBattlePlayer, playerZone, layoutNames } from '../battle-model.js';

const roster = [
  { id: 'lastwar:1', name: 'Same', hqLevel: 35, group: 5, power: 123456789, apiKey: 'never-copy' },
  { id: 'lastwar:2', name: 'Same', hqLevel: 30, group: 3, power: 0 },
  { id: 'manual:1', name: '별빛' },
];
const fresh = () => mergeBattlePlayers(emptyBattle(), roster);

test('battle roster snapshots preserve duplicate identities, retain rank/HQ/power and exclude unrelated fields', () => {
  const initial = fresh();
  assert.equal(initial.players.length, 3);
  assert.equal(initial.players[0].group, 5);
  assert.equal(initial.players[0].hqLevel, 35);
  assert.equal(initial.players[0].power, 123456789);
  assert.equal(initial.players[1].power, 0);
  assert.equal(initial.players[2].power, null);
  assert.equal(initial.players[0].apiKey, undefined);
  const assigned = assignBattlePlayer(initial, 'canyon', 'lastwar:1', 'power');
  const merged = mergeBattlePlayers(assigned, [{ ...roster[0], hqLevel: 36 }]);
  assert.equal(merged.players.length, 3);
  assert.equal(merged.players[0].hqLevel, 36);
  assert.equal(playerZone(merged, 'lastwar:1'), 'power');
  assert.equal(roster[0].hqLevel, 35);
});

test('assignment moves only the chosen identity, never duplicates a player across zones, and unassign keeps metadata', () => {
  const first = assignBattlePlayer(fresh(), 'canyon', 'lastwar:1', 'power');
  const second = assignBattlePlayer(first, 'canyon', 'lastwar:2', 'power');
  const moved = assignBattlePlayer(second, 'canyon', 'lastwar:1', 'virus');
  assert.deepEqual(moved.assignments.power, ['lastwar:2']);
  assert.deepEqual(moved.assignments.virus, ['lastwar:1']);
  assert.deepEqual(first.assignments.power, ['lastwar:1']);
  assert.equal(assignBattlePlayer(moved, 'canyon', 'lastwar:1', 'virus'), moved);
  const unassigned = assignBattlePlayer(moved, 'canyon', 'lastwar:1', null);
  assert.equal(playerZone(unassigned, 'lastwar:1'), null);
  assert.deepEqual(unassigned.players, moved.players);
  assert.throws(() => assignBattlePlayer(first, 'desert', 'lastwar:1', 'power'));
  assert.throws(() => assignBattlePlayer(first, 'canyon', 'unknown', 'power'));
});

test('both battle drafts round-trip separately without touching BaseGrid workspace or roster caches', () => {
  const data = new Map([['basegrid.workspace.v1', 'formation unchanged'], ['basegrid.rosters.v1', 'cache unchanged']]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const state = loadBattles(storage);
  assert.equal(state.playerSort, 'rank');
  state.playerSort = 'power';
  state.drafts.canyon = assignBattlePlayer(fresh(), 'canyon', 'lastwar:1', 'power');
  state.drafts.desert = assignBattlePlayer(fresh(), 'desert', 'lastwar:2', 'hospital-1');
  state.selectedMap = 'desert';
  saveBattles(storage, state);
  const restored = loadBattles(storage);
  assert.equal(restored.selectedMap, 'desert');
  assert.equal(restored.playerSort, 'power');
  assert.equal(playerZone(restored.drafts.canyon, 'lastwar:1'), 'power');
  assert.equal(playerZone(restored.drafts.desert, 'lastwar:2'), 'hospital-1');
  assert.equal(restored.drafts.canyon.players[0].power, 123456789);
  restored.drafts.canyon.assignments = {};
  saveBattles(storage, restored);
  assert.equal(playerZone(loadBattles(storage).drafts.desert, 'lastwar:2'), 'hospital-1');
  assert.equal(data.get('basegrid.workspace.v1'), 'formation unchanged');
  assert.equal(data.get('basegrid.rosters.v1'), 'cache unchanged');
  assert.ok(data.has(BATTLE_KEY));
  const legacy = JSON.parse(data.get(BATTLE_KEY));
  delete legacy.playerSort;
  assert.equal(loadBattles({ getItem: () => JSON.stringify(legacy) }).playerSort, 'rank');
  legacy.playerSort = 'unknown';
  assert.equal(loadBattles({ getItem: () => JSON.stringify(legacy) }).playerSort, 'rank');
});

test('pool sorting handles power, natural alphabetical order and rank without changing teams or player records', () => {
  const players = [
    { id: '1', name: 'Zulu', power: 100, group: 1, hqLevel: 30 },
    { id: '2', name: 'Alpha 10', power: 100, group: 4, hqLevel: 30 },
    { id: '3', name: 'alpha 2', power: 200, group: 3, hqLevel: 35 },
    { id: '4', name: 'Élodie', power: null, group: 5, hqLevel: 20 },
    { id: '5', name: 'Boreal', power: 0, group: 4, hqLevel: 32 },
    { id: '6', name: 'Aurora' },
    { id: '7', name: 'alpha 2', power: 200, group: 3, hqLevel: 31 },
  ];
  const plan = assignBattlePlayer(mergeBattlePlayers(emptyBattle(), players), 'canyon', '1', 'power');
  const before = structuredClone(plan);
  const ids = order => sortBattlePlayers(plan.players, order).map(player => player.id);
  assert.deepEqual(ids('power'), ['3', '7', '2', '1', '5', '6', '4']);
  assert.deepEqual(ids('name'), ['3', '7', '2', '6', '5', '4', '1']);
  assert.deepEqual(ids('rank'), ['4', '5', '2', '3', '7', '1', '6']);
  assert.deepEqual(ids('unknown'), ids('rank'));
  assert.deepEqual(plan, before);
  assert.equal(sortBattlePlayers(plan.players, 'power')[0], plan.players[2]);
});

test('old battle drafts recover missing power by imported ID, without replacing known data or assignments', () => {
  const legacy = assignBattlePlayer(fresh(), 'canyon', 'lastwar:1', 'power');
  delete legacy.players[0].power;
  legacy.layout = 'teams';
  const normalized = normalizeBattle(legacy, 'canyon');
  assert.equal(normalized.layout, undefined);
  const restored = restoreBattlePowers(normalized, [
    { id: 'lastwar:1', name: 'Same', power: 123456789 },
    { id: 'lastwar:1', name: 'Same', power: 999 },
    { id: 'lastwar:2', name: 'Same', power: 500 },
    { id: 'manual:1', name: '별빛', power: 100 },
    { id: 'lastwar:other', name: 'Not in battle', power: 50 },
  ]);
  assert.equal(restored.players[0].power, 123456789);
  assert.equal(restored.players[1].power, 0);
  assert.equal(restored.players[2].power, null);
  assert.equal(restored.players.length, 3);
  assert.equal(playerZone(restored, 'lastwar:1'), 'power');
  assert.equal(normalized.players[0].power, null);
  assert.equal(restoreBattlePowers(restored, roster), restored);
  for (const power of [-1, '100', Infinity, NaN, 1.5]) {
    assert.equal(mergeBattlePlayers(emptyBattle(), [{ ...roster[0], power }]).players[0].power, null);
  }
});

test('invalid saved assignments are rejected instead of attaching names to the wrong players', () => {
  assert.throws(() => normalizeBattle({ ...fresh(), assignments: { power: ['missing'] } }, 'canyon'));
  assert.throws(() => normalizeBattle({ ...fresh(), assignments: { power: ['lastwar:1'], virus: ['lastwar:1'] } }, 'canyon'));
  assert.throws(() => normalizeBattle({ ...fresh(), players: [roster[0], roster[0]] }, 'canyon'));
  assert.throws(() => loadBattles({ getItem: () => '{bad json' }));
});

test('team ordering changes only the requested zone and remains immutable', () => {
  let plan = fresh();
  for (const player of roster) plan = assignBattlePlayer(plan, 'canyon', player.id, 'power');
  const reordered = reorderBattlePlayer(plan, 'power', 'lastwar:2', -1);
  assert.deepEqual(reordered.assignments.power, ['lastwar:2', 'lastwar:1', 'manual:1']);
  assert.deepEqual(plan.assignments.power, roster.map(player => player.id));
  assert.equal(reorderBattlePlayer(plan, 'power', 'lastwar:1', -1), plan);
});

test('name layout retains every complete name within the available bounds, or reports overflow', () => {
  const names = ['Aurora', 'Élodie', '별빛', 'Luna'];
  const measure = (text, size) => [...text].length * size * .6;
  const fitted = layoutNames(names, 520, 100, measure);
  assert.equal(fitted.overflow, false);
  assert.deepEqual(fitted.items.map(item => item.name), names);
  for (const item of fitted.items) {
    const half = measure(item.name, fitted.fontSize) / 2;
    assert.ok(item.x - half >= 0 && item.x + half <= 520);
    assert.ok(item.y > 0 && item.y < 100);
  }
  assert.equal(layoutNames(['Very long name '.repeat(20)], 500, 70, measure).overflow, true);
  assert.equal(layoutNames(Array.from({ length: 30 }, () => 'Player'), 500, 70, measure).overflow, true);
});

test('all image zones are unique, normalized, and inside their supplied template', () => {
  for (const map of Object.values(BATTLE_MAPS)) {
    assert.equal(new Set(map.zones.map(zone => zone.id)).size, map.zones.length);
    for (const { rect: [x, y, w, h] } of map.zones) assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1);
  }
});
