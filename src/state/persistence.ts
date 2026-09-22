import type { AppState } from '../domain/types';

const STORAGE_KEY = 'storedraft:state:v1';

export interface Persisted {
  state: AppState;
  savedAt: number;
}

export function saveState(state: AppState, now: number, storage: Storage = localStorage): void {
  const payload: Persisted = { state, savedAt: now };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadState(storage: Storage = localStorage): Persisted | undefined {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || !parsed.state || !Array.isArray(parsed.state.versions)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function clearState(storage: Storage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
