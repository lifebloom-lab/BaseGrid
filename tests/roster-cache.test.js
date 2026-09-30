import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterCache, ROSTER_CACHE_KEY } from '../roster-cache.js';
import { saveWorkspace, clearWorkspace, DEFAULT_DRAFT } from '../storage.js';

const id = 'a'.repeat(32);
const otherId = 'b'.repeat(32);
const players = [{ id: 'lastwar:1', name: 'Gaby', hqLevel: 35, group: 4, rank: 4, power: 900 }];
const alliances = [{ id, name: 'Test alliance', tag: 'TEST', memberCount: 1 }];
const context = { serverId: 1234, allianceId: id, allianceName: 'Test alliance', allianceTag: 'TEST' };
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('rosters persist immediately, including before applying them, and reload without any API call or key', async () => {
  const storage = memoryStorage();
  let calls = 0;
  const cache = createRosterCache({ getStorage: () => storage, getMembers: async () => { calls++; return players; }, now: () => 1000 });
  const result = await cache.loadRoster(id, { apiKey: 'secret' }, { label: 'TEST' });
  assert.equal(result.source, 'api');
  assert.equal(result.persisted, true);
  assert.equal(result.savedAt, 1000);
  assert.deepEqual((await cache.loadRoster(id.toUpperCase())).data, players);
  assert.equal(calls, 1);
  const reopened = createRosterCache({ getStorage: () => storage,
    getMembers: async () => { throw new Error('Unexpected API call'); }, now: () => 999999999999 });
  const saved = await reopened.loadRoster(id);
  assert.equal(saved.source, 'saved');
  assert.equal(saved.savedAt, 1000); // No automatic expiry or timestamp changes on reuse.
  assert.deepEqual(saved.data, players);
  assert.equal(reopened.listRosters()[0].label, 'TEST');
});

test('alliance searches reuse local results and keep separate servers and rosters', async () => {
  const storage = memoryStorage();
  let calls = 0;
  const cache = createRosterCache({ getStorage: () => storage,
    getAlliances: async server => { calls++; return server === '1234' ? alliances : []; }, getMembers: async () => players });
  await cache.loadAlliances('01234', { apiKey: 'secret' });
  await cache.loadAlliances('1234');
  await cache.loadAlliances('5678');
  await cache.loadAlliances('5678'); // Empty searches are saved too.
  assert.equal(calls, 2);
  await cache.loadRoster(id);
  await cache.loadRoster(otherId);
  assert.equal(cache.listRosters().length, 2);
  const reopened = createRosterCache({ getStorage: () => storage });
  assert.deepEqual((await reopened.loadAlliances(1234)).data, alliances);
  assert.deepEqual((await reopened.loadAlliances(5678)).data, []);
});

test('only an explicit refresh replaces a saved roster and consumes another API call', async () => {
  let calls = 0;
  const cache = createRosterCache({ getStorage: () => memory, now: () => calls * 1000,
    getMembers: async () => { calls++; return players.map(p => ({ ...p, hqLevel: 30 + calls })); } });
  const memory = memoryStorage();
  await cache.loadRoster(id);
  assert.equal((await cache.loadRoster(id)).data[0].hqLevel, 31);
  const fresh = await cache.loadRoster(id, { apiKey: 'secret' }, { refresh: true });
  assert.equal(calls, 2);
  assert.equal(fresh.data[0].hqLevel, 32);
  assert.equal(fresh.savedAt, 2000);
  assert.equal((await cache.loadRoster(id)).data[0].hqLevel, 32);
});

test('failed or cancelled refreshes keep the last saved copy usable', async () => {
  const storage = memoryStorage();
  let fail = false;
  const cache = createRosterCache({ getStorage: () => storage, getMembers: async () => {
    if (fail) throw new Error('Rate limit');
    return players;
  } });
  await cache.loadRoster(id);
  const saved = storage.getItem(ROSTER_CACHE_KEY);
  fail = true;
  await assert.rejects(cache.loadRoster(id, {}, { refresh: true }), /Rate limit/);
  assert.equal(storage.getItem(ROSTER_CACHE_KEY), saved);
  assert.deepEqual((await cache.loadRoster(id)).data, players);
  fail = false;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cache.loadRoster(id, { signal: controller.signal }, { refresh: true }), { name: 'AbortError' });
  assert.equal(storage.getItem(ROSTER_CACHE_KEY), saved);
});

test('resetting a workspace leaves the separately saved roster intact', async () => {
  const storage = memoryStorage();
  const cache = createRosterCache({ getStorage: () => storage, getMembers: async () => players });
  await cache.loadRoster(id);
  saveWorkspace(storage, DEFAULT_DRAFT, null);
  clearWorkspace(storage);
  assert.deepEqual(createRosterCache({ getStorage: () => storage }).listRosters()[0].data, players);
});

test('cache saves only known fields and returned records cannot mutate the stored original', async () => {
  const storage = memoryStorage();
  const cache = createRosterCache({ getStorage: () => storage,
    getMembers: async () => players.map(p => ({ ...p, apiKey: 'secret', token: 'secret' })) });
  const result = await cache.loadRoster(id, { apiKey: 'secret' });
  assert.equal(storage.getItem(ROSTER_CACHE_KEY).includes('secret'), false);
  result.data[0].name = 'Changed';
  cache.listRosters()[0].data[0].group = 1;
  assert.deepEqual((await cache.loadRoster(id)).data, players);
});

