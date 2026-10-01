import { gridCoordinates } from './grid-layout.js';

/** Mouse, touch and keyboard share the same one-cell snapping and footprint preview. */
export function setupFormationReorder({ grid, map, obstacleTools, validate, onDrop, announce }) {
  const root = grid.closest('.formation-panel');
  let move = null;
  let animation = null;
  const cells = () => [...grid.querySelectorAll('.slot')];
  const position = cell => ({ column: Number(cell.dataset.column), row: Number(cell.dataset.row) });
  const same = (a, b) => a && b && a.column === b.column && a.row === b.row;
  const cellAt = tile => cells().find(cell => same(position(cell), tile));
  const handle = cell => cell.matches('.obstacle-tool') ? cell : cell.querySelector('.slot-move');
  const unit = () => parseFloat(getComputedStyle(grid).getPropertyValue('--cell-size'));
  const bounds = () => ({ column: Number(grid.dataset.minColumn), row: Number(grid.dataset.minRow),
    columns: Number(grid.dataset.columns), rows: Number(grid.dataset.rows) });
  const description = (tile, size) => {
    try {
      const { x, y } = gridCoordinates({ x: Number(grid.dataset.originX), y: Number(grid.dataset.originY) }, { ...tile, size });
      return `${size === 3 ? 'Center ' : ''}X ${x}, Y ${y}`;
    } catch { return 'Coordinates out of range'; }
  };

  function markTarget(tile) {
    move.to = tile;
    move.preview.hidden = !tile;
    if (!tile) { move.valid = false; move.swap = null; move.error = 'Choose a destination on the map.'; return; }
    const area = bounds();
    const inside = tile.column >= area.column && tile.row >= area.row &&
      tile.column + move.size <= area.column + area.columns && tile.row + move.size <= area.row + area.rows;
    const result = inside ? validate(move.kind, move.from, tile, move.size)
      : { valid: false, error: 'Map edge. Cancel and use More space to extend the map.' };
    move.valid = result.valid;
    move.error = result.error;
    move.swap = result.swap ?? null;
    move.destination = result.to ?? tile;
    const destination = move.destination;
    move.preview.classList.toggle('invalid', !result.valid);
    Object.assign(move.preview.style, { left: `${(destination.column - area.column) * unit()}px`,
      top: `${(destination.row - area.row) * unit()}px`, width: `${move.size * unit()}px`, height: `${move.size * unit()}px` });
    move.preview.textContent = '';
    const label = document.createElement('span');
    label.textContent = `${move.swap ? `↔ Swap with ${move.swap.name}` : result.valid ? '✓ Fits' : '✕ Blocked'} · ${description(destination, move.size)}`;
    move.preview.append(label);
  }

  function start(cell, mode) {
    const palette = cell.matches('.obstacle-tool');
    const from = palette ? null : position(cell);
    const size = Number(cell.dataset.size);
    const preview = document.createElement('li');
    preview.className = 'drop-preview';
    preview.setAttribute('aria-hidden', 'true');
    grid.append(preview);
    move = { mode, from, kind: palette ? 'new-obstacle' : cell.dataset.kind, size, cell, preview,
      name: palette || cell.dataset.kind === 'obstacle' ? `Obstacle ${size} × ${size}` : cell.querySelector('.slot-name').textContent };
    cell.classList.add('is-drag-source');
    handle(cell).setAttribute('aria-pressed', 'true');
    handle(cell).focus({ preventScroll: true });
    const area = bounds();
    markTarget(from ?? { column: area.column, row: area.row });
    if (mode === 'pointer') preview.hidden = true;
    else announce(`${move.name}. Move one tile with the arrow keys, then Space to drop. Escape cancels.`);
  }

  function cancel(message = '') {
    if (!move) return;
    const { cell, preview, pointerId } = move;
    move = null;
    preview.remove();
    cell.classList.remove('is-drag-source');
    handle(cell)?.setAttribute('aria-pressed', 'false');
    if (pointerId !== undefined && root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
    cancelAnimationFrame(animation);
    animation = null;
    if (message) announce(message);
  }

  function finish() {
    const { from, destination: to, name, kind, size, valid, error, mode, cell, swap } = move;
    if (!valid && mode !== 'pointer') { announce(error); return; }
    cancel();
    let success = false;
    if (!valid) announce(`${error} Plan unchanged.`);
    else if (same(from, to)) announce('Plan unchanged.');
    else {
      success = onDrop(kind, from, to, size) !== false;
      announce(success ? swap ? `${name} and ${swap.name} swapped positions. Plan saved.`
        : `${name} moved to ${description(to, size)}. Plan saved.` : 'That move could not be saved. Plan unchanged.');
    }
    const target = cellAt(success ? to : from);
    (target ? handle(target) : cell.isConnected ? handle(cell) : obstacleTools[0])?.focus({ preventScroll: true });
  }

  function targetAtPointer(x, y) {
    const viewport = map.getBoundingClientRect();
    if (x < viewport.left || x >= viewport.right || y < viewport.top || y >= viewport.bottom) return null;
    const rect = grid.getBoundingClientRect();
    const area = bounds();
    if (move.kind === 'player') {
      const column = area.column + Math.floor((x - rect.left) / unit());
      const row = area.row + Math.floor((y - rect.top) / unit());
      const target = cells().find(cell => {
        const anchor = position(cell);
        return cell.dataset.kind === 'player' && !same(anchor, move.from) &&
          column >= anchor.column && column < anchor.column + Number(cell.dataset.size) &&
          row >= anchor.row && row < anchor.row + Number(cell.dataset.size);
      });
      if (target) return position(target);
    }
    // Preserve the grabbed point on existing bases, snapping their anchor to the nearest cell.
    const offsetX = move.mode === 'pointer' && move.from ? move.offsetX - unit() / 2 : 0;
    const offsetY = move.mode === 'pointer' && move.from ? move.offsetY - unit() / 2 : 0;
    const column = area.column + Math.floor((x - rect.left - offsetX) / unit());
    const row = area.row + Math.floor((y - rect.top - offsetY) / unit());
    return { column, row };
  }

  function animateDrag() {
    if (!move || move.mode !== 'pointer' || !move.active) return;
    const rect = map.getBoundingClientRect();
    const speed = (point, low, high) => point < low + 30 ? -8 : point > high - 30 ? 8 : 0;
    if (move.x >= rect.left && move.x <= rect.right && move.y >= rect.top && move.y <= rect.bottom) {
      map.scrollBy(speed(move.x, rect.left, rect.right), speed(move.y, rect.top, rect.bottom));
    }
    markTarget(targetAtPointer(move.x, move.y));
    animation = requestAnimationFrame(animateDrag);
  }

  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (move && move.mode !== 'pointer' && grid.contains(event.target)) {
      event.preventDefault();
      markTarget(targetAtPointer(event.clientX, event.clientY));
      finish();
      return;
    }
    if (event.target.closest('.obstacle-remove, .tile-action')) return;
    const cell = event.target.closest('.slot-reorderable, .obstacle-tool');
    if (!cell || cell.disabled) return;
    if (event.pointerType === 'touch' && !cell.matches('.obstacle-tool') && !event.target.closest('.slot-move')) return;
    cancel();
    if (event.pointerType === 'mouse') event.preventDefault();
    start(cell, 'pointer');
    const rect = cell.getBoundingClientRect();
    Object.assign(move, { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top, active: false });
    root.setPointerCapture(event.pointerId);
  });

  root.addEventListener('pointermove', event => {
    if (!move) return;
    if (move.mode !== 'pointer') {
      if (grid.contains(event.target)) markTarget(targetAtPointer(event.clientX, event.clientY));
      return;
    }
    if (event.pointerId !== move.pointerId) return;
    move.x = event.clientX;
    move.y = event.clientY;
    if (!move.active && Math.hypot(move.x - move.startX, move.y - move.startY) >= 6) {
      move.active = true;
      animateDrag();
    }
  });
  root.addEventListener('pointerup', event => {
    if (!move || move.mode !== 'pointer' || event.pointerId !== move.pointerId) return;
    if (move.active) {
      markTarget(targetAtPointer(event.clientX, event.clientY));
      finish();
    } else {
      const cell = move.cell;
      cancel();
      start(cell, 'choose');
    }
  });
  // A touch/mouse click completing a drop must not also activate a button under it.
  root.addEventListener('click', event => {
    if (move && grid.contains(event.target)) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  for (const type of ['pointercancel', 'lostpointercapture']) {
    root.addEventListener(type, () => { if (move?.mode === 'pointer') cancel('Move cancelled. Plan unchanged.'); });
  }
  root.addEventListener('keydown', event => {
    const target = event.target.closest('.slot-move, .obstacle-tool');
    if (!target || target.disabled) return;
    const cell = target.matches('.obstacle-tool') ? target : target.closest('.slot-reorderable');
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (move && move.mode !== 'pointer') finish();
      else { cancel(); start(cell, 'keyboard'); }
    } else if (move && move.mode !== 'pointer') {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (event.key === 'Tab') { cancel('Move cancelled. Plan unchanged.'); return; }
      let tile = move.to ?? bounds();
      if (event.key in directions) {
        const [dx, dy] = directions[event.key];
        tile = { column: tile.column + dx, row: tile.row + dy };
      } else if (event.key === 'Home') tile = bounds();
      else if (event.key === 'End') {
        const area = bounds();
        tile = { column: area.column + area.columns - move.size, row: area.row + area.rows - move.size };
      } else return;
      event.preventDefault();
      const area = bounds();
      tile = { column: Math.max(area.column, Math.min(tile.column, area.column + area.columns - move.size)),
        row: Math.max(area.row, Math.min(tile.row, area.row + area.rows - move.size)) };
      markTarget(tile);
      move.preview.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      announce(`${move.name}: ${description(move.destination, move.size)}. ${move.swap
        ? `Swap with ${move.swap.name}. Space to drop.` : move.valid ? 'Fits. Space to drop.' : move.error}`);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !move) return;
    event.preventDefault();
    const source = handle(move.cell);
    cancel('Move cancelled. Plan unchanged.');
    source?.focus({ preventScroll: true });
  });
  window.addEventListener('blur', () => cancel('Move cancelled. Plan unchanged.'));
  return { cancel };
}
