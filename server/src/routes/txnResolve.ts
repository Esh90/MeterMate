import { transactionStore } from '../stores/transactionStore.js';
import type { ChannelInfo, TransactionRecord } from '../types.js';

/**
 * Resolve an existing transaction from a request: by `txnRef` (a txnId), else by
 * the consultant+client pair. Returns the most recent completed subscription
 * transaction for the pair. Shared by UCs that act on an existing transaction.
 */
export function resolveTxn(input: {
  txnRef?: string | undefined;
  consultantId?: string | undefined;
  email?: string | undefined;
}): TransactionRecord | null {
  if (input.txnRef) {
    return transactionStore.get(input.txnRef);
  }
  if (input.consultantId && input.email) {
    return transactionStore.findLatestSubscriptionForPair(input.consultantId, input.email);
  }
  return null;
}

/** Resolve the private channel for a transaction (its own, else the pair's). */
export function getTxnChannel(txn: TransactionRecord): ChannelInfo | null {
  if (txn.channelId) return { id: txn.channelId, name: txn.channelName ?? '' };
  return transactionStore.getChannelForPair(txn.consultantId, txn.clientEmail);
}
