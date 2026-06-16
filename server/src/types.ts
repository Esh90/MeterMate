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

/** A resolved Maxio component from the live catalog cache (UC2). */
export interface ComponentInfo {
  id: number;
  handle: string;
  name: string;
  /** Maxio component kind, e.g. "metered_component" | "event_based_component". */
  kind: string;
}

/** Normalized result of recording usage (UC2). */
export interface UsageResult {
  componentHandle: string;
  componentName: string;
  /** How the usage was recorded: 'metered' (quantity) or 'event'. */
  recordedAs: 'metered' | 'event';
  quantity: number;
  /** Running total for the current period from usage history; null for events. */
  periodTotal: number | null;
  unitName: string;
  memo: string | null;
  accruesToNextInvoice: true;
}

/** Proration preview for a plan change (UC3). All amounts in cents. */
export interface PlanChangePreview {
  fromHandle: string;
  fromName: string;
  toHandle: string;
  toName: string;
  proratedAdjustmentInCents: number;
  chargeInCents: number;
  creditAppliedInCents: number;
  /** Net amount due now for an upgrade (0 for downgrades/credits). */
  paymentDueInCents: number;
}

/** Result of applying a plan change (UC3). */
export interface PlanChangeResult {
  fromHandle: string;
  fromName: string;
  toHandle: string;
  toName: string;
  timing: 'prorate' | 'at-renewal';
  /** When the change takes effect (now for prorate; next renewal for at-renewal). */
  effectiveAt: string | null;
  state: string;
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
