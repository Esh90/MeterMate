import { Router, type Request, type Response } from 'express';
import { adminGuard } from '../auth.js';
import { invoiceSchema } from '../schemas/invoices.js';
import { sessionStore } from '../stores/sessionStore.js';
import { resolveTxn, getTxnChannel } from './txnResolve.js';
import { issueInvoice, MaxioServiceError } from '../services/maxioService.js';
import {
  postMessage,
  buildInvoiceStartedBlocks,
  buildInvoiceIssuedBlocks,
  buildFailureBlocks,
} from '../services/slackService.js';

export const invoicesRouter = Router();

/**
 * UC5 — Invoice Issue + Send (admin only). Guarded by `adminGuard`. Resolves the
 * transaction + channel, posts an in-progress note, creates and issues an ad-hoc
 * invoice (optionally emailing it), reads back the hosted public payment URL, and
 * posts the issued invoice with a "Pay Invoice" button. Slack failures never
 * block the response (plan §6).
 */
invoicesRouter.post('/invoices', adminGuard, async (req: Request, res: Response) => {
  const parsed = invoiceSchema.safeParse(req.body);
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

  await postMessage(channelId, 'Issuing invoice', buildInvoiceStartedBlocks());

  try {
    const invoice = await issueInvoice({
      subscriptionId: txn.subscriptionId,
      clientEmail: txn.clientEmail,
      lineItems: input.lineItems,
      memo: input.memo,
      sendEmail: input.sendEmail,
    });

    await postMessage(
      channelId,
      'Invoice issued',
      buildInvoiceIssuedBlocks({
        number: invoice.number,
        totalAmount: invoice.totalAmount,
        dueAmount: invoice.dueAmount,
        dueDate: invoice.dueDate,
        publicUrl: invoice.publicUrl,
        emailed: invoice.emailed,
      }),
    );

    const payload = { txnId: txn.txnId, channelId, channelName: channel?.name ?? null, invoice };
    session.lastResult = payload;
    sessionStore.put(session);
    return res.json({ status: 'ok', ...payload });
  } catch (err) {
    const message = err instanceof MaxioServiceError ? err.message : `UC5 failed: ${String(err)}`;
    await postMessage(channelId, 'Invoice failed', buildFailureBlocks('Invoice', message));
    return res.status(200).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName: channel?.name ?? null,
      error: message,
    });
  }
});