test('storage failures are visible and still reuse in-memory data without extra calls', async () => {
  const warnings = [];
  let calls = 0;
  const cache = createRosterCache({ getStorage: () => { throw new Error('Storage denied'); },
    onWarning: message => warnings.push(message), getMembers: async () => { calls++; return players; } });
  const result = await cache.loadRoster(id);
  assert.equal(result.persisted, false);
  assert.match(warnings.at(-1), /Could not save/);
  await cache.loadRoster(id);
  assert.equal(calls, 1);
});

test('corrupt cache data is reported without triggering an automatic API request', () => {
  for (const raw of ['{', 'null', '{"version":9,"entries":[]}', JSON.stringify({ version: 1,
    entries: [{ kind: 'roster', id, savedAt: 1, data: [{ id: 'bad', name: 'Bad' }] }] })]) {
    const storage = memoryStorage();
    storage.setItem(ROSTER_CACHE_KEY, raw);
    const warnings = [];
    const cache = createRosterCache({ getStorage: () => storage, onWarning: message => warnings.push(message),
      getMembers: () => { throw new Error('Unexpected API call'); } });
    assert.deepEqual(cache.listRosters(), []);
    assert.match(warnings[0], /could not be opened/);
  }
});

test('previous imports are preserved without a lookup and without replacing existing saved rosters', async () => {
  const storage = memoryStorage();
  const cache = createRosterCache({ getStorage: () => storage, getMembers: async () => players });
  cache.preservePreviousImport(players);
  cache.preservePreviousImport([{ ...players[0], name: 'Changed' }]);
  assert.deepEqual(cache.listRosters()[0].data, players);
  assert.equal(cache.listRosters()[0].id, 'previous-import');
  await cache.loadRoster(id);
  assert.equal(cache.listRosters().length, 2);
});

test('server and alliance context persists with a roster and survives reuse and explicit refresh', async () => {
  const storage = memoryStorage();
  let calls = 0;
  const settings = { getStorage: () => storage, getMembers: async () => { calls++; return players; } };
  const cache = createRosterCache(settings);
  await cache.loadRoster(id, { apiKey: 'secret' }, { context: { ...context, apiKey: 'secret' } });
  assert.equal(storage.getItem(ROSTER_CACHE_KEY).includes('secret'), false);
  const reopened = createRosterCache(settings);
  assert.deepEqual((await reopened.loadRoster(id)).context, context);
  assert.equal(calls, 1);
  assert.deepEqual((await reopened.loadRoster(id, {}, { refresh: true })).context, context);
  assert.equal(calls, 2);
  reopened.listRosters()[0].context.serverId = 999;
  assert.deepEqual(reopened.getRoster(id).context, context);
});

test('older roster context is recovered from a unique saved alliance search without an API call', async () => {
  const storage = memoryStorage();
  storage.setItem(ROSTER_CACHE_KEY, JSON.stringify({ version: 1, entries: [
    { kind: 'roster', id, label: 'Old roster', savedAt: 1000, data: players },
    { kind: 'alliances', id: '1234', savedAt: 500, data: alliances },
  ] }));
  const cache = createRosterCache({ getStorage: () => storage,
    getMembers: () => { throw new Error('Unexpected API call'); } });
  assert.deepEqual(cache.listRosters()[0].context, context);
  const result = await cache.loadRoster(id);
  assert.deepEqual(result.context, context);
  assert.equal(result.savedAt, 1000);
});

test('selecting a server enriches cached roster context locally without changing its download date', async () => {
  const storage = memoryStorage();
  let calls = 0;
  const cache = createRosterCache({ getStorage: () => storage, getMembers: async () => { calls++; return players; }, now: () => 1000 });
  await cache.loadRoster(id);
  const result = await cache.loadRoster(id, {}, { context, label: '[TEST] Test alliance' });
  assert.equal(calls, 1);
  assert.equal(result.source, 'saved');
  assert.equal(result.savedAt, 1000);
  assert.deepEqual(createRosterCache({ getStorage: () => storage }).getRoster(id).context, context);
});

test('direct-ID rosters do not borrow unrelated alliance context or infer a server from members', async () => {
  const cache = createRosterCache({ getStorage: () => memoryStorage(), getAlliances: async () => alliances,
    getMembers: async () => players.map(player => ({ ...player, serverId: 999 })) });
  await cache.loadAlliances('1234');
  await cache.loadRoster(id, {}, { context });
  assert.deepEqual((await cache.loadRoster(otherId)).context,
    { serverId: null, allianceId: otherId, allianceName: null, allianceTag: null });
});

test('ambiguous old alliance searches leave the source server unknown until selected explicitly', async () => {
  const storage = memoryStorage();
  const cache = createRosterCache({ getStorage: () => storage, getAlliances: async () => alliances, getMembers: async () => players });
  await cache.loadAlliances('1234');
  await cache.loadAlliances('5678');
  assert.equal((await cache.loadRoster(id)).context.serverId, null);
  assert.deepEqual((await cache.loadRoster(id, {}, { context })).context, context);
});
