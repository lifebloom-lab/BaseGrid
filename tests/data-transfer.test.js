import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_IMPORT_KEY, MAX_BACKUP_BYTES, exportDataBackup, parseDataBackup, prepareDataImport, commitDataImport } from '../data-transfer.js';
import { STORAGE_KEY, DEFAULT_DRAFT, saveWorkspace, loadWorkspace } from '../storage.js';
import { BATTLE_KEY, LEGACY_BATTLE_KEY, ALLIES, emptyBattles, emptyBattle, currentBattle, updateBattlePlan, createBattlePlan, assignBattlePlayer, mergeBattlePlayers, saveBattles, loadBattles, playerZones } from '../battle-model.js';
import { ROSTER_CACHE_KEY, createRosterCache } from '../roster-cache.js';
import { MESSAGE_LANGUAGE_KEY } from '../placement-messages.js';
import { createSession, applyAction } from '../placement.js';
import { autoPlaceBases, openTilePlacement, confirmTilePlacement, moveTile, getTilePlan } from '../tile-placement.js';

const player = { id: 'lastwar:1', name: 'Aurora', hqLevel: 35, group: 5, rank: 5, power: 123456789, serverId: 1770 };
const alliance = 'a'.repeat(32);
const memory = () => {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};
function source() {
  const storage = memory();
  let draft = { ...DEFAULT_DRAFT, names: 'Aurora', importedPlayers: [player], orderedPlayers: [player], setupMethod: 'import',
    rosterContext: { serverId: 1770, allianceId: alliance, allianceName: 'Alliance', allianceTag: 'ALLY' } };
  draft = autoPlaceBases(draft);
  draft = moveTile(draft, 'new-obstacle', null, { column: 7, row: 0 }, 3);
  draft = confirmTilePlacement(openTilePlacement(draft, player.id), player.id);
  saveWorkspace(storage, draft, null);
  let plan = mergeBattlePlayers(emptyBattle(), [player]);
  plan = assignBattlePlayer(plan, 'canyon', player.id, 'power');
  plan = assignBattlePlayer(plan, 'canyon', player.id, 'virus');
  plan = assignBattlePlayer(plan, 'canyon', ALLIES.id, 'data-1');
  let battles = updateBattlePlan(emptyBattles(), plan);
  battles = createBattlePlan(battles, 'Team B', { duplicate: true, id: 'source-b' });
  saveBattles(storage, battles);
  storage.setItem(ROSTER_CACHE_KEY, JSON.stringify({ version: 1, entries: [
    { kind: 'roster', id: alliance, savedAt: 1000, label: 'ALLY', context: draft.rosterContext, data: [player] },
    { kind: 'alliances', id: '1770', savedAt: 1000, label: '#1770', data: [{ id: alliance, name: 'Alliance', tag: 'ALLY', memberCount: 1 }] },
  ] }));
  storage.setItem(MESSAGE_LANGUAGE_KEY, 'fr');
  storage.setItem('basegrid.map-zoom.v1', '.5');
  return storage;
}

