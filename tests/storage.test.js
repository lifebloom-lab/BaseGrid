import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, DEFAULT_DRAFT, saveWorkspace, loadWorkspace, clearWorkspace } from '../storage.js';
import { createSession, applyAction, undoLastAction, getProposal } from '../placement.js';
import { normalizeMembers, orderPlayers } from '../lastwar-api.js';
import { playersFromDraft, moveDraftPlayer, changeDraftObstacle, rosterContextLabels } from '../players.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('empty storage supplies editable defaults', () => {
  assert.deepEqual(loadWorkspace(memoryStorage()), { draft: DEFAULT_DRAFT, session: null });
});

test('unfinished drafts survive reload without requiring valid placement inputs', () => {
  const storage = memoryStorage();
  const draft = { names: 'Gaby\nMbac', x: '', y: '687', spacing: '-1' };
  saveWorkspace(storage, draft, null);
  assert.deepEqual(loadWorkspace(storage), { draft, session: null });
});

test('active sessions, explicit obstacles, and undo history survive storage round-trip', () => {
  const storage = memoryStorage();
  const initial = createSession({ players: [{ name: 'Gaby' }, { name: 'Mbac' }], x0: 412, y0: 687, spacing: 1 });
  const session = applyAction(applyAction(initial, 'placed'), 'obstacle');
  const draft = { ...DEFAULT_DRAFT, names: 'Gaby\nMbac' };
  saveWorkspace(storage, draft, session);
  const restored = loadWorkspace(storage);
  assert.deepEqual(restored, { draft, session });
  assert.deepEqual(undoLastAction(restored.session), undoLastAction(session));
});

test('reset removes only BaseGrid data', () => {
  const storage = memoryStorage();
  storage.setItem('other-app', 'keep');
  saveWorkspace(storage, DEFAULT_DRAFT, null);
  clearWorkspace(storage);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem('other-app'), 'keep');
});

test('corrupt JSON, invalid drafts, and unsupported versions are rejected', () => {
  const storage = memoryStorage();
  for (const raw of ['{', 'null', '{}', JSON.stringify({ version: 5, draft: DEFAULT_DRAFT }),
    JSON.stringify({ version: 1, draft: { ...DEFAULT_DRAFT, x: 12 }, session: null }),
    JSON.stringify({ version: 1, draft: DEFAULT_DRAFT, session: {} })]) {
    storage.setItem(STORAGE_KEY, raw);
    assert.throws(() => loadWorkspace(storage));
  }
});

test('storage failures reach the UI caller instead of silently claiming success', () => {
  const failing = {
    getItem() { throw new Error('Storage denied'); },
    setItem() { throw new Error('Quota exceeded'); },
    removeItem() { throw new Error('Storage denied'); },
  };
  assert.throws(() => saveWorkspace(failing, DEFAULT_DRAFT, null), /Quota/);
  assert.throws(() => loadWorkspace(failing), /denied/);
  assert.throws(() => clearWorkspace(failing), /denied/);
});

test('imported draft records survive refresh and older manual drafts still work', () => {
  const storage = memoryStorage();
  const draft = { ...DEFAULT_DRAFT, names: 'Gaby', importedPlayers: [{ id: 'lastwar:123', name: 'Gaby', power: 500, rank: 4, group: 4, hqLevel: 35 }] };
  saveWorkspace(storage, draft, null);
  assert.deepEqual(loadWorkspace(storage).draft, draft);
  saveWorkspace(storage, DEFAULT_DRAFT, null);
  assert.deepEqual(loadWorkspace(storage).draft, DEFAULT_DRAFT);
});

