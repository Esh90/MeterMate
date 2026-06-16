import { Router, type Request, type Response } from 'express';
import { usageSchema } from '../schemas/usage.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { recordUsage, MaxioServiceError } from '../services/maxioService.js';
import {
  postMessage,
  buildUsageStartedBlocks,
  buildUsageRecordedBlocks,
  buildFailureBlocks,
} from '../services/slackService.js';
import type { TransactionRecord } from '../types.js';

export const usageRouter = Router();

/**
 * UC2 — Report Session Usage. Resolves the existing transaction (and its private
 * channel), posts "recording usage…", records the usage against the component
 * (dispatched on kind by maxioService), then posts the completion with the
 * running period total. Slack failures never block the response (plan §6).
 */
usageRouter.post('/usage', async (req: Request, res: Response) => {
  const parsed = usageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  // Resolve the existing transaction (by txnRef, else by consultant+client pair).
  let txn: TransactionRecord | null = null;
  if (input.txnRef) {
    txn = transactionStore.get(input.txnRef);
  } else if (input.consultantId && input.email) {
    txn = transactionStore.findLatestSubscriptionForPair(input.consultantId, input.email);
  }
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

  // Reuse the pair's existing channel (UC2 never creates a new one).
  const channel =
    (txn.channelId ? { id: txn.channelId, name: txn.channelName ?? '' } : null) ??
    transactionStore.getChannelForPair(txn.consultantId, txn.clientEmail);
  const channelId = channel?.id ?? null;

  await postMessage(channelId, 'Recording usage', buildUsageStartedBlocks(input.componentHandle));

  try {
    const usage = await recordUsage({
      subscriptionId: txn.subscriptionId,
      componentHandle: input.componentHandle,
      quantity: input.quantity,
      memo: input.memo,
      timestamp: input.timestamp,
    });

    await postMessage(
      channelId,
      'Usage recorded',
      buildUsageRecordedBlocks({
        componentName: usage.componentName,
        quantity: usage.quantity,
        unitName: usage.unitName,
        periodTotal: usage.periodTotal,
        recordedAs: usage.recordedAs,
      }),
    );

    const payload = { txnId: txn.txnId, channelId, channelName: channel?.name ?? null, usage };
    session.lastResult = payload;
    sessionStore.put(session);

    return res.json({ status: 'ok', ...payload });
  } catch (err) {
    const message = err instanceof MaxioServiceError ? err.message : `UC2 failed: ${String(err)}`;
    transactionStore.update(txn.txnId, { lastError: message });
    await postMessage(channelId, 'Usage failed', buildFailureBlocks('Usage', message));

    return res.status(200).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName: channel?.name ?? null,
      error: message,
    });
  }
});
