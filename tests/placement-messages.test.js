import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_LANGUAGES, MESSAGE_LANGUAGE_KEY, formatPlacementMessage, loadMessageLanguage, saveMessageLanguage } from '../placement-messages.js';
import { createSession, getProposal, applyAction, undoLastAction } from '../placement.js';
import { DEFAULT_DRAFT, saveWorkspace, loadWorkspace, clearWorkspace } from '../storage.js';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const setup = { players: [{ id: '1', name: 'Zoë 🇧🇷' }, { id: '2', name: '민수' }], x0: 412, y0: 687, spacing: 1 };

test('every language preserves the exact player name and numeric coordinates without HTML interpolation', () => {
  const proposal = { player: { name: 'Zoë <R4> & 민수' }, x: 0, y: -687 };
  const messages = MESSAGE_LANGUAGES.map(({ id }) => {
    const text = formatPlacementMessage(proposal, id);
    assert.ok(text.includes(proposal.player.name));
    assert.match(text, /X\s*:\s*0/);
    assert.match(text, /Y\s*:\s*-687/);
    assert.doesNotMatch(text, /undefined|null|NaN/);
    return text;
  });
  assert.equal(new Set(messages).size, MESSAGE_LANGUAGES.length);
  assert.ok(messages.some(text => text.startsWith('Olá,')));
  assert.ok(messages.some(text => text.includes('안녕하세요')));
});

test('message follows obstacle skips, the next player and undo using current proposed coordinates', () => {
  const initial = createSession({ ...setup, plannedObstacles: [0, 2] });
  let session = initial;
  assert.match(formatPlacementMessage(getProposal(session)), /Zoë 🇧🇷!.*X: 416, Y: 687/);
  session = applyAction(session, 'obstacle');
  assert.match(formatPlacementMessage(getProposal(session)), /Zoë 🇧🇷!.*X: 416, Y: 691/);
  session = applyAction(session, 'placed');
  assert.match(formatPlacementMessage(getProposal(session), 'ko'), /민수님.*X: 412, Y: 695/);
  session = undoLastAction(session);
  assert.match(formatPlacementMessage(getProposal(session)), /Zoë 🇧🇷!.*X: 416, Y: 691/);
  assert.deepEqual(undoLastAction(session), initial);
});

test('finished and unstarted plans have no suggested message; unknown languages fall back to English', () => {
  let session = createSession(setup);
  const proposal = getProposal(session);
  for (const value of [undefined, null, 'xx', '__proto__']) {
    assert.equal(formatPlacementMessage(proposal, value), formatPlacementMessage(proposal, 'en'));
  }
  session = applyAction(applyAction(session, 'placed'), 'placed');
  assert.equal(formatPlacementMessage(getProposal(session), 'fr'), '');
  assert.equal(formatPlacementMessage(null), '');
});

test('preferred language and current message survive reload; clearing the plan retains the language', () => {
  const storage = memoryStorage();
  const session = applyAction(createSession(setup), 'obstacle');
  saveMessageLanguage(storage, 'pt-BR');
  saveWorkspace(storage, { ...DEFAULT_DRAFT, names: setup.players.map(player => player.name).join('\n') }, session);
  const restored = loadWorkspace(storage);
  assert.equal(loadMessageLanguage(storage), 'pt-BR');
  assert.equal(formatPlacementMessage(getProposal(restored.session), loadMessageLanguage(storage)), formatPlacementMessage(getProposal(session), 'pt-BR'));
  clearWorkspace(storage);
  assert.equal(loadWorkspace(storage).session, null);
  assert.equal(loadMessageLanguage(storage), 'pt-BR');
});

test('missing, corrupted or unavailable preferences default to English without blocking placement', () => {
  const storage = memoryStorage();
  assert.equal(loadMessageLanguage(storage), 'en');
  storage.setItem(MESSAGE_LANGUAGE_KEY, '{bad preference');
  assert.equal(loadMessageLanguage(storage), 'en');
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  assert.equal(loadMessageLanguage(denied), 'en');
  assert.throws(() => saveMessageLanguage(denied, 'fr'), /Denied/);
  saveMessageLanguage(storage, 'unknown');
  assert.equal(loadMessageLanguage(storage), 'en');
});
