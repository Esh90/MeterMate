import { randomUUID } from 'node:crypto';
import { pairKey } from '../util.js';
import type { ChannelInfo, TransactionRecord, TransactionType } from '../types.js';

/**
 * Live, in-memory transaction store (plan §4.3). Holds transaction state plus
 * the `(consultant, client) → channel` map that powers channel reuse: the first
 * action for a pair creates the private channel; later actions reuse it.
 * DB-ready behind a small get/put/update surface.
 */
class TransactionStore {
  private readonly txns = new Map<string, TransactionRecord>();
  private readonly channelByPair = new Map<string, ChannelInfo>();
  private seq = 0;

  /** Monotonic sequence used to keep generated channel names unique. */
  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  create(input: {
    consultantId: string;
    clientEmail: string;
    type: TransactionType;
  }): TransactionRecord {
    const now = Date.now();
    const txn: TransactionRecord = {
      txnId: randomUUID(),
      consultantId: input.consultantId,
      clientEmail: input.clientEmail.trim().toLowerCase(),
      type: input.type,
      state: 'started',
      channelId: null,
      channelName: null,
      subscriptionId: null,
      customerId: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.txns.set(txn.txnId, txn);
    return txn;
  }

  get(txnId: string): TransactionRecord | null {
    return this.txns.get(txnId) ?? null;
  }

  update(txnId: string, patch: Partial<TransactionRecord>): TransactionRecord | null {
    const txn = this.txns.get(txnId);
    if (!txn) return null;
    Object.assign(txn, patch, { updatedAt: Date.now() });
    return txn;
  }

  /** Look up the existing channel for a pair, or null. */
  getChannelForPair(consultantId: string, clientEmail: string): ChannelInfo | null {
    return this.channelByPair.get(pairKey(consultantId, clientEmail)) ?? null;
  }

  /** Bind a channel to a pair so subsequent actions reuse it. */
  setChannelForPair(consultantId: string, clientEmail: string, channel: ChannelInfo): void {
    this.channelByPair.set(pairKey(consultantId, clientEmail), channel);
  }

  list(): TransactionRecord[] {
    return [...this.txns.values()];
  }

  size(): number {
    return this.txns.size;
  }
}

export const transactionStore = new TransactionStore();
