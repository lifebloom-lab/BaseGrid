import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAlliances, fetchMembers, normalizeAlliances, normalizeMembers, orderPlayers } from '../lastwar-api.js';
import { playersFromDraft, playerDetails } from '../players.js';
import { createSession } from '../placement.js';

const id = 'a'.repeat(32);
const member = (uid, name, power = 100) => ({ uid, name, power, rank: 4, hq_level: 28, server_id: 1234, x: null, y: null });
const roster = { alliance_id: id, member_count: 3, members: [member('1', 'Zoe', 500), member('2', 'Gaby', 800), member('3', 'Mbac', 600)] };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'X-BaseGrid-Relay': '1' } });

test('alliance lookup sends the key in a header to the local relay, never a URL', async () => {
  let captured;
  const data = [{ id, abbr: ' TAG ', name: ' Alliance ', member_count: 3 }];
  const result = await fetchAlliances('01234', { apiKey: ' example-key ', fetchImpl: async (url, options) => {
    captured = { url, options };
    return response(data);
  } });
  assert.equal(captured.url, '/api/lastwar/rankings/1234/alliances');
  assert.equal(captured.options.headers['X-API-Key'], 'example-key');
  assert.equal(captured.options.cache, 'no-store');
  assert.equal(captured.options.credentials, 'omit');
  assert.equal(captured.options.redirect, 'error');
  assert.deepEqual(result, [{ id, tag: 'TAG', name: 'Alliance', memberCount: 3 }]);
});

test('roster import maps API records to the engine and strips unrelated fields', async () => {
  const data = structuredClone(roster);
  data.members[0].api_key = 'must-not-persist';
  data.members[0].name = '  Zoe\n  One  ';
  const players = await fetchMembers(id.toUpperCase(), { apiKey: 'key', fetchImpl: async url => {
    assert.equal(url, `/api/lastwar/alliance/${id}/members`);
    return response(data);
  } });
  assert.deepEqual(players[0], { id: 'lastwar:1', name: 'Zoe One', rank: 4, group: 4, power: 500, hqLevel: 28, serverId: 1234 });
  const session = createSession({ players, x0: 412, y0: 687, spacing: 1 });
  assert.equal(session.players[0].id, 'lastwar:1');
  assert.equal(session.players[0].hqLevel, 28);
  assert.equal(session.players[0].group, 4);
});

test('all five provider groups and HQ levels above 30 are imported without guessing game roles', () => {
  const data = { alliance_id: id, member_count: 5, members: [1, 2, 3, 4, 5].map(rank => ({
    ...member(String(rank), `Player ${rank}`), rank, hq_level: 30 + rank,
  })) };
  const players = normalizeMembers(data, id);
  assert.deepEqual(players.map(p => p.group), [1, 2, 3, 4, 5]);
  assert.deepEqual(players.map(p => p.hqLevel), [31, 32, 33, 34, 35]);
  assert.equal(playerDetails(players[0]), 'HQ 31 · Group 1');
});

