/**
 * Client-side session id handling. A stable id is generated once and persisted
 * in localStorage so multi-step flows (and idempotent re-submits) reuse the same
 * server-side session (plan §4.3).
 */
const STORAGE_KEY = 'metermate.sessionId';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSessionId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

/** Start a fresh session (used after expiry or on an explicit reset). */
export function resetSessionId(): string {
  const id = randomId();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}
