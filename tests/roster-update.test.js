import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshPlayerStats, rosterUpdateSources, readRosterLibrary, prepareRosterUpdate, commitRosterUpdate } from '../roster-update.js';
import { BATTLE_KEY, ALLIES, emptyBattles, emptyBattle, currentBattle, updateBattlePlan, createBattlePlan, selectBattlePlan, assignBattlePlayer, mergeBattlePlayers, saveBattles, loadBattles } from '../battle-model.js';
import { ROSTER_CACHE_KEY } from '../roster-cache.js';
import { STORAGE_KEY, DEFAULT_DRAFT, saveWorkspace, loadWorkspace } from '../storage.js';
import { DATA_IMPORT_KEY, exportDataBackup, parseDataBackup } from '../data-transfer.js';
import { autoPlaceBases, openTilePlacement, confirmTilePlacement, moveTile } from '../tile-placement.js';
import { fetchMembers } from '../lastwar-api.js';

const alliance = 'a'.repeat(32);
const players = [
  { id: 'lastwar:1', name: 'Aurora', power: 100, hqLevel: 35, group: 4, rank: 4 },
  { id: 'lastwar:2', name: 'Boreal', power: 80, hqLevel: 30, group: 3, rank: 3 },
  { id: 'lastwar:3', name: 'Departed', power: 90, hqLevel: 25, group: 2 },
];
const fresh = [
  { id: 'lastwar:1', name: 'Renamed Aurora', power: 250, hqLevel: 36, rank: 5, x: 999, y: 999, apiKey: 'never-save' },
  { id: 'lastwar:2', name: 'Boreal', power: 0, hqLevel: null, group: null },
  { id: 'lastwar:new', name: 'Newcomer', power: 300, hqLevel: 35, rank: 4 },
];
const entry = data => ({ kind: 'roster', id: alliance, label: 'ALLY', savedAt: 1000, data,
  context: { serverId: 1770, allianceId: alliance, allianceName: 'Alliance', allianceTag: 'ALLY' } });
const memory = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
function savedPlans() {
  const storage = memory();
  let draft = { ...DEFAULT_DRAFT, names: players.map(p => p.name).join('\n'), importedPlayers: players, orderedPlayers: players, rosterContext: entry(players).context };
  draft = autoPlaceBases(draft);
  draft = moveTile(draft, 'new-obstacle', null, { column: 20, row: 0 }, 3);
  draft = confirmTilePlacement(openTilePlacement(draft, players[0].id), players[0].id);
  saveWorkspace(storage, draft, null);
  let plan = mergeBattlePlayers(emptyBattle(), [...players, { id: 'manual:1', name: 'Aurora', power: 12 }]);
  plan = assignBattlePlayer(plan, 'canyon', players[0].id, 'power');
  plan = assignBattlePlayer(plan, 'canyon', players[0].id, 'virus');
  plan = assignBattlePlayer(plan, 'canyon', ALLIES.id, 'power');
  let state = updateBattlePlan(emptyBattles(), plan);
  state = createBattlePlan(state, 'Team B', { duplicate: true });
  state = selectBattlePlan(state, 'desert');
  state = updateBattlePlan(state, assignBattlePlayer(mergeBattlePlayers(currentBattle(state), players), 'desert', players[1].id, 'silo'));
  saveBattles(storage, state);
  storage.setItem(ROSTER_CACHE_KEY, JSON.stringify({ version: 1, entries: [entry(players)] }));
  storage.setItem('unrelated', 'keep');
  return storage;
}

