import { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { bookSchema } from '../schemas/book.js';
import { findConsultant } from '../constants.js';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { createSubscription, MaxioServiceError } from '../services/maxioService.js';
import { maxioSubscriptionUrl } from '../maxioClient.js';
import {
  ensureTxnChannel,
  postMessage,
  buildTxnStartedBlocks,
  buildBookingStartedBlocks,
  buildSubscriptionActiveBlocks,
  buildFailureBlocks,
  buildEmailFallbackNoteBlocks,
} from '../services/slackService.js';
import { emailSlug } from '../util.js';
import type { SubscriptionResult } from '../types.js';

export const bookRouter = Router();

/**
 * UC1 — Book & Subscribe. Core loop (plan §1.5): validate → store → ensure the
 * transaction's private channel → post "started" → drive the Maxio subscription
 * → post completion/failure. Slack failures never block the HTTP response
 * (plan §6); the billing result is the source of truth.
 */
bookRouter.post('/book', async (req: Request, res: Response) => {
  // 1. Validate (AC-18) — no external calls before this passes.
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  // 2. Resolve consultant (seeded label on the transaction).
  const consultant = findConsultant(input.consultantId);
  if (!consultant) {
    return res.status(400).json({
      status: 'invalid',
      errors: [{ path: 'consultantId', message: `unknown consultant '${input.consultantId}'` }],
    });
  }

  const session = sessionStore.ensure(input.sessionId);

  // 3. Session-scoped idempotency (AC-07): an identical resubmission within the
  // same session returns the cached result instead of creating a duplicate.
  const idemKey = createHash('sha256')
    .update([input.email, input.consultantId, input.productHandle, input.collectionMethod].join('|'))
    .digest('hex');
  const cached = session.idempotency[idemKey] as
    | { txnId: string; channelId: string | null; channelName: string | null; subscription: SubscriptionResult }
    | undefined;
  if (cached) {
    return res.json({ status: 'ok', idempotent: true, ...cached });
  }

  // 4. Create the transaction record and store the submission.
  const txn = transactionStore.create({
    consultantId: consultant.id,
    clientEmail: input.email,
    type: 'subscription',
  });
  session.lastSubmission = input;
  sessionStore.put(session);

  // 5. Ensure the private channel (reuse if the pair already has one).
  const existing = transactionStore.getChannelForPair(consultant.id, input.email);
  const channelResult = await ensureTxnChannel({
    consultantSlug: consultant.slug,
    consultantSlackEmail: consultant.slackEmail,
    clientEmail: input.email,
    clientSlug: emailSlug(input.email),
    channelSeq: transactionStore.nextSeq(),
    existing,
  });
  if (channelResult.channel) {
    transactionStore.update(txn.txnId, {
      channelId: channelResult.channel.id,
      channelName: channelResult.channel.name,
    });
    if (!existing) {
      transactionStore.setChannelForPair(consultant.id, input.email, channelResult.channel);
    }
  }
  const channelId = channelResult.channel?.id ?? null;

  // 6. Post "started" messages (best-effort).
  if (!channelResult.reused) {
    await postMessage(
      channelId,
      'Transaction started',
      buildTxnStartedBlocks({
        consultantName: consultant.name,
        clientEmail: input.email,
        type: 'Book & Subscribe',
      }),
    );
    if (channelResult.clientNotifiedByEmail) {
      await postMessage(channelId, 'Client notified by email', buildEmailFallbackNoteBlocks());
    }
  }
  await postMessage(channelId, 'Booking started', buildBookingStartedBlocks(input.productHandle));

  // 7. Drive the Maxio subscription.
  try {
    const result = await createSubscription({
      productHandle: input.productHandle,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      collectionMethod: input.collectionMethod,
      couponCode: input.couponCode,
    });

    transactionStore.update(txn.txnId, {
      state: 'completed',
      subscriptionId: result.subscriptionId,
      customerId: result.customerId,
    });

    await postMessage(
      channelId,
      'Subscription active',
      buildSubscriptionActiveBlocks({
        result,
        customerName: `${input.firstName} ${input.lastName}`,
        maxioUrl: maxioSubscriptionUrl(result.subscriptionId),
      }),
    );

    const payload = {
      txnId: txn.txnId,
      channelId,
      channelName: channelResult.channel?.name ?? null,
      subscription: result,
    };
    session.idempotency[idemKey] = payload;
    session.lastResult = payload;
    sessionStore.put(session);

    return res.json({
      status: 'ok',
      ...payload,
      channel: {
        created: Boolean(channelResult.channel) && !channelResult.reused,
        reused: channelResult.reused,
        consultantInvited: channelResult.consultantInvited,
        clientInvited: channelResult.clientInvited,
        clientNotifiedByEmail: channelResult.clientNotifiedByEmail,
        notes: channelResult.notes,
      },
    });
  } catch (err) {
    const message = err instanceof MaxioServiceError ? err.message : `UC1 failed: ${String(err)}`;
    transactionStore.update(txn.txnId, { state: 'failed', lastError: message });
    await postMessage(channelId, 'Booking failed', buildFailureBlocks('Booking', message));

    return res.status(200).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName: channelResult.channel?.name ?? null,
      error: message,
    });
  }
});
