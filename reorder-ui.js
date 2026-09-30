import { tileKey } from './free-formation.js';

/** Preview-only positioning with mouse/touch dragging and a keyboard equivalent. */
export function setupFormationReorder({ grid, map, obstacleTool, onDrop, announce }) {
  const root = grid.closest('.formation-panel');
  let move = null;
  let animation = null;

  const cells = () => [...grid.querySelectorAll('.slot-reorderable')];
  const tileOf = cell => ({ column: Number(cell.dataset.column), row: Number(cell.dataset.row) });
  const cellAt = tile => tile && cells().find(cell => cell.dataset.tile === tileKey(tile));
  const handleAt = tile => cellAt(tile)?.querySelector('.slot-move, .slot-drop');
  const sourceHandle = cell => cell === obstacleTool ? obstacleTool : cell.querySelector('.slot-move');
  const canDrop = cell => cell && ['player', 'empty'].includes(cell.dataset.kind);
  const destinations = () => cells().filter(canDrop);
  const sameTile = (a, b) => a && b && tileKey(a) === tileKey(b);
  const description = tile => { const cell = cellAt(tile); return cell ? `X ${cell.dataset.x}, Y ${cell.dataset.y}` : 'outside the map'; };

  function markTarget(tile) {
    move.to = tile;
    for (const cell of cells()) {
      cell.classList.toggle('is-drop-target', sameTile(tileOf(cell), tile) && !sameTile(tile, move.from));
    }
  }

  function start(cell, mode) {
    const from = cell === obstacleTool ? null : tileOf(cell);
    const kind = cell === obstacleTool ? 'new-obstacle' : cell.dataset.kind;
    move = { mode, from, to: from ?? (destinations()[0] ? tileOf(destinations()[0]) : null), kind,
      name: kind === 'player' ? cell.querySelector('.slot-name').textContent : 'Obstacle', cell };
    cell.classList.add('is-drag-source');
    sourceHandle(cell).setAttribute('aria-pressed', 'true');
    if (mode !== 'pointer') {
      markTarget(move.to);
      announce(`${kind === 'new-obstacle' ? 'Adding' : 'Moving'} ${move.name}. Choose an open tile; press Escape to cancel.`);
    }
  }

  function cancel(message = '') {
    if (!move) return;
    const pointerId = move.pointerId;
    move.ghost?.remove();
    for (const cell of cells()) {
      cell.classList.remove('is-drag-source', 'is-drop-target');
      cell.querySelector('.slot-move')?.setAttribute('aria-pressed', 'false');
    }
    obstacleTool.classList.remove('is-drag-source');
    obstacleTool.setAttribute('aria-pressed', 'false');
    move = null;
    if (pointerId !== undefined && root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
    cancelAnimationFrame(animation);
    animation = null;
    if (message) announce(message);
  }

  function finish() {
    const { from, to, name, kind } = move;
    const destination = description(to);
    cancel();
    if (to !== null && !sameTile(from, to)) {
      if (onDrop(kind, from, to) !== false) announce(`${name} ${kind === 'new-obstacle' ? 'added' : 'moved'} to ${destination}. Plan updated.`);
      else announce('That move could not be saved. Plan unchanged.');
    } else announce('Plan unchanged.');
    const handle = handleAt(to ?? from);
    (handle ?? obstacleTool).focus({ preventScroll: true });
  }

  function targetAtPointer() {
    const bounds = map.getBoundingClientRect();
    if (move.x < bounds.left || move.x > bounds.right || move.y < bounds.top || move.y > bounds.bottom) return null;
    const target = document.elementFromPoint(move.x, move.y)?.closest('.slot-reorderable');
    return target && grid.contains(target) && canDrop(target) ? tileOf(target) : null;
  }

  function animateDrag() {
    if (!move || move.mode !== 'pointer' || !move.active) return;
    const bounds = map.getBoundingClientRect();
    // Scroll wide/tall formations without changing which slot the pointer targets.
    const speed = (position, low, high) => position < low + 38 ? -12 : position > high - 38 ? 12 : 0;
    if (move.x >= bounds.left && move.x <= bounds.right && move.y >= bounds.top && move.y <= bounds.bottom) {
      map.scrollBy(speed(move.x, bounds.left, bounds.right), speed(move.y, bounds.top, bounds.bottom));
    }
    move.ghost.style.transform = `translate(${move.x - move.offsetX}px, ${move.y - move.offsetY}px)`;
    markTarget(targetAtPointer());
    animation = requestAnimationFrame(animateDrag);
  }

  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (event.target.closest('.obstacle-remove')) return;
    const cell = event.target.closest('.slot-reorderable, #add-obstacle');
    if (!cell || cell.disabled) return;
    if (move && move.mode !== 'pointer') {
      if (cell === obstacleTool) { cancel('Move cancelled. Plan unchanged.'); return; }
      if (canDrop(cell)) {
        event.preventDefault();
        markTarget(tileOf(cell));
        finish();
        return;
      }
    }
    if (cell.dataset.kind === 'empty') return;
    if (event.pointerType === 'touch' && cell !== obstacleTool && !event.target.closest('.slot-move')) return;
    cancel();
    // Touch scrolling remains available on the rest of each card.
    if (event.pointerType === 'mouse') event.preventDefault();
    start(cell, 'pointer');
    Object.assign(move, { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, active: false });
    root.setPointerCapture(event.pointerId);
  });

  root.addEventListener('pointermove', event => {
    if (!move || move.mode !== 'pointer' || event.pointerId !== move.pointerId) return;
    move.x = event.clientX;
    move.y = event.clientY;
    if (!move.active && Math.hypot(move.x - move.startX, move.y - move.startY) >= 6) {
      move.active = true;
      const bounds = move.cell.getBoundingClientRect();
      move.offsetX = move.startX - bounds.left;
      move.offsetY = move.startY - bounds.top;
      const ghost = move.cell.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.className = `slot drag-ghost ${move.kind === 'player' ? '' : 'blocked'}`;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      ghost.style.width = `${bounds.width}px`;
      ghost.style.height = `${bounds.height}px`;
      ghost.style.minHeight = '0';
      move.ghost = ghost;
      document.body.append(ghost);
      animateDrag();
    }
  });

  root.addEventListener('pointerup', event => {
    if (!move || move.mode !== 'pointer' || event.pointerId !== move.pointerId) return;
    if (move.active) {
      move.x = event.clientX;
      move.y = event.clientY;
      markTarget(targetAtPointer());
      finish();
    } else {
      const { from, cell } = move;
      cancel();
      if (cell === obstacleTool) start(obstacleTool, 'choose');
      (handleAt(from) ?? obstacleTool).focus({ preventScroll: true });
    }
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    root.addEventListener(type, () => { if (move?.mode === 'pointer') cancel('Move cancelled. Plan unchanged.'); });
  }

  root.addEventListener('keydown', event => {
    const handle = event.target.closest('.slot-move, .slot-drop, #add-obstacle');
    if (!handle) return;
    const cell = handle === obstacleTool ? obstacleTool : handle.closest('.slot-reorderable');
    if (!cell || cell.disabled) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (move && move.mode !== 'pointer') {
        if (cell.dataset.kind === 'empty') markTarget(tileOf(cell));
        finish();
      } else if (cell.dataset.kind === 'empty') announce('Pick up a player or the Obstacle button first, then choose this tile.');
      else { cancel(); start(cell, 'keyboard'); }
    } else if (move && move.mode !== 'pointer') {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      let target;
      if (event.key in directions && move.to) {
        const [dx, dy] = directions[event.key];
        target = cellAt({ column: move.to.column + dx, row: move.to.row + dy });
      } else if (event.key === 'Home') target = destinations()[0];
      else if (event.key === 'End') target = destinations().at(-1);
      else if (event.key === 'Tab') { cancel('Move cancelled. Plan unchanged.'); return; }
      else return;
      event.preventDefault();
      if (!canDrop(target) && !sameTile(target && tileOf(target), move.from)) {
        announce(target ? 'That tile contains an obstacle. Choose another tile.' : 'Map edge. Drop here, or cancel and use More space to extend the map.');
        return;
      }
      markTarget(tileOf(target));
      cellAt(move.to)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      announce(`${move.name}: ${description(move.to)}. Press Space to drop, or Escape to cancel.`);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !move) return;
    event.preventDefault();
    const from = move.from;
    cancel('Move cancelled. Plan unchanged.');
    (handleAt(from) ?? obstacleTool).focus({ preventScroll: true });
  });
  window.addEventListener('blur', () => cancel('Move cancelled. Plan unchanged.'));
  return { cancel };
}
