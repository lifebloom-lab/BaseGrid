import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBattle } from '../battle-render.js';
import { BATTLE_MAPS, emptyBattle } from '../battle-model.js';

test('Canyon editor has white name areas while exports paint names on the original template', t => {
  const drawings = [];
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  globalThis.document = { createElement: () => {
    const fills = [], labels = [];
    const context = {
      measureText: text => ({ width: text.length * 18 }),
      fillRect(x, y, w, h) { fills.push({ x, y, w, h, color: this.fillStyle }); },
      fillText(text) { labels.push(text); },
      drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    };
    drawings.push({ fills, labels });
    return { getContext: () => context };
  } };
  const plan = { ...emptyBattle(), players: [{ id: 'player:1', name: 'Aurora' }], assignments: { 'serum-1': ['player:1'] } };
  const image = { naturalWidth: 2842, naturalHeight: 2214 };
  const editor = drawBattle(BATTLE_MAPS.canyon, plan, image, { editing: true });
  const exported = drawBattle(BATTLE_MAPS.canyon, plan, image);
  assert.equal(drawings[0].fills.length, 2, 'editor paints a white panel over the map');
  assert.equal(drawings[0].fills[1].color, '#fffffff2');
  assert.equal(drawings[0].labels.includes('Aurora'), false, 'the DOM capsule supplies the editing label');
  assert.equal(drawings[1].fills.length, 1, 'export paints no rectangle over the template');
  assert.ok(drawings[1].labels.includes('Aurora'), 'the exported PNG includes the full player name');
  assert.deepEqual(editor.zones, exported.zones, 'both modes share the same safe map bounds');
  assert.deepEqual(plan.assignments, { 'serum-1': ['player:1'] });
});