test('a portable file restores formation, obstacles, confirmations, metadata, cached lookups and independent battle copies', async () => {
  const original = source();
  const backup = parseDataBackup(JSON.stringify(exportDataBackup(original)));
  const target = memory();
  const preview = prepareDataImport(target, backup, { includeFormation: true });
  assert.equal(target.data.size, 0, 'preview performs no writes');
  assert.equal(preview.summary.plans.length, 3);
  assert.equal(preview.summary.rostersAdded, 1);
  assert.equal(preview.summary.searchesAdded, 1);
  commitDataImport(target, preview);
  assert.deepEqual(loadWorkspace(target), loadWorkspace(original));
  assert.deepEqual(getTilePlan(loadWorkspace(target).draft), getTilePlan(loadWorkspace(original).draft));
  const restored = loadBattles(target);
  assert.equal(restored.plans.canyon.length, 2, 'unused starter plans do not create unnecessary duplicates');
  assert.equal(currentBattle(restored).title, 'Team B');
  assert.notEqual(currentBattle(restored).id, 'source-b');
  for (const plan of restored.plans.canyon) {
    assert.deepEqual(playerZones(plan, player.id), ['power', 'virus']);
    assert.deepEqual(playerZones(plan, ALLIES.id), ['data-1']);
    assert.equal(plan.players[0].power, player.power);
  }
  let calls = 0;
  const cache = createRosterCache({ getStorage: () => target, getMembers: async () => { calls++; throw new Error('API used'); }, getAlliances: async () => { calls++; throw new Error('API used'); } });
  assert.equal((await cache.loadRoster(alliance)).source, 'saved');
  assert.equal((await cache.loadAlliances('1770')).source, 'saved');
  assert.equal(calls, 0);
  assert.equal(target.getItem(MESSAGE_LANGUAGE_KEY), 'fr');
  assert.equal(target.getItem('basegrid.map-zoom.v1'), '0.5');
});

test('import keeps recipient plans, roster snapshots, preferences and formation; title collisions get unique names', () => {
  const original = source();
  const backup = exportDataBackup(original);
  const target = source();
  target.setItem(MESSAGE_LANGUAGE_KEY, 'ko');
  target.setItem('unrelated-app', 'keep');
  const before = new Map(target.data);
  const originalPlans = structuredClone(loadBattles(target).plans);
  const preview = prepareDataImport(target, backup);
  assert.deepEqual(preview.summary.plans.map(plan => plan.title), ['Team A (imported)', 'Team B (imported)', 'Team A']);
  assert.equal(preview.summary.rostersAdded, 0);
  assert.equal(preview.summary.rostersKept, 1);
  assert.equal(preview.summary.formationIncluded, false);
  commitDataImport(target, preview);
  const restored = loadBattles(target);
  assert.deepEqual(restored.plans.canyon.slice(0, 2), originalPlans.canyon);
  assert.equal(target.getItem(STORAGE_KEY), before.get(STORAGE_KEY));
  assert.equal(target.getItem(ROSTER_CACHE_KEY), before.get(ROSTER_CACHE_KEY));
  assert.equal(target.getItem(MESSAGE_LANGUAGE_KEY), 'ko');
  assert.equal(target.getItem('unrelated-app'), 'keep');
  const next = prepareDataImport(target, backup);
  assert.equal(next.summary.plans[0].title, 'Team A (imported 2)');
  assert.equal(next.summary.plans[1].title, 'Team B (imported 2)');
});

test('formation replacement requires opting in and unfinished drafts remain transferable', () => {
  const from = memory();
  saveWorkspace(from, { ...DEFAULT_DRAFT, names: 'Partly entered', x: '', spacing: '-1' }, null);
  const target = source();
  const previous = target.getItem(STORAGE_KEY);
  const backup = exportDataBackup(from);
  commitDataImport(target, prepareDataImport(target, backup));
  assert.equal(target.getItem(STORAGE_KEY), previous);
  const preview = prepareDataImport(target, backup, { includeFormation: true });
  assert.equal(preview.summary.hasExistingFormation, true);
  commitDataImport(target, preview);
  assert.deepEqual(loadWorkspace(target), loadWorkspace(from));
});

test('export and import whitelist data and exclude API keys, unknown fields and unrelated storage', () => {
  const storage = source();
  const workspace = JSON.parse(storage.getItem(STORAGE_KEY));
  workspace.draft.apiKey = 'draft-secret';
  workspace.draft.importedPlayers[0].token = 'player-secret';
  workspace.draft.orderedPlayers[0].power = { apiKey: 'nested-secret' };
  workspace.draft.layout.apiKey = 'layout-secret';
  storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  const battles = JSON.parse(storage.getItem(BATTLE_KEY));
  battles.apiKey = 'library-secret';
  battles.plans.canyon[0].players[0].key = 'battle-secret';
  storage.setItem(BATTLE_KEY, JSON.stringify(battles));
  storage.setItem('provider-api-key', 'unrelated-secret');
  const backup = exportDataBackup(storage);
  const text = JSON.stringify(backup);
  assert.equal(text.includes('secret'), false);
  backup.workspace.draft.apiKey = 'injected-secret';
  backup.preferences.extra = 'preference-secret';
  const target = memory();
  commitDataImport(target, prepareDataImport(target, backup, { includeFormation: true }));
  assert.equal(JSON.stringify([...target.data]).includes('secret'), false);
});

