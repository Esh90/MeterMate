import express, { type Request, type Response, type NextFunction } from 'express';
import { config } from './config.js';
import { metaRouter } from './routes/meta.js';
import { bookRouter } from './routes/book.js';
import { sessionStore } from './stores/sessionStore.js';
import { verifyAuth } from './services/slackService.js';
import { runtimeState } from './state.js';

const app = express();

app.use(express.json());

// --- API routes ---
app.use('/api', metaRouter); // /api/health, /api/consultants
app.use('/api', bookRouter); // UC1 — POST /api/book

// --- 404 for unknown API routes ---
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ status: 'not_found' });
});

// --- Centralized error handler ---
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  console.error('[server] unhandled error:', err);
  res.status(500).json({ status: 'error', message });
});

const server = app.listen(config.PORT, () => {
  console.log(`[server] MeterMate API listening on http://localhost:${config.PORT}`);

  // Live session sweep so idle sessions don't grow memory (plan §4.3).
  sessionStore.startSweeper();

  // Boot Slack auth check (plan §3.1); cached and reported by /api/health.
  verifyAuth()
    .then((status) => {
      runtimeState.slackOk = status.ok;
      console.log(`[server] Slack auth: ${status.ok ? 'ok' : `unavailable (${status.error})`}`);
    })
    .catch(() => {
      runtimeState.slackOk = false;
    });
});

// Graceful shutdown so tsx watch / Ctrl+C don't leak the port.
const shutdown = (signal: string) => {
  console.log(`[server] received ${signal}, shutting down…`);
  sessionStore.stopSweeper();
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app };
