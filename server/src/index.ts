import express, { type Request, type Response, type NextFunction } from 'express';
import { config } from './config.js';

const app = express();

app.use(express.json());

// --- Health (Phase 0) ---
// Minimal contract for now; later phases extend it with session/transaction
// counts, the Maxio site, and a Slack auth check (see plan §4.5).
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// --- 404 for unknown API routes ---
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ status: 'not_found' });
});

// --- Centralized error handler ---
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  console.error('[server] unhandled error:', err);
  res.status(500).json({ status: 'error', message });
});

const server = app.listen(config.PORT, () => {
  console.log(`[server] MeterMate API listening on http://localhost:${config.PORT}`);
});

// Graceful shutdown so tsx watch / Ctrl+C don't leak the port.
const shutdown = (signal: string) => {
  console.log(`[server] received ${signal}, shutting down…`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app };
