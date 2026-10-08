import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLE_KEY, LEGACY_BATTLE_KEY, BATTLE_MAPS, emptyBattle, emptyBattles, loadBattles, saveBattles, currentBattle, selectBattlePlan, updateBattlePlan, createBattlePlan, suggestedBattleTitle, normalizeBattle, mergeBattlePlayers, restoreBattlePowers, sortBattlePlayers, assignBattlePlayer, reorderBattlePlayer, playerZone, layoutNames, layoutBattleZones } from '../battle-model.js';

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

const memoryStorage = (entries = []) => {
  const data = new Map(entries);
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test('multiple named plans round-trip independently for each event and remember the selected plan', () => {
  const storage = memoryStorage([['basegrid.workspace.v1', 'formation unchanged'], ['basegrid.rosters.v1', 'cache unchanged']]);
  let state = loadBattles(storage);
  state.playerSort = 'power';
  state = updateBattlePlan(state, assignBattlePlayer(fresh(), 'canyon', 'lastwar:1', 'power'));
  const teamA = structuredClone(currentBattle(state));
  state = createBattlePlan(state, 'Team B', { id: 'canyon-b' });
  assert.deepEqual(currentBattle(state).players, teamA.players);
  assert.equal(playerZone(currentBattle(state), 'lastwar:1'), null);
  state = updateBattlePlan(state, assignBattlePlayer(currentBattle(state), 'canyon', 'lastwar:2', 'virus'));
  state = selectBattlePlan(state, 'desert');
  state = updateBattlePlan(state, assignBattlePlayer(fresh(), 'desert', 'lastwar:2', 'hospital-1'));
  state = createBattlePlan(state, 'Team B', { id: 'desert-b', duplicate: true });
  saveBattles(storage, state);
  let restored = loadBattles(storage);
  assert.equal(restored.selectedMap, 'desert');
  assert.equal(restored.playerSort, 'power');
  assert.equal(currentBattle(restored).id, 'desert-b');
  assert.equal(playerZone(currentBattle(restored), 'lastwar:2'), 'hospital-1');
  restored = selectBattlePlan(restored, 'canyon');
  assert.equal(currentBattle(restored).id, 'canyon-b');
  assert.equal(playerZone(currentBattle(restored), 'lastwar:2'), 'virus');
  assert.deepEqual(restored.plans.canyon[0], teamA);
  restored = updateBattlePlan(restored, { ...currentBattle(restored), assignments: {} });
  saveBattles(storage, restored);
  assert.deepEqual(loadBattles(storage).plans.canyon[0], teamA);
  assert.equal(playerZone(currentBattle(loadBattles(storage), 'desert'), 'lastwar:2'), 'hospital-1');
  assert.equal(storage.data.get('basegrid.workspace.v1'), 'formation unchanged');
  assert.equal(storage.data.get('basegrid.rosters.v1'), 'cache unchanged');
});

test('legacy single drafts migrate with titles, roster metadata, assignments and settings intact, retaining the original backup', () => {
  const legacy = { version: 1, selectedMap: 'desert', playerSort: 'name', drafts: {
    canyon: { ...assignBattlePlayer(fresh(), 'canyon', 'lastwar:1', 'power'), title: 'Weekly A' },
    desert: { ...assignBattlePlayer(fresh(), 'desert', 'lastwar:2', 'silo'), title: '' },
  } };
  const raw = JSON.stringify(legacy);
  const storage = memoryStorage([[LEGACY_BATTLE_KEY, raw]]);
  const state = loadBattles(storage);
  assert.equal(state.version, 2);
  assert.equal(state.selectedMap, 'desert');
  assert.equal(state.playerSort, 'name');
  assert.equal(currentBattle(state).title, 'Team A');
  assert.equal(currentBattle(state, 'canyon').title, 'Weekly A');
  assert.deepEqual(currentBattle(state, 'canyon').players, legacy.drafts.canyon.players);
  assert.equal(playerZone(currentBattle(state, 'canyon'), 'lastwar:1'), 'power');
  assert.equal(playerZone(currentBattle(state), 'lastwar:2'), 'silo');
  assert.equal(storage.getItem(BATTLE_KEY), null, 'loading alone does not write');
  saveBattles(storage, state);
  assert.deepEqual(loadBattles(storage), state);
  assert.equal(storage.getItem(LEGACY_BATTLE_KEY), raw);
  storage.setItem(LEGACY_BATTLE_KEY, 'old tab wrote something else');
  assert.deepEqual(loadBattles(storage), state, 'saved library takes precedence over old drafts');
});

test('new and duplicate plans never share mutable roster or assignment data with their source', () => {
  let state = updateBattlePlan(emptyBattles(), assignBattlePlayer(fresh(), 'canyon', 'lastwar:1', 'power'));
  const before = structuredClone(state);
  assert.equal(suggestedBattleTitle(state), 'Team B');
  const copy = createBattlePlan(state, 'Team A – next week', { duplicate: true, id: 'copy' });
  assert.deepEqual(currentBattle(copy).assignments, currentBattle(state).assignments);
  currentBattle(copy).players[0].name = 'Edited';
  currentBattle(copy).assignments.power.push('lastwar:2');
  assert.deepEqual(state, before);
  assert.deepEqual(copy.plans.canyon[0], currentBattle(state));
  const blank = createBattlePlan(state, 'Team B', { id: 'new' });
  currentBattle(blank).players[0].power = 9;
  assert.deepEqual(state, before);
  assert.ok(Object.values(currentBattle(blank).assignments).every(list => list.length === 0));
});

test('renaming keeps the plan identity and assignments, and duplicate titles cannot replace an existing plan', () => {
  let state = updateBattlePlan(emptyBattles(), assignBattlePlayer(fresh(), 'canyon', 'lastwar:1', 'power'));
  const id = currentBattle(state).id;
  state = createBattlePlan(state, 'Team B', { id: 'team-b' });
  const before = structuredClone(state);
  for (const title of ['Team A', '  team a  ', 'Ｔｅａｍ Ａ']) {
    assert.throws(() => createBattlePlan(state, title), /already exists/);
    assert.throws(() => updateBattlePlan(state, { ...currentBattle(state), title }), /already exists/);
  }
  for (const title of ['', '   ', 'x'.repeat(101)]) assert.throws(() => createBattlePlan(state, title));
  assert.deepEqual(state, before);
  state = selectBattlePlan(state, 'canyon', id);
  state = updateBattlePlan(state, { ...currentBattle(state), title: '  Team A · Week 2  ' });
  assert.equal(currentBattle(state).title, 'Team A · Week 2');
  assert.equal(currentBattle(state).id, id);
  assert.equal(playerZone(currentBattle(state), 'lastwar:1'), 'power');
  assert.equal(state.plans.canyon[1].title, 'Team B');
  assert.throws(() => selectBattlePlan(state, 'canyon', 'missing'));
  assert.throws(() => createBattlePlan(state, 'Other', { id }));
});

test('invalid libraries preserve existing data instead of silently falling back to old drafts', () => {
  const storage = memoryStorage([[LEGACY_BATTLE_KEY, JSON.stringify({ version: 1, drafts: {} })]]);
  for (const raw of ['{bad json', JSON.stringify({ version: 3 }), JSON.stringify({ ...emptyBattles(), plans: { canyon: [] } })]) {
    storage.setItem(BATTLE_KEY, raw);
    assert.throws(() => loadBattles(storage));
    assert.equal(storage.getItem(BATTLE_KEY), raw);
  }
  const state = emptyBattles();
  state.plans.canyon.push({ ...state.plans.canyon[0], id: 'another' });
  assert.throws(() => saveBattles(storage, state), /already exists/);
  state.plans.canyon[1].title = 'Team B';
  state.plans.canyon[1].id = state.plans.desert[0].id;
  assert.throws(() => saveBattles(storage, state), /identity/);
  const valid = emptyBattles();
  valid.playerSort = 'unknown';
  valid.selectedPlans.canyon = 'missing';
  storage.setItem(BATTLE_KEY, JSON.stringify(valid));
  const restored = loadBattles(storage);
  assert.equal(restored.playerSort, 'rank');
  assert.equal(currentBattle(restored).id, restored.plans.canyon[0].id);
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
    for (const line of item.lines) {
      const half = measure(line, fitted.fontSize) / 2;
      assert.ok(item.x - half >= 0 && item.x + half <= 520);
    }
    assert.ok(item.y - fitted.lineHeight / 2 >= 0);
    assert.ok(item.y + item.height - fitted.lineHeight / 2 <= fitted.height);
  }
  assert.equal(layoutNames(['Very long name '.repeat(20)], 500, 70, measure).overflow, true);
  assert.equal(layoutNames(Array.from({ length: 30 }, () => 'Player'), 500, 70, measure).overflow, true);
});

