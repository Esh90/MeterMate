import { Router, type Request, type Response } from 'express';
import { lifecycleSchema } from '../schemas/lifecycle.js';
import { sessionStore } from '../stores/sessionStore.js';
import { resolveTxn, getTxnChannel } from './txnResolve.js';
import { lifecycleAction, MaxioServiceError } from '../services/maxioService.js';
import {
  postMessage,
  buildLifecycleStartedBlocks,
  buildLifecycleDoneBlocks,
  buildFailureBlocks,
} from '../services/slackService.js';

export const lifecycleRouter = Router();

/**
 * UC4 — Lifecycle Control. One route, four actions (pause/resume/cancel/
 * reactivate). Resolves the existing transaction + channel, posts an in-progress
 * note, dispatches to the matching Maxio status operation, and posts the
 * resulting state transition. Slack failures never block the response (plan §6).
 */
lifecycleRouter.post('/lifecycle', async (req: Request, res: Response) => {
  const parsed = lifecycleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  const txn = resolveTxn(input);
  if (!txn) {
    return res.status(409).json({
      status: 'session_expired',
      message: 'No matching transaction found. Create a subscription (UC1) first, then retry.',
    });
  }
  if (txn.subscriptionId == null) {
    return res.status(400).json({
      status: 'invalid',
      errors: [{ path: 'txnRef', message: 'transaction has no active subscription' }],
    });
  }

  const session = sessionStore.ensure(input.sessionId);
  session.lastSubmission = input;
  sessionStore.put(session);

  const channel = getTxnChannel(txn);
  const channelId = channel?.id ?? null;

  await postMessage(channelId, `${input.action} in progress`, buildLifecycleStartedBlocks(input.action));

  try {
    const result = await lifecycleAction({
      subscriptionId: txn.subscriptionId,
      action: input.action,
      cancelType: input.cancelType,
      reasonCode: input.reasonCode,
    });

    await postMessage(
      channelId,
      `${result.previousState} → ${result.newState}`,
      buildLifecycleDoneBlocks({
        action: result.action,
        previousState: result.previousState,
        newState: result.newState,
        effectiveAt: result.effectiveAt,
        reasonCode: result.reasonCode,
        note: result.note,
      }),
    );

    const payload = { txnId: txn.txnId, channelId, channelName: channel?.name ?? null, lifecycle: result };
    session.lastResult = payload;
    sessionStore.put(session);
    return res.json({ status: 'ok', ...payload });
  } catch (err) {
    const message = err instanceof MaxioServiceError ? err.message : `UC4 failed: ${String(err)}`;
    await postMessage(channelId, 'Lifecycle action failed', buildFailureBlocks('Lifecycle', message));
    return res.status(200).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName: channel?.name ?? null,
      error: message,
    });
  }
});