test('legacy battle and formation sessions are included without deleting their original data', () => {
  const storage = memory();
  const session = applyAction(createSession({ players: [player], x0: 412, y0: 687, spacing: 1 }), 'placed');
  saveWorkspace(storage, { ...DEFAULT_DRAFT, names: 'Aurora' }, session);
  const legacy = JSON.stringify({ version: 1, selectedMap: 'canyon', drafts: { canyon: mergeBattlePlayers(emptyBattle(), [player]) } });
  storage.setItem(LEGACY_BATTLE_KEY, legacy);
  const exported = exportDataBackup(storage);
  const target = memory();
  commitDataImport(target, prepareDataImport(target, exported, { includeFormation: true }));
  assert.deepEqual(loadWorkspace(target).session, session);
  assert.equal(currentBattle(loadBattles(target)).players[0].id, player.id);
  assert.equal(storage.getItem(LEGACY_BATTLE_KEY), legacy);
  assert.equal(storage.getItem(BATTLE_KEY), null);
});

test('invalid and oversized files fail before writes, including invalid nested assignments and roster entries', () => {
  const target = source();
  const before = new Map(target.data);
  for (const text of ['not json', '{}', '{"format":"basegrid-backup","version":2}', ' '.repeat(MAX_BACKUP_BYTES + 1)]) assert.throws(() => parseDataBackup(text));
  const backup = exportDataBackup(target);
  for (const corrupt of [
    value => { value.battles.plans.canyon[0].assignments.power = ['missing']; },
    value => { value.rosters.entries[0].data = [{ id: 'wrong', name: 'Bad' }]; },
    value => { value.workspace.draft.layout.obstacles[0].size = 5; },
    value => { value.workspace.draft.names = 10; },
  ]) {
    const copy = structuredClone(backup); corrupt(copy);
    assert.throws(() => prepareDataImport(target, copy));
    assert.deepEqual(target.data, before);
  }
});

test('a stale preview cannot overwrite data changed in another tab', () => {
  const target = source();
  const preview = prepareDataImport(target, exportDataBackup(source()));
  const changes = loadBattles(target); changes.plans.canyon[0].title = 'New title'; saveBattles(target, changes);
  const before = new Map(target.data);
  assert.throws(() => commitDataImport(target, preview), /changed/);
  assert.deepEqual(target.data, before);
});

test('write failure rolls back imported records and never announces a completed import', () => {
  const backup = exportDataBackup(source());
  for (const failAt of [1, 2, 3, 4, 5, 6]) {
    const target = memory();
    target.setItem('unrelated', 'keep');
    const before = new Map(target.data);
    const preview = prepareDataImport(target, backup, { includeFormation: true });
    let writes = 0;
    const failing = { ...target, setItem(key, value) { if (++writes === failAt) throw new Error('Quota'); target.setItem(key, value); } };
    assert.throws(() => commitDataImport(failing, preview), /previous data is unchanged/);
    assert.deepEqual(target.data, before);
    assert.equal(target.getItem(DATA_IMPORT_KEY), null);
  }
  const target = source();
  const before = new Map(target.data);
  const preview = prepareDataImport(target, backup, { includeFormation: true });
  let writes = 0;
  const failing = { ...target, setItem(key, value) { if (++writes === 2) throw new Error('Quota'); target.setItem(key, value); } };
  assert.throws(() => commitDataImport(failing, preview));
  assert.deepEqual(target.data, before);
});