test('wrapping preserves complete long names and Unicode graphemes', () => {
  const segments = text => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
  const measure = (text, size) => segments(text).length * size * .6;
  const names = ['Alexandra of the Northern Alliance', '별빛수호자'.repeat(3), 'e\u0301👩‍🚀'.repeat(8)];
  for (const name of names) {
    const fitted = layoutNames([name], 180, 350, measure);
    assert.equal(fitted.overflow, false);
    assert.ok(fitted.items[0].lines.length > 1);
    assert.equal(fitted.items[0].lines.join('').replaceAll(' ', ''), name.replaceAll(' ', ''));
    assert.deepEqual(fitted.items[0].lines.flatMap(segments).filter(value => value !== ' '), segments(name).filter(value => value !== ' '));
    for (const line of fitted.items[0].lines) assert.ok(measure(line, fitted.fontSize) <= 180);
  }
});

test('warehouse preview keeps the reported player names whole instead of squeezing them into four columns', () => {
  const names = ['JOE FIXIT', 'LGIUGO', 'Cocodrilomingo', 'Matistr'];
  const players = names.map((name, id) => ({ id: String(id), name }));
  const plan = { ...emptyBattle(), players, assignments: { 'warehouse-1': players.map(player => player.id) } };
  const measure = (text, size) => [...text].length * size * .55;
  const card = layoutBattleZones(BATTLE_MAPS.canyon, plan, 2842, 2214, measure).find(zone => zone.id === 'warehouse-1');
  assert.equal(card.text.overflow, false);
  assert.equal(card.text.columns, 2);
  assert.deepEqual(card.text.items.map(item => item.lines), names.map(name => [name]));
  for (const item of card.text.items) assert.ok(measure(item.name, card.text.fontSize) <= item.width);
  const smaller = layoutNames(names, 520, 100, measure, { maxColumns: 4 });
  assert.equal(smaller.overflow, false);
  assert.ok(smaller.fontSize < 38 && smaller.fontSize >= 24);
  assert.deepEqual(smaller.items.map(item => item.lines), names.map(name => [name]));
});

