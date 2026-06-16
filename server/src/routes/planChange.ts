import { Router, type Request, type Response } from 'express';
import { planChangePreviewSchema, planChangeSchema } from '../schemas/planChange.js';
import { sessionStore } from '../stores/sessionStore.js';
import { resolveTxn, getTxnChannel } from './txnResolve.js';
import { previewPlanChange, applyPlanChange, MaxioServiceError } from '../services/maxioService.js';
import { maxioSubscriptionUrl } from '../maxioClient.js';
import {
  postMessage,
  buildPlanPreviewBlocks,
  buildPlanChangedBlocks,
  buildFailureBlocks,
} from '../services/slackService.js';
import type { TransactionRecord } from '../types.js';

export const planChangeRouter = Router();

/** Resolve + guard the transaction; returns the record or sends an error response. */
function resolveOrRespond(
  input: { txnRef?: string; consultantId?: string; email?: string },
  res: Response,
): TransactionRecord | null {
  const txn = resolveTxn(input);
  if (!txn) {
    res.status(409).json({
      status: 'session_expired',
      message: 'No matching transaction found. Create a subscription (UC1) first, then retry.',
    });
    return null;
  }
  if (txn.subscriptionId == null) {
    res.status(400).json({
      status: 'invalid',
      errors: [{ path: 'txnRef', message: 'transaction has no active subscription' }],
    });
    return null;
  }
  return txn;
}

/**
 * UC3a — preview a plan change. Computes the prorated cost of moving to the
 * target plan and posts the computed delta to the transaction channel. No change
 * is applied.
 */
planChangeRouter.post('/plan-change/preview', async (req: Request, res: Response) => {
  const parsed = planChangePreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const txn = resolveOrRespond(input, res);
  if (!txn || txn.subscriptionId == null) return;

  const session = sessionStore.ensure(input.sessionId);
  session.lastSubmission = input;
  sessionStore.put(session);

  const channel = getTxnChannel(txn);
  const channelId = channel?.id ?? null;

  try {
    const preview = await previewPlanChange({
      subscriptionId: txn.subscriptionId,
      targetHandle: input.targetHandle,
    });

    await postMessage(channelId, 'Plan change preview', buildPlanPreviewBlocks(preview));

    const payload = { txnId: txn.txnId, channelId, channelName: channel?.name ?? null, preview };
    session.lastResult = payload;
    sessionStore.put(session);
    return res.json({ status: 'ok', ...payload });
  } catch (err) {
    const message = err instanceof MaxioServiceError ? err.message : `UC3 preview failed: ${String(err)}`;
    await postMessage(channelId, 'Plan change preview failed', buildFailureBlocks('Plan change preview', message));
    return res.status(200).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName: channel?.name ?? null,
      error: message,
    });
  }
});

/**
 * UC3b — apply a plan change. `prorate` migrates now with proration; `at-renewal`
 * schedules a non-prorated change for the next renewal. Posts old→new + timing to
 * the transaction channel.
 */
planChangeRouter.post('/plan-change', async (req: Request, res: Response) => {
  const parsed = planChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const txn = resolveOrRespond(input, res);
  if (!txn || txn.subscriptionId == null) return;

  const session = sessionStore.ensure(input.sessionId);
  session.lastSubmission = input;
  sessionStore.put(session);

  const channel = getTxnChannel(txn);
  const channelId = channel?.id ?? null;

  try {
    const change = await applyPlanChange({
      subscriptionId: txn.subscriptionId,
      targetHandle: input.targetHandle,
      timing: input.timing,
    });

    await postMessage(
      channelId,
      'Plan changed',
      buildPlanChangedBlocks({
        fromName: change.fromName,
        toName: change.toName,
        timing: change.timing,
        effectiveAt: change.effectiveAt,
        maxioUrl: maxioSubscriptionUrl(txn.subscriptionId),
      }),
    );

    const payload = { txnId: txn.txnId, channelId, channelName: channel?.name ?? null, change };
    session.lastResult = payload;
    sessionStore.put(session);
    return res.json({ status: 'ok', ...payload });
  } catch (err) {
    const message = err instanceof MaxioServiceError ? err.message : `UC3 plan-change failed: ${String(err)}`;
    await postMessage(channelId, 'Plan change failed', buildFailureBlocks('Plan change', message));
    return res.status(200).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName: channel?.name ?? null,
      error: message,
    });
  }
});
