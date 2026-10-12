import test from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY_STORAGE_KEY, readSavedApiKey, saveApiKey, forgetApiKey } from '../api-key.js';

const memory = () => {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};

test('a default key is absent until explicitly saved and forget leaves other data intact', () => {
  const storage = memory();
  storage.setItem('basegrid.rosters.v1', 'keep roster');
  assert.equal(readSavedApiKey(storage), '');
  saveApiKey(storage, '  sample-private-key  ');
  assert.equal(readSavedApiKey(storage), 'sample-private-key');
  saveApiKey(storage, 'replacement-key');
  assert.equal(readSavedApiKey(storage), 'replacement-key');
  forgetApiKey(storage);
  assert.equal(readSavedApiKey(storage), '');
  assert.equal(storage.getItem(API_KEY_STORAGE_KEY), null);
  assert.equal(storage.getItem('basegrid.rosters.v1'), 'keep roster');
});

test('invalid keys cannot replace a saved key or be reused from storage', () => {
  const storage = memory();
  for (const value of ['', '   ', 'key\nheader', 'key\rheader', 'x'.repeat(1025), null]) {
    saveApiKey(storage, 'existing-key');
    assert.throws(() => saveApiKey(storage, value), /valid API key/);
    assert.equal(readSavedApiKey(storage), 'existing-key');
    storage.setItem(API_KEY_STORAGE_KEY, value);
    assert.equal(readSavedApiKey(storage), '');
  }
});

test('storage failures are reported to the caller rather than claiming a key was saved or forgotten', () => {
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Full'); }, removeItem() { throw new Error('Blocked'); } };
  assert.throws(() => readSavedApiKey(blocked), /Blocked/);
  assert.throws(() => saveApiKey(blocked, 'sample-key'), /Full/);
  assert.throws(() => forgetApiKey(blocked), /Blocked/);
});