test('older imports gain group fields in both the draft and an active session on reload', () => {
  const storage = memoryStorage();
  const players = [{ id: 'lastwar:1', name: 'Gaby', rank: 4, hqLevel: 35 },
    { id: 'lastwar:2', name: 'Zoe', rank: 0, hqLevel: 0 }];
  const draft = { ...DEFAULT_DRAFT, names: 'Gaby\nZoe', importedPlayers: players };
  const session = applyAction(createSession({ players, x0: 412, y0: 687, spacing: 1 }), 'placed');
  saveWorkspace(storage, draft, session);
  const restored = loadWorkspace(storage);
  const expected = [{ ...players[0], group: 4 }, { ...players[1], group: null, hqLevel: null }];
  assert.deepEqual(restored.draft.importedPlayers, expected);
  assert.deepEqual(restored.session.players, expected);
  assert.equal(getProposal(undoLastAction(restored.session)).player.group, 4);
});

test('imported HQ levels and groups survive sorting, roster edits, placement, obstacles, refresh, and undo', () => {
  const storage = memoryStorage();
  const allianceId = 'a'.repeat(32);
  const importedPlayers = orderPlayers(normalizeMembers({ alliance_id: allianceId, member_count: 2, members: [
    { uid: '1', name: 'Zoe', rank: 2, hq_level: 35, power: 900 },
    { uid: '2', name: 'Gaby', rank: 4, hq_level: 28, power: 700 },
  ] }, allianceId), 'name');
  const draft = { ...DEFAULT_DRAFT, names: 'Zoe\nNew player\nGaby', importedPlayers };
  const initial = createSession({ players: playersFromDraft(draft), x0: 412, y0: 687, spacing: 1 });
  const session = applyAction(applyAction(initial, 'obstacle'), 'placed');
  saveWorkspace(storage, draft, session);
  const restored = loadWorkspace(storage);
  assert.deepEqual(restored, { draft, session });
  const undone = undoLastAction(restored.session);
  assert.equal(getProposal(undone).player.hqLevel, 35);
  assert.equal(getProposal(undone).player.group, 2);
  assert.deepEqual(undoLastAction(undone), initial);
});

test('malformed imported records in storage are rejected', () => {
  const storage = memoryStorage();
  for (const importedPlayers of [null, {}, [null], [{ name: 'A' }],
    [{ id: 'lastwar:1', name: 'A' }, { id: 'lastwar:1', name: 'B' }]]) {
    saveWorkspace(storage, { ...DEFAULT_DRAFT, importedPlayers }, null);
    assert.throws(() => loadWorkspace(storage), /imported roster/);
  }
});

test('import context survives reordering, obstacles, placement and reload, and clears with the workspace', () => {
  const storage = memoryStorage();
  const importedPlayers = [{ id: 'lastwar:1', name: 'Zoe' }, { id: 'lastwar:2', name: 'Gaby' }];
  const rosterContext = { serverId: 1234, allianceId: 'a'.repeat(32), allianceName: 'Test alliance', allianceTag: 'TEST' };
  let draft = { ...DEFAULT_DRAFT, names: 'Zoe\nGaby', importedPlayers, rosterContext };
  draft = changeDraftObstacle(moveDraftPlayer(draft, 0, 1), null, 0);
  const session = applyAction(createSession({ players: playersFromDraft(draft), plannedObstacles: draft.plannedObstacles,
    x0: 412, y0: 687, spacing: 1 }), 'placed');
  saveWorkspace(storage, draft, session);
  const restored = loadWorkspace(storage);
  assert.deepEqual(restored.draft.rosterContext, rosterContext);
  assert.deepEqual(rosterContextLabels(restored.draft.rosterContext), { server: '#1234', alliance: '[TEST] Test alliance' });
  clearWorkspace(storage);
  assert.equal(loadWorkspace(storage).draft.rosterContext, undefined);
});

test('missing or invalid context remains usable and displays unknown values rather than guessed ones', () => {
  const storage = memoryStorage();
  saveWorkspace(storage, { ...DEFAULT_DRAFT, rosterContext: { serverId: -1, allianceId: 'bad', allianceName: 123 } }, null);
  assert.equal(loadWorkspace(storage).draft.rosterContext, null);
  assert.deepEqual(rosterContextLabels(null), { server: 'Not provided', alliance: 'Not provided' });
  assert.deepEqual(rosterContextLabels({ allianceId: 'a'.repeat(32) }), { server: 'Not provided', alliance: `ID ${'a'.repeat(32)}` });
});