test('when a complete name cannot fit, wrapping uses spaces before breaking words', () => {
  const name = 'The Northern Alliance Commander';
  const fitted = layoutNames([name], 260, 200, (text, size) => text.length * size * .55);
  assert.equal(fitted.overflow, false);
  assert.ok(fitted.items[0].lines.length > 1);
  assert.equal(fitted.items[0].lines.join(' '), name);
});

test('Desert cards grow and shrink with teams, preserve assignment order, and stop before other cards', () => {
  const map = BATTLE_MAPS.desert;
  const measure = (text, size) => [...text].length * size * .55;
  const players = Array.from({ length: 8 }, (_, index) => ({ id: String(index), name: 'Player ' + (index + 1) }));
  const plan = { ...emptyBattle(), players };
  const original = layoutBattleZones(map, plan, 2496, 2524, measure);
  for (const zone of map.zones) {
    const assigned = { ...plan, assignments: { [zone.id]: players.map(player => player.id) } };
    const card = layoutBattleZones(map, assigned, 2496, 2524, measure).find(item => item.id === zone.id);
    const empty = original.find(item => item.id === zone.id);
    assert.equal(card.text.overflow, false, zone.name);
    assert.equal(card.text.columns, 2);
    assert.deepEqual(card.text.items.map(item => item.name), players.map(player => player.name));
    assert.ok(card.h > empty.h);
    assert.equal(card.y, empty.y);
    assert.ok(card.y + card.h <= zone.card.bottom * 2524 + .0001);
    const removed = assignBattlePlayer(assigned, 'desert', '0', null);
    const smaller = layoutBattleZones(map, removed, 2496, 2524, measure).find(item => item.id === zone.id);
    assert.ok(smaller.h <= card.h);
    for (const other of map.zones.filter(item => item.id !== zone.id)) {
      const [x, y, w] = zone.rect, [ox, oy, ow] = other.rect;
      assert.ok(x + w <= ox || ox + ow <= x || zone.card.bottom <= oy || other.card.bottom <= y, zone.id + '/' + other.id);
    }
  }
  assert.deepEqual(plan.assignments, {});
});

test('wide Canyon panels retain room for a larger team without spilling outside the panel', () => {
  const players = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: 'Player ' + (index + 1) }));
  const plan = { ...emptyBattle(), players, assignments: { 'data-1': players.map(player => player.id) } };
  const [card] = layoutBattleZones(BATTLE_MAPS.canyon, plan, 2842, 2214, (text, size) => text.length * size * .55);
  assert.equal(card.text.overflow, false);
  assert.equal(card.text.items.length, players.length);
  assert.ok(Math.abs(card.h - card.rect[3] * 2214) < .0001);
  for (const item of card.text.items) {
    for (const line of item.lines) assert.ok(line.length * card.text.fontSize * .55 <= item.width);
    assert.ok(item.y + item.height - card.text.lineHeight / 2 <= card.text.height);
  }
});

test('all image zones are unique, normalized, and inside their supplied template', () => {
  for (const map of Object.values(BATTLE_MAPS)) {
    assert.equal(new Set(map.zones.map(zone => zone.id)).size, map.zones.length);
    for (const { rect: [x, y, w, h] } of map.zones) assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1);
  }
});
