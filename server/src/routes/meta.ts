import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { CONSULTANTS } from '../constants.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { runtimeState } from '../state.js';

export const metaRouter = Router();

/**
 * Health/liveness (plan §4.5). Keeps the Phase 0 `{ status: 'ok' }` contract and
 * extends it with live counts, the Maxio site, and the cached boot Slack check.
 */
metaRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    sessions: sessionStore.size(),
    transactions: transactionStore.size(),
    maxioSite: config.MAXIO_SITE_SUBDOMAIN,
    slackOk: runtimeState.slackOk,
  });
});

/** Seeded consultant dropdown (plan §4.5). The consultant is a transaction label. */
metaRouter.get('/consultants', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    consultants: CONSULTANTS.map((c) => ({ id: c.id, name: c.name })),
  });
});