test('stats updates use imported IDs, accept zero/decreases, retain missing stats and never rename or add players', () => {
  const original = [...players, { id: 'manual:1', name: 'Aurora', power: 12 }];
  const updated = refreshPlayerStats(original, fresh);
  assert.equal(updated[0].name, 'Aurora');
  assert.equal(updated[0].power, 250);
  assert.equal(updated[0].hqLevel, 36);
  assert.equal(updated[0].group, 5);
  assert.equal(updated[0].rank, 5);
  assert.equal(updated[1].power, 0);
  assert.equal(updated[1].hqLevel, 30);
  assert.equal(updated[1].group, 3);
  assert.equal(updated[2], original[2]);
  assert.equal(updated[3], original[3]);
  assert.deepEqual(updated.map(p => p.id), original.map(p => p.id));
  assert.equal(players[0].power, 100);
  assert.equal(refreshPlayerStats(updated, fresh), updated);
  assert.equal(refreshPlayerStats(original, [{ id: 'lastwar:1', power: -1, hqLevel: -2, group: 6 }]), original);
});

test('refresh updates every saved team and formation while preserving obstacles, confirmations, duplicated assignments and names', () => {
  const storage = savedPlans();
  const before = new Map(storage.values);
  const prepared = prepareRosterUpdate(storage, { ...entry(fresh), savedAt: 2000 });
  assert.deepEqual(new Map(storage.values), before, 'preparation never writes');
  assert.deepEqual(prepared.summary, { updated: 2, matched: 2, plansUpdated: 3 });
  commitRosterUpdate(storage, prepared);
  const original = loadBattles({ getItem: key => before.get(key) ?? null });
  const updated = loadBattles(storage);
  assert.deepEqual(updated.selectedPlans, original.selectedPlans);
  assert.equal(updated.selectedMap, original.selectedMap);
  for (const mapId of ['canyon', 'desert']) updated.plans[mapId].forEach((plan, index) => {
    const old = original.plans[mapId][index];
    assert.deepEqual(plan.assignments, old.assignments);
    assert.equal(plan.id, old.id);
    assert.equal(plan.title, old.title);
    assert.deepEqual(plan.players.map(p => [p.id, p.name]), old.players.map(p => [p.id, p.name]));
    assert.equal(plan.players[0].power, 250);
    assert.equal(plan.players[1].power, 0);
    assert.equal(plan.players[2].power, 90);
  });
  const oldDraft = JSON.parse(before.get(STORAGE_KEY)).draft;
  const newDraft = loadWorkspace(storage).draft;
  for (const key of ['names', 'layout', 'tilePlacements', 'rosterContext', 'x', 'y', 'spacing']) assert.deepEqual(newDraft[key], oldDraft[key], key);
  for (const field of ['importedPlayers', 'orderedPlayers']) assert.equal(newDraft[field][0].power, 250);
  const cached = readRosterLibrary(storage).entries[0];
  assert.equal(cached.savedAt, 2000);
  assert.equal(cached.statsUpdatedAt, 2000);
  assert.equal(cached.data[0].name, 'Renamed Aurora', 'the fetched cache retains the provider name');
  assert.equal(storage.getItem('unrelated'), 'keep');
  assert.equal([...storage.values.values()].join('').includes('never-save'), false);
  assert.ok(storage.getItem(DATA_IMPORT_KEY), 'other planners receive the existing reload signal');
  assert.equal(parseDataBackup(JSON.stringify(exportDataBackup(storage))).rosters.entries[0].statsUpdatedAt, 2000);
});

test('repeating a refresh records freshness without rewriting plans or adding duplicate members', () => {
  const storage = savedPlans();
  commitRosterUpdate(storage, prepareRosterUpdate(storage, entry(fresh)));
  const previous = storage.getItem(BATTLE_KEY);
  const next = prepareRosterUpdate(storage, { ...entry(fresh), savedAt: 3000 });
  assert.equal(next.summary.updated, 0);
  assert.equal(next.summary.plansUpdated, 0);
  assert.equal(next.changes.has(BATTLE_KEY), false);
  commitRosterUpdate(storage, next);
  assert.equal(storage.getItem(BATTLE_KEY), previous);
  assert.equal(readRosterLibrary(storage).entries[0].statsUpdatedAt, 3000);
});

