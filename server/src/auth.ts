import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

/**
 * Hardcoded admin identity (plan §4.4) — explicitly a placeholder for real auth.
 * Admin routes (UC5/UC6) require HTTP Basic credentials matching ADMIN_USER /
 * ADMIN_PASSWORD. This is a clean seam: swapping to OAuth/JWT means replacing
 * `adminGuard` only. Comparisons are timing-safe.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep !== -1) {
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      // Evaluate both comparisons regardless to avoid short-circuit timing leaks.
      const userOk = safeEqual(user, config.ADMIN_USER);
      const passOk = safeEqual(pass, config.ADMIN_PASSWORD);
      if (userOk && passOk) {
        next();
        return;
      }
    }
  }
  // Deliberately NOT setting `WWW-Authenticate: Basic` here: that header makes
  // browsers pop their native HTTP-auth dialog on a 401, hijacking our React
  // login flow. Omitting it lets the SPA handle the 401 inline. (Standard for
  // XHR/JSON endpoints.)
  res.status(401).json({ status: 'unauthorized', message: 'Admin credentials required.' });
}
