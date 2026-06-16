/**
 * Client-side admin credentials (plan §4.4 — placeholder auth). The hardcoded
 * operator credentials are kept in sessionStorage and sent as HTTP Basic auth on
 * admin-guarded routes. The server is the source of truth: a wrong password is
 * rejected with 401 on the first admin action. Clean seam for real auth later.
 */
const KEY = 'metermate.adminCreds';

interface Creds {
  user: string;
  pass: string;
}

function read(): Creds | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Creds) : null;
  } catch {
    return null;
  }
}

export function setAdminCreds(user: string, pass: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ user, pass }));
  } catch {
    // Ignore storage failures; the header getter falls back to null.
  }
}

export function clearAdminCreds(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}

export function hasAdminCreds(): boolean {
  return read() !== null;
}

/** Returns the `Authorization: Basic …` header value, or null if not logged in. */
export function getAdminAuthHeader(): string | null {
  const creds = read();
  if (!creds) return null;
  return `Basic ${btoa(`${creds.user}:${creds.pass}`)}`;
}
