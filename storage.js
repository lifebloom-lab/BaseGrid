import { restoreSession, serializeSession, normalizePlannedObstacles } from './placement.js';
import { normalizeImportedPlayer, normalizeRosterContext } from './players.js';
import { normalizeFreeLayout } from './free-formation.js';
import { normalizeGridLayout } from './grid-layout.js';
import { normalizeTilePlacements } from './tile-placement.js';

export const STORAGE_KEY = 'basegrid.workspace.v1';
export const DEFAULT_DRAFT = { names: '', x: '412', y: '687', spacing: '1' };

export function saveWorkspace(storage, draft, session) {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1, draft, session: session ? serializeSession(session) : null,
  }));
}

export function loadWorkspace(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { draft: { ...DEFAULT_DRAFT }, session: null };
  const saved = JSON.parse(raw);
  if (!saved || saved.version !== 1 || !saved.draft ||
      !Object.keys(DEFAULT_DRAFT).every(key => typeof saved.draft[key] === 'string')) {
    throw new Error('The saved workspace is invalid.');
  }
  const imported = saved.draft.importedPlayers;
  if (imported !== undefined && (!Array.isArray(imported) || imported.some(player =>
    !player || typeof player.name !== 'string' || !player.name.trim() ||
    typeof player.id !== 'string' || !player.id.startsWith('lastwar:')) ||
    new Set(imported.map(player => player.id)).size !== imported.length)) {
    throw new Error('The saved imported roster is invalid.');
  }
  const ordered = saved.draft.orderedPlayers;
  if (ordered !== undefined && (!Array.isArray(ordered) || ordered.some(player =>
    !player || typeof player.name !== 'string' || !player.name.trim() ||
    typeof player.id !== 'string' || !player.id.trim()) ||
    new Set(ordered.map(player => player.id)).size !== ordered.length)) {
    throw new Error('The saved player order is invalid.');
  }
  // Upgrade earlier imports that retained rank/HQ metadata without a group field.
  const draft = { ...saved.draft };
  if (draft.tilePlacements !== undefined) draft.tilePlacements = normalizeTilePlacements(draft.tilePlacements);
  if (draft.selectedPlayerId !== undefined && typeof draft.selectedPlayerId !== 'string') draft.selectedPlayerId = null;
  if (draft.layout !== undefined) draft.layout = draft.layout?.version === undefined
    ? normalizeFreeLayout(draft.layout) : normalizeGridLayout(draft.layout);
  if (draft.rosterContext !== undefined) draft.rosterContext = normalizeRosterContext(draft.rosterContext);
  if (draft.plannedObstacles !== undefined) draft.plannedObstacles = normalizePlannedObstacles(draft.plannedObstacles);
  if (imported) draft.importedPlayers = imported.map(normalizeImportedPlayer);
  if (ordered) draft.orderedPlayers = ordered.map(player =>
    player.id.startsWith('lastwar:') ? normalizeImportedPlayer(player) : player);
  const session = saved.session === null ? null : restoreSession(saved.session);
  if (session) session.players = session.players.map(player =>
    player.id.startsWith('lastwar:') ? normalizeImportedPlayer(player) : player);
  return { draft, session };
}

export function clearWorkspace(storage) {
  storage.removeItem(STORAGE_KEY);
}
