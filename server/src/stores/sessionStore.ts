import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { SessionData } from '../types.js';

/**
 * Live, in-memory session store (plan §4.3). Holds the current submission, the
 * last result, and a per-session idempotency cache so multi-step flows work
 * without re-sending everything. A TTL sweep clears idle sessions so memory does
 * not grow unbounded. DB-ready: the get/put/delete/sweep surface is the only
 * thing routes depend on — swapping to Redis/Postgres is a per-file change.
 */
class SessionStore {
  private readonly sessions = new Map<string, SessionData>();
  private readonly ttlMs = config.SESSION_TTL_MINUTES * 60_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  /** Returns a live session, or null if absent/expired. Touches on read. */
  get(sessionId: string): SessionData | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (this.isExpired(s)) {
      this.sessions.delete(sessionId);
      return null;
    }
    s.updatedAt = Date.now();
    return s;
  }

  /** Get the session for an id, creating it if missing (used at flow entry). */
  ensure(sessionId?: string): SessionData {
    const id = sessionId && sessionId.trim() ? sessionId.trim() : randomUUID();
    const existing = this.get(id);
    if (existing) return existing;
    const now = Date.now();
    const fresh: SessionData = {
      sessionId: id,
      lastSubmission: null,
      lastResult: null,
      idempotency: {},
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, fresh);
    return fresh;
  }

  put(session: SessionData): void {
    session.updatedAt = Date.now();
    this.sessions.set(session.sessionId, session);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  size(): number {
    return this.sessions.size;
  }

  /** Remove all expired sessions; returns the number swept. */
  sweep(): number {
    let removed = 0;
    for (const [id, s] of this.sessions) {
      if (this.isExpired(s)) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Start the periodic sweep. Unref'd so it never keeps the process alive. */
  startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), this.ttlMs).unref();
  }

  stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private isExpired(s: SessionData): boolean {
    return Date.now() - s.updatedAt > this.ttlMs;
  }
}

export const sessionStore = new SessionStore();
