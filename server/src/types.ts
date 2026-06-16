/**
 * Shared domain types for MeterMate. Kept free of any SDK imports so they can be
 * reused by services, routes, stores, and (eventually) the test suite.
 */

/** Discriminated status returned by every mutating route (plan §4.5). */
export type ApiStatus = 'ok' | 'maxio_failed' | 'invalid' | 'session_expired';

/** Payment collection method exposed at the frontend (plan UC1). */
export type CollectionMethodInput = 'automatic' | 'remittance';

/** A seeded consultant. `slackEmail` is null when no workspace email is configured. */
export interface Consultant {
  readonly id: string;
  readonly name: string;
  /** Sanitized slug used in channel names. */
  readonly slug: string;
  /** Workspace email used to resolve the consultant's Slack user id, or null. */
  readonly slackEmail: string | null;
}

export type TransactionType =
  | 'subscription'
  | 'usage'
  | 'plan_change'
  | 'lifecycle'
  | 'invoice';

export type TransactionState = 'started' | 'in_progress' | 'completed' | 'failed';

/** A single consultant↔client transaction. */
export interface TransactionRecord {
  txnId: string;
  consultantId: string;
  clientEmail: string;
  type: TransactionType;
  state: TransactionState;
  channelId: string | null;
  channelName: string | null;
  /** Maxio identifiers, populated once billing succeeds. */
  subscriptionId: number | null;
  customerId: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

/** The private Slack channel bound to a (consultant, client) pair. */
export interface ChannelInfo {
  id: string;
  name: string;
}

/** Per-session scratch space: last submission + last result for multi-step flows. */
export interface SessionData {
  sessionId: string;
  lastSubmission: unknown;
  lastResult: unknown;
  /** Signature → cached successful result, for session-scoped idempotency. */
  idempotency: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** Normalized result of a successful subscription creation (UC1). */
export interface SubscriptionResult {
  subscriptionId: number;
  customerId: number | null;
  state: string;
  productHandle: string;
  productName: string;
  /** Recurring plan price in cents = MRR for a flat monthly plan. */
  mrrInCents: number;
  currency: string;
  nextAssessmentAt: string | null;
  currentPeriodEndsAt: string | null;
  couponCode: string | null;
}
