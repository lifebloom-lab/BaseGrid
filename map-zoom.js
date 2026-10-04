export const ZOOM_STEPS = [0.0625, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 2];
export const BASE_CELL_SIZE = 64;
const ZOOM_KEY = 'basegrid.map-zoom.v1';

export function clampZoom(value) {
  return Number.isFinite(value) ? Math.min(2, Math.max(0.0625, value)) : 1;
}

export function nextZoom(value, direction) {
  return direction > 0 ? ZOOM_STEPS.find(step => step > value + 0.001) ?? 2
    : [...ZOOM_STEPS].reverse().find(step => step < value - 0.001) ?? 0.0625;
}

export function zoomDetail(value) {
  return value >= 1 ? 'full' : value >= 0.5 ? 'compact' : 'overview';
}

export function fitZoom(columns, rows, width, height) {
  if (![columns, rows, width, height].every(value => Number.isFinite(value) && value > 0)) return 1;
  return clampZoom(Math.min(1, width / (columns * BASE_CELL_SIZE), height / (rows * BASE_CELL_SIZE)));
}

// Keep the same map point under the viewport anchor when the scale changes.
export function zoomScroll(scroll, anchor, padding, from, to) {
  return Math.max(0, (scroll + anchor - padding) * to / from + padding - anchor);
}

export function setupMapZoom({ map, grid, controls, beforeZoom = () => {} }) {
  let scale = 1;
  try {
    const saved = window.localStorage.getItem(ZOOM_KEY);
    if (saved !== null) scale = clampZoom(Number(saved));
  } catch { /* Zoom still works when browser storage is unavailable. */ }
  const out = controls.querySelector('[data-zoom="out"]');
  const reset = controls.querySelector('[data-zoom="reset"]');
  const into = controls.querySelector('[data-zoom="in"]');
  const fit = controls.querySelector('[data-zoom="fit"]');
  const hint = controls.querySelector('.map-zoom-hint');
  const status = controls.querySelector('[role="status"]');

  function render() {
    grid.style.setProperty('--cell-size', `${BASE_CELL_SIZE * scale}px`);
    grid.dataset.detail = zoomDetail(scale);
    grid.dataset.tiny = String(scale < 0.125);
    out.disabled = scale <= 0.0625;
    into.disabled = scale >= 2;
    reset.textContent = `${Math.round(scale * 100)}%`;
    reset.setAttribute('aria-label', `${Math.round(scale * 100)}% zoom. Reset to 100%`);
    hint.hidden = grid.dataset.detail === 'full';
  }

  function set(value, point) {
    if (map.hidden) return;
    beforeZoom();
    const next = clampZoom(value);
    const padding = getComputedStyle(map);
    const left = parseFloat(padding.paddingLeft);
    const top = parseFloat(padding.paddingTop);
    const position = point ? {
      left: point.column * BASE_CELL_SIZE * next + left - map.clientWidth / 2,
      top: point.row * BASE_CELL_SIZE * next + top - map.clientHeight / 2,
    } : {
      left: zoomScroll(map.scrollLeft, map.clientWidth / 2, left, scale, next),
      top: zoomScroll(map.scrollTop, map.clientHeight / 2, top, scale, next),
    };
    scale = next;
    render();
    map.scrollTo(position);
    status.textContent = `${Math.round(scale * 100)}% zoom. ${grid.dataset.detail === 'full' ? 'Full details.' : grid.dataset.detail === 'compact' ? 'Names, HQ levels, and ranks.' : 'Rank and status overview.'}`;
    try { window.localStorage.setItem(ZOOM_KEY, String(scale)); } catch { /* Keep the preference for this visit. */ }
  }

  out.addEventListener('click', () => set(nextZoom(scale, -1)));
  into.addEventListener('click', () => set(nextZoom(scale, 1)));
  reset.addEventListener('click', () => set(1));
  fit.addEventListener('click', () => {
    const padding = getComputedStyle(map);
    set(fitZoom(Number(grid.dataset.columns), Number(grid.dataset.rows),
      map.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight) - 1,
      map.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom) - 1));
    map.scrollTo(0, 0);
  });
  render();
  return { render, zoomTo(cell) {
    const size = Number(cell.dataset.size);
    set(1, { column: Number(cell.dataset.column) - Number(grid.dataset.minColumn) + size / 2,
      row: Number(cell.dataset.row) - Number(grid.dataset.minRow) + size / 2 });
    (cell.querySelector('.tile-action, .slot-move, .obstacle-remove') ?? map).focus({ preventScroll: true });
  } };
}
