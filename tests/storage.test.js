import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, DEFAULT_DRAFT, saveWorkspace, loadWorkspace, clearWorkspace } from '../storage.js';
import { createSession, applyAction, undoLastAction } from '../placement.js';

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
