import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBattle } from '../battle-render.js';
import { ALLIES, BATTLE_MAPS, emptyBattle, assignBattlePlayer } from '../battle-model.js';

test('Canyon editor and export preserve the original panel colors', t => {
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
  assert.equal(drawings[0].fills.length, 1, 'editor paints no rectangle over the template');
  assert.equal(drawings[0].labels.includes('Aurora'), false, 'the DOM capsule supplies the editing label');
  assert.equal(drawings[1].fills.length, 1, 'export paints no rectangle over the template');
  assert.ok(drawings[1].labels.includes('Aurora'), 'the exported PNG includes the full player name');
  assert.deepEqual(editor.zones, exported.zones, 'both modes share the same safe map bounds');
  assert.deepEqual(plan.assignments, { 'serum-1': ['player:1'] });

  let reused = assignBattlePlayer(plan, 'canyon', 'player:1', 'power');
  reused = assignBattlePlayer(reused, 'canyon', ALLIES.id, 'data-1');
  reused = assignBattlePlayer(reused, 'canyon', ALLIES.id, 'virus');
  const repeatExport = drawBattle(BATTLE_MAPS.canyon, reused, image);
  assert.equal(repeatExport.assigned, 1, 'a repeated name counts as one player');
  assert.equal(repeatExport.unassigned, 0);
  assert.equal(repeatExport.placementCount, 4);
  assert.equal(repeatExport.alliesZones, 2);
  assert.equal(drawings[2].labels.filter(label => label === 'Aurora').length, 2);
  assert.equal(drawings[2].labels.filter(label => label === 'Allies').length, 2);
  assert.ok(drawings[2].labels.includes('1 / 1 assigned · BaseGrid'));
  const alliesOnly = drawBattle(BATTLE_MAPS.canyon, assignBattlePlayer(emptyBattle(), 'canyon', ALLIES.id, 'power'), image);
  assert.equal(alliesOnly.assigned, 0);
  assert.equal(alliesOnly.placementCount, 1, 'an Allies-only map can be exported');
  assert.ok(drawings[3].labels.includes('Allies'));

});