test('an alliance is suggested only through player IDs, with ambiguous matches left as separate choices', () => {
  const sameNames = entry([{ ...players[0], id: 'lastwar:someone-else' }]);
  const other = { ...entry(players), id: 'b'.repeat(32) };
  assert.deepEqual(rosterUpdateSources(players, [sameNames], null), []);
  assert.equal(rosterUpdateSources(players, [entry(players), other], null).length, 2);
  const fallback = rosterUpdateSources(players, [], { importedPlayers: players, rosterContext: entry(players).context });
  assert.equal(fallback[0].id, alliance);
  assert.equal(fallback[0].matches, 3);
  assert.equal(rosterUpdateSources(players, [sameNames], { importedPlayers: players, rosterContext: entry(players).context })[0].matches, 3,
    'the saved alliance link survives a refreshed cache with no overlapping members');
  assert.deepEqual(rosterUpdateSources([{ id: 'manual:1', name: 'Aurora' }], [entry(players)], null), []);
});

test('incomplete/invalid responses and corrupt saved data cannot overwrite existing data', () => {
  const storage = savedPlans();
  const original = new Map(storage.values);
  for (const data of [[], [fresh[0], fresh[0]], [{ id: 'bad', name: 'Bad' }]]) {
    assert.throws(() => prepareRosterUpdate(storage, entry(data)));
    assert.deepEqual(storage.values, original);
  }
  storage.setItem(STORAGE_KEY, 'corrupt');
  const corrupt = new Map(storage.values);
  assert.throws(() => prepareRosterUpdate(storage, entry(fresh)));
  assert.deepEqual(storage.values, corrupt);
});

test('concurrent changes are rejected, and a failed save rolls back all keys before retrying the same fetched data', () => {
  const storage = savedPlans();
  const stale = prepareRosterUpdate(storage, entry(fresh));
  storage.setItem(BATTLE_KEY, storage.getItem(BATTLE_KEY) + ' ');
  assert.throws(() => commitRosterUpdate(storage, stale), /changed/);
  const before = new Map(storage.values);
  const prepared = prepareRosterUpdate(storage, entry(fresh));
  let fail = true;
  const failing = { ...storage, setItem(key, value) {
    if (fail && key === DATA_IMPORT_KEY) { fail = false; throw new Error('Quota'); }
    storage.setItem(key, value);
  } };
  assert.throws(() => commitRosterUpdate(failing, prepared), /previous data is unchanged/);
  assert.deepEqual(storage.values, before);
  commitRosterUpdate(storage, prepareRosterUpdate(storage, entry(fresh)));
  assert.equal(loadBattles(storage).plans.canyon[0].players[0].power, 250);
});

test('one explicit provider request replaces cached values; rejected or cancelled requests keep all saved data', async () => {
  const storage = savedPlans();
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, '/api/lastwar/alliance/' + alliance + '/members');
    assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify({ alliance_id: alliance, member_count: 1,
      members: [{ uid: '1', name: 'Aurora', power: 999, hq_level: 36, rank: 5 }] }), { headers: { 'X-BaseGrid-Relay': '1' } });
  };
  const data = await fetchMembers(alliance, { apiKey: 'test-only-key', fetchImpl });
  commitRosterUpdate(storage, prepareRosterUpdate(storage, entry(data)));
  assert.equal(calls, 1);
  assert.equal(loadBattles(storage).plans.canyon[0].players[0].power, 999);
  const before = new Map(storage.values);
  await assert.rejects(fetchMembers(alliance, { apiKey: 'test-only-key', fetchImpl: async () => new Response('{}', { status: 401, headers: { 'X-BaseGrid-Relay': '1' } }) }), /key was not accepted/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(fetchMembers(alliance, { apiKey: 'test-only-key', signal: abort.signal,
    fetchImpl: async (url, { signal }) => { signal.throwIfAborted(); } }), { name: 'AbortError' });
  assert.deepEqual(storage.values, before);
});