test('missing or invalid HQ/group metadata stays unknown without rejecting valid players', () => {
  for (const value of [undefined, null, 0, -1, 1.5, '4', 'R4', true, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const [player] = normalizeMembers({ alliance_id: id, member_count: 1,
      members: [{ ...member('1', 'Gaby'), hq_level: value, rank: value }] }, id);
    assert.equal(player.hqLevel, null);
    assert.equal(player.group, null);
    assert.equal(playerDetails(player), 'HQ unknown · Group unknown');
  }
  const [player] = normalizeMembers({ alliance_id: id, member_count: 1,
    members: [{ ...member('1', 'Gaby'), rank: 6 }] }, id);
  assert.equal(player.group, null);
  assert.equal(player.rank, 6);
  assert.equal(playerDetails({ id: 'player-1', name: 'Manual' }), '');
});

test('empty, partial, duplicate, or wrong-alliance rosters cannot replace a roster', () => {
  for (const data of [null, {}, { ...roster, alliance_id: 'b'.repeat(32) },
    { ...roster, members: [] }, { ...roster, member_count: 4 },
    { ...roster, members: [member('1', 'A'), member('1', 'B'), member('3', 'C')] },
    { ...roster, members: [member('1', 'A'), member('2', ' '), member('3', 'C')] }]) {
    assert.throws(() => normalizeMembers(data, id));
  }
  assert.throws(() => normalizeAlliances({ alliances: [] }));
  assert.throws(() => normalizeAlliances([{ id: 'bad', name: 'A', abbr: 'A' }]));
  assert.throws(() => normalizeAlliances([{ id, name: 'A', abbr: 'A' }, { id, name: 'B', abbr: 'B' }]));
});

test('input validation happens before making any request', async () => {
  let calls = 0;
  const options = { apiKey: 'key', fetchImpl: async () => { calls++; } };
  for (const server of ['', '1.2', '-1', '1e3', 'bad', 0, NaN, 10000000000]) await assert.rejects(fetchAlliances(server, options));
  for (const alliance of ['', null, '../../secrets', 'short']) await assert.rejects(fetchMembers(alliance, options));
  for (const apiKey of ['', '  ', 'key\ninvalid', 'x'.repeat(1025)]) await assert.rejects(fetchMembers(id, { ...options, apiKey }));
  assert.equal(calls, 0);
});

for (const [status, expected] of [[401, /key was not accepted/], [402, /credits/], [403, /access/], [404, /not found/], [429, /rate limiting/], [503, /busy/], [504, /too long/]]) {
  test(`HTTP ${status} gives a useful message without displaying the upstream error`, async () => {
    await assert.rejects(fetchMembers(id, { apiKey: 'secret', fetchImpl: async () => response({ detail: 'secret must not be displayed' }, status) }), expected);
  });
}

test('a plain static server explains that the relay is needed', async () => {
  await assert.rejects(fetchMembers(id, { apiKey: 'key', fetchImpl: async () => new Response('<html>404</html>', { status: 404 }) }), /python3 server.py/);
});

test('malformed JSON and network failures are reported without provider data', async () => {
  await assert.rejects(fetchMembers(id, { apiKey: 'key', fetchImpl: async () => new Response('{', { headers: { 'X-BaseGrid-Relay': '1' } }) }), /unreadable/);
  await assert.rejects(fetchMembers(id, { apiKey: 'key', fetchImpl: async () => { throw new TypeError('network'); } }), /Could not connect/);
});

const pendingFetch = async (_, { signal }) => new Promise((resolve, reject) => {
  const abort = () => reject(new DOMException('Aborted', 'AbortError'));
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
});

test('closing the dialog can cancel a pending request', async () => {
  const controller = new AbortController();
  const request = fetchMembers(id, { apiKey: 'key', signal: controller.signal, fetchImpl: pendingFetch });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

test('a stalled provider request times out', async () => {
  await assert.rejects(fetchMembers(id, { apiKey: 'key', fetchImpl: pendingFetch, timeoutMs: 5 }), /timed out/);
});

test('review sorting is predictable and does not alter API records', () => {
  const players = normalizeMembers(roster, id);
  assert.deepEqual(orderPlayers(players, 'power').map(p => p.name), ['Gaby', 'Mbac', 'Zoe']);
  assert.deepEqual(orderPlayers(players, 'name').map(p => p.name), ['Gaby', 'Mbac', 'Zoe']);
  assert.deepEqual(players.map(p => p.name), ['Zoe', 'Gaby', 'Mbac']);
  assert.deepEqual(orderPlayers([{ name: 'A' }, { name: 'B', power: 0 }]).map(p => p.name), ['B', 'A']);
});

test('editing and reordering a roster preserves identities and metadata of matching names', () => {
  const importedPlayers = normalizeMembers(roster, id);
  const players = playersFromDraft({ names: 'Mbac\nNew player\nGaby', importedPlayers });
  assert.deepEqual(players.map(p => p.id), ['lastwar:3', 'player-2', 'lastwar:2']);
  assert.equal(players[0].power, 600);
  assert.equal(players[0].hqLevel, 28);
  assert.equal(players[0].group, 4);
  assert.equal(importedPlayers.length, 3);
  const duplicates = playersFromDraft({ names: 'Same\nSame\nSame', importedPlayers: [
    { id: 'lastwar:1', name: 'Same' }, { id: 'lastwar:2', name: 'Same' },
  ] });
  assert.deepEqual(duplicates.map(p => p.id), ['lastwar:1', 'lastwar:2', 'player-3']);
});
