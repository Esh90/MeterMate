/**
 * Remembers the most recent successful booking so the usage form can pre-fill
 * its transaction reference. Persisted in localStorage; purely a UX convenience.
 */
const KEY = 'metermate.lastTxn';

export interface LastTxn {
  txnId: string;
  channelName: string | null;
}

export function setLastTxn(txn: LastTxn): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(txn));
  } catch {
    // Ignore storage failures (e.g. private mode); the form still works.
  }
}

export function getLastTxn(): LastTxn | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LastTxn) : null;
  } catch {
    return null;
  }
}
