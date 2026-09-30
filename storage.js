import { restoreSession, serializeSession } from './placement.js';

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
  return {
    draft: saved.draft,
    session: saved.session === null ? null : restoreSession(saved.session),
  };
}

export function clearWorkspace(storage) {
  storage.removeItem(STORAGE_KEY);
}
