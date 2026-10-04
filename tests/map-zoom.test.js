import test from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, nextZoom, fitZoom, zoomDetail, zoomScroll, BASE_CELL_SIZE } from '../map-zoom.js';

test('zoom limits reject invalid values and keep stepping reversible', () => {
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom(Infinity), 1);
  assert.equal(clampZoom(-1), 0.0625);
  assert.equal(clampZoom(10), 2);
  assert.equal(nextZoom(2, 1), 2);
  assert.equal(nextZoom(0.0625, -1), 0.0625);
  assert.equal(nextZoom(nextZoom(1, -1), 1), 1);
  assert.equal(nextZoom(0.637, -1), 0.5);
  assert.equal(nextZoom(0.637, 1), 0.75);
});

test('Fit accounts for both map dimensions and never enlarges a small formation', () => {
  const scale = fitZoom(40, 40, 360, 700);
  assert.ok(40 * BASE_CELL_SIZE * scale <= 360);
  assert.ok(40 * BASE_CELL_SIZE * scale <= 700);
  assert.equal(fitZoom(20, 40, 900, 400), 400 / (40 * BASE_CELL_SIZE));
  assert.equal(fitZoom(3, 3, 900, 700), 1);
  assert.ok(21 * BASE_CELL_SIZE * fitZoom(21, 21, 1200, 114) <= 114);
  assert.equal(fitZoom(500, 500, 360, 700), 0.0625);
  assert.equal(fitZoom(0, 0, 360, 700), 1);
});

test('zoom preserves the viewport center in map coordinates, including fractional scales', () => {
  for (const [from, to] of [[1, 0.5], [0.5, 1.5], [0.637, 1], [1, 0.125]]) {
    const before = 2000;
    const anchor = 200;
    const padding = 25;
    const after = zoomScroll(before, anchor, padding, from, to);
    assert.ok(Math.abs((before + anchor - padding) / from - (after + anchor - padding) / to) < 1e-8);
  }
  assert.equal(zoomScroll(0, 200, 25, 1, 0.125), 0);
});

test('reduced detail starts before full-size controls would no longer fit', () => {
  assert.equal(zoomDetail(2), 'full');
  assert.equal(zoomDetail(1), 'full');
  assert.equal(zoomDetail(0.999), 'compact');
  assert.equal(zoomDetail(0.5), 'compact');
  assert.equal(zoomDetail(0.499), 'overview');
  assert.equal(zoomDetail(0.125), 'overview');
});
