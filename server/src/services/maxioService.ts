import {
  ApiError,
  CollectionMethod,
  CreateInvoiceStatus,
  InvoiceStatus,
} from '@maxio-com/advanced-billing-sdk';
import {
  getSubscriptionsController,
  getSubscriptionComponentsController,
  getSubscriptionProductsController,
  getSubscriptionStatusController,
  getInvoicesController,
  getEventsController,
} from '../maxioClient.js';
import { centsToNumber } from '../util.js';
import { findComponentMeta, findPlan, findConsultant } from '../constants.js';
import { transactionStore } from '../stores/transactionStore.js';
import type {
  CancelType,
  CollectionMethodInput,
  DigestResult,
  InvoiceLineItemInput,
  InvoiceResult,
  LifecycleAction,
  LifecycleResult,
  PlanChangePreview,
  PlanChangeResult,
  SubscriptionResult,
  UsageResult,
} from '../types.js';

/**
 * Typed error thrown by maxioService. Carries an HTTP-ish status code and a
 * human-readable summary so routes can translate it into the `maxio_failed`
 * response shape and post a failure block to Slack.
 */
export class MaxioServiceError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'MaxioServiceError';
    this.statusCode = statusCode;
  }
}

/** Normalize any thrown value (ApiError or otherwise) into a MaxioServiceError. */
function toServiceError(err: unknown, context: string): MaxioServiceError {
  if (err instanceof ApiError) {
    const result = err.result as { errors?: unknown; error?: unknown } | undefined;
    let detail: string | undefined;
    if (result && Array.isArray(result.errors)) {
      detail = result.errors.map((e) => String(e)).join('; ');
    } else if (result && typeof result.error === 'string') {
      detail = result.error;
    } else if (typeof err.body === 'string' && err.body.trim()) {
      detail = err.body.trim();
    }
    const message = detail
      ? `${context}: ${detail} (HTTP ${err.statusCode})`
      : `${context}: Maxio request failed (HTTP ${err.statusCode})`;
    return new MaxioServiceError(message, err.statusCode);
  }
  if (err instanceof Error) {
    return new MaxioServiceError(`${context}: ${err.message}`);
  }
  return new MaxioServiceError(`${context}: ${String(err)}`);
}

const COLLECTION_METHOD: Record<CollectionMethodInput, CollectionMethod> = {
  automatic: CollectionMethod.Automatic,
  remittance: CollectionMethod.Remittance,
};

/** Component kinds whose usage is recorded as a quantity via createUsage. */
const QUANTITY_KINDS = new Set([
  'metered_component',
  'quantity_based_component',
  'prepaid_usage_component',
]);

export interface CreateSubscriptionInput {
  productHandle: string;
  firstName: string;
  lastName: string;
  email: string;
  collectionMethod: CollectionMethodInput;
  couponCode?: string | undefined;
}

/**
 * UC1 — create a subscription. The customer is created inline from the submitted
 * name/email; the email doubles as the customer `reference`, so Maxio reuses an
 * existing customer on a retried submission (idempotent customer). The payment
 * collection method and optional coupon are passed through. Returns plan, MRR,
 * state and the next assessment date read back from the created subscription.
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<SubscriptionResult> {
  const subscriptions = getSubscriptionsController();
  try {
    const { result } = await subscriptions.createSubscription({
      subscription: {
        productHandle: input.productHandle,
        customerAttributes: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          reference: input.email.trim().toLowerCase(),
        },
        paymentCollectionMethod: COLLECTION_METHOD[input.collectionMethod],
        ...(input.couponCode ? { couponCode: input.couponCode } : {}),
      },
    });

    const sub = result.subscription;
    if (!sub || sub.id == null) {
      throw new MaxioServiceError('UC1 createSubscription: Maxio returned no subscription', 502);
    }

    const mrr =
      centsToNumber(sub.productPriceInCents) ?? centsToNumber(sub.product?.priceInCents) ?? 0;

    return {
      subscriptionId: sub.id,
      customerId: sub.customer?.id ?? null,
      state: sub.state ? String(sub.state) : 'unknown',
      productHandle: sub.product?.handle ?? input.productHandle,
      productName: sub.product?.name ?? input.productHandle,
      mrrInCents: mrr,
      currency: 'USD',
      nextAssessmentAt: sub.nextAssessmentAt ?? null,
      currentPeriodEndsAt: sub.currentPeriodEndsAt ?? null,
      couponCode: input.couponCode ?? null,
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toServiceError(err, 'UC1 createSubscription');
  }
}

export interface RecordUsageInput {
  subscriptionId: number;
  componentHandle: string;
  quantity: number;
  memo?: string | undefined;
  timestamp?: string | undefined;
}

interface SubscriptionComponentRef {
  componentId: number;
  handle: string;
  name: string;
  kind: string;
}

/**
 * Resolve a component from the subscription's own line items. Usage can only be
 * recorded against a component that is present on the subscription (Maxio 404s
 * otherwise), so we look it up there rather than site-wide. Returns null with the
 * list of available handles when the requested handle is not on the subscription.
 */
async function resolveSubscriptionComponent(
  subscriptionId: number,
  handle: string,
): Promise<{ match: SubscriptionComponentRef | null; available: string[] }> {
  const { result } = await getSubscriptionComponentsController().listSubscriptionComponents({
    subscriptionId,
  });
  const refs: SubscriptionComponentRef[] = result
    .map((r) => r.component)
    .filter((c): c is NonNullable<typeof c> => c != null && c.componentId != null && Boolean(c.componentHandle))
    .map((c) => ({
      componentId: c.componentId as number,
      handle: c.componentHandle as string,
      name: c.name ?? (c.componentHandle as string),
      kind: c.kind ? String(c.kind) : 'unknown',
    }));
  return {
    match: refs.find((r) => r.handle === handle) ?? null,
    available: refs.map((r) => r.handle),
  };
}

/**
 * UC2 — record usage against a component on the subscription. The component is
 * resolved from the subscription's line items, then dispatched on its kind:
 * quantity-style components record a usage quantity (+ optional memo) and the
 * running period total is read back from usage history; event-based components
 * record a usage event (+ optional timestamp). Rated usage accrues to the next
 * invoice.
 */
export async function recordUsage(input: RecordUsageInput): Promise<UsageResult> {
  try {
    const { match, available } = await resolveSubscriptionComponent(
      input.subscriptionId,
      input.componentHandle,
    );
    if (!match) {
      throw new MaxioServiceError(
        `UC2 recordUsage: component '${input.componentHandle}' is not on subscription ${input.subscriptionId}. ` +
          `Available: ${available.join(', ') || '(none)'}.`,
        404,
      );
    }

    const meta = findComponentMeta(input.componentHandle);
    const unitName = meta?.unitName ?? match.name;
    const sc = getSubscriptionComponentsController();

    // Event-based path — record an event (timestamp optional).
    if (match.kind === 'event_based_component') {
      await sc.recordEvent(match.handle, undefined, {
        chargify: {
          subscriptionId: input.subscriptionId,
          ...(input.timestamp ? { timestamp: input.timestamp } : {}),
        },
      });
      return {
        componentHandle: match.handle,
        componentName: match.name,
        recordedAs: 'event',
        quantity: input.quantity,
        periodTotal: null,
        unitName,
        memo: input.memo ?? null,
        accruesToNextInvoice: true,
      };
    }

    // Quantity-style path — record a usage quantity, then read the period total.
    if (!QUANTITY_KINDS.has(match.kind)) {
      throw new MaxioServiceError(
        `UC2 recordUsage: component '${match.handle}' has kind '${match.kind}', which does not accept usage.`,
        422,
      );
    }

    await sc.createUsage(input.subscriptionId, match.componentId, {
      usage: {
        quantity: input.quantity,
        ...(input.memo ? { memo: input.memo } : {}),
      },
    });

    const periodTotal = await readPeriodTotal(input.subscriptionId, match.componentId);

    return {
      componentHandle: match.handle,
      componentName: match.name,
      recordedAs: 'metered',
      quantity: input.quantity,
      periodTotal,
      unitName,
      memo: input.memo ?? null,
      accruesToNextInvoice: true,
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toServiceError(err, 'UC2 recordUsage');
  }
}

/** Sum recorded usage quantities for a component (best-effort period total). */
async function readPeriodTotal(subscriptionId: number, componentId: number): Promise<number | null> {
  try {
    const { result } = await getSubscriptionComponentsController().listUsages({
      subscriptionIdOrReference: subscriptionId,
      componentId,
      perPage: 200,
      page: 1,
    });
    return result.reduce((sum, u) => {
      const q = u.usage?.quantity;
      const n = typeof q === 'string' ? Number(q) : (q ?? 0);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  } catch {
    // Period total is informational; never fail the recording over it.
    return null;
  }
}

interface CurrentProduct {
  handle: string;
  name: string;
  currentPeriodEndsAt: string | null;
}

/** Read a subscription's current product + period end (used to report old→new). */
async function readCurrentProduct(subscriptionId: number): Promise<CurrentProduct> {
  const { result } = await getSubscriptionsController().readSubscription(subscriptionId);
  const sub = result.subscription;
  return {
    handle: sub?.product?.handle ?? 'unknown',
    name: sub?.product?.name ?? sub?.product?.handle ?? 'unknown',
    currentPeriodEndsAt: sub?.currentPeriodEndsAt ?? null,
  };
}

function planName(handle: string, fallback?: string): string {
  return findPlan(handle)?.name ?? fallback ?? handle;
}

export interface PlanChangeInput {
  subscriptionId: number;
  targetHandle: string;
}

/**
 * UC3 — preview a plan change. Uses the same prorated migration mechanism the
 * "prorate now" commit applies (`preservePeriod: true` → keep the billing period
 * and issue a prorated charge), so the preview reflects exactly what committing
 * with `prorate` timing would do.
 */
export async function previewPlanChange(input: PlanChangeInput): Promise<PlanChangePreview> {
  try {
    const current = await readCurrentProduct(input.subscriptionId);
    const { result } = await getSubscriptionProductsController().previewSubscriptionProductMigration(
      input.subscriptionId,
      {
        migration: {
          productHandle: input.targetHandle,
          preservePeriod: true,
          includeCoupons: true,
        },
      },
    );
    const m = result.migration;
    return {
      fromHandle: current.handle,
      fromName: current.name,
      toHandle: input.targetHandle,
      toName: planName(input.targetHandle),
      proratedAdjustmentInCents: centsToNumber(m?.proratedAdjustmentInCents) ?? 0,
      chargeInCents: centsToNumber(m?.chargeInCents) ?? 0,
      creditAppliedInCents: centsToNumber(m?.creditAppliedInCents) ?? 0,
      paymentDueInCents: centsToNumber(m?.paymentDueInCents) ?? 0,
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toServiceError(err, 'UC3 previewPlanChange');
  }
}

export interface ApplyPlanChangeInput extends PlanChangeInput {
  timing: 'prorate' | 'at-renewal';
}

/**
 * UC3 — apply a plan change. `prorate` migrates the product now with proration
 * (`preservePeriod: true`, same mechanism as the preview). `at-renewal` schedules
 * a non-prorated product change effective at the next renewal via a delayed
 * product change (`productChangeDelayed: true`).
 */
export async function applyPlanChange(input: ApplyPlanChangeInput): Promise<PlanChangeResult> {
  try {
    const current = await readCurrentProduct(input.subscriptionId);

    if (input.timing === 'prorate') {
      const { result } = await getSubscriptionProductsController().migrateSubscriptionProduct(
        input.subscriptionId,
        {
          migration: {
            productHandle: input.targetHandle,
            preservePeriod: true,
            includeCoupons: true,
          },
        },
      );
      const sub = result.subscription;
      return {
        fromHandle: current.handle,
        fromName: current.name,
        toHandle: sub?.product?.handle ?? input.targetHandle,
        toName: sub?.product?.name ?? planName(input.targetHandle),
        timing: 'prorate',
        effectiveAt: null, // immediate
        state: sub?.state ? String(sub.state) : 'unknown',
      };
    }

    // at-renewal — delayed, non-prorated product change.
    const { result } = await getSubscriptionsController().updateSubscription(input.subscriptionId, {
      subscription: {
        productHandle: input.targetHandle,
        productChangeDelayed: true,
      },
    });
    const sub = result.subscription;
    return {
      fromHandle: current.handle,
      fromName: current.name,
      toHandle: input.targetHandle,
      toName: planName(input.targetHandle),
      timing: 'at-renewal',
      effectiveAt: sub?.currentPeriodEndsAt ?? current.currentPeriodEndsAt,
      state: sub?.state ? String(sub.state) : 'unknown',
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toServiceError(err, 'UC3 applyPlanChange');
  }
}

async function readSubscriptionState(
  subscriptionId: number,
): Promise<{ state: string; currentPeriodEndsAt: string | null }> {
  const { result } = await getSubscriptionsController().readSubscription(subscriptionId);
  const sub = result.subscription;
  return {
    state: sub?.state ? String(sub.state) : 'unknown',
    currentPeriodEndsAt: sub?.currentPeriodEndsAt ?? null,
  };
}

export interface LifecycleInput {
  subscriptionId: number;
  action: LifecycleAction;
  cancelType?: CancelType | undefined;
  reasonCode?: string | undefined;
}

/**
 * UC4 — lifecycle control. Maps each action to its Maxio status operation:
 * pause→hold, resume→resume, cancel+immediate→cancel now,
 * cancel+end-of-period→delayed cancellation (effective at period end),
 * reactivate→reactivate. Reads the new state back to report the transition.
 */
export async function lifecycleAction(input: LifecycleInput): Promise<LifecycleResult> {
  const status = getSubscriptionStatusController();
  try {
    const before = await readSubscriptionState(input.subscriptionId);

    const base: LifecycleResult = {
      action: input.action,
      cancelType: null,
      previousState: before.state,
      newState: before.state,
      effectiveAt: null,
      reasonCode: input.reasonCode ?? null,
      note: null,
    };

    switch (input.action) {
      case 'pause': {
        const { result } = await status.pauseSubscription(input.subscriptionId, undefined);
        return { ...base, newState: result.subscription?.state ? String(result.subscription.state) : before.state };
      }
      case 'resume': {
        const { result } = await status.resumeSubscription(input.subscriptionId, undefined);
        return { ...base, newState: result.subscription?.state ? String(result.subscription.state) : before.state };
      }
      case 'reactivate': {
        const { result } = await status.reactivateSubscription(input.subscriptionId, {});
        return { ...base, newState: result.subscription?.state ? String(result.subscription.state) : before.state };
      }
      case 'cancel': {
        const cancelType: CancelType = input.cancelType ?? 'immediate';
        const cancellation = {
          ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
          cancellationMessage: 'Canceled via MeterMate',
        };
        if (cancelType === 'end-of-period') {
          const { result } = await status.initiateDelayedCancellation(input.subscriptionId, {
            subscription: cancellation,
          });
          const after = await readSubscriptionState(input.subscriptionId);
          return {
            ...base,
            cancelType,
            newState: after.state,
            effectiveAt: after.currentPeriodEndsAt,
            note: result.message ?? 'Cancellation scheduled for end of period.',
          };
        }
        const { result } = await status.cancelSubscription(input.subscriptionId, {
          subscription: cancellation,
        });
        return {
          ...base,
          cancelType,
          newState: result.subscription?.state ? String(result.subscription.state) : 'canceled',
        };
      }
      default: {
        const exhaustive: never = input.action;
        throw new MaxioServiceError(`UC4 lifecycleAction: unknown action '${String(exhaustive)}'`, 400);
      }
    }
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toServiceError(err, 'UC4 lifecycleAction');
  }
}

export interface IssueInvoiceInput {
  subscriptionId: number;
  clientEmail: string;
  lineItems?: InvoiceLineItemInput[] | undefined;
  memo?: string | undefined;
  sendEmail: boolean;
}

const DEFAULT_LINE_ITEM: InvoiceLineItemInput = {
  title: 'MeterMate consulting services',
  quantity: 1,
  unitPrice: '50.00',
};

/**
 * UC5 — create and issue an ad-hoc invoice for the subscription, optionally
 * emailing it, then read back the issued invoice's amount due, due date and
 * hosted public payment URL. Creating with `status: Open` both creates and
 * issues the invoice in one call (the path for ad-hoc subscription invoices). If
 * no line items are supplied, a single default line item is used so the invoice
 * is non-empty and issuable.
 */
export async function issueInvoice(input: IssueInvoiceInput): Promise<InvoiceResult> {
  const invoices = getInvoicesController();
  try {
    const items = input.lineItems && input.lineItems.length ? input.lineItems : [DEFAULT_LINE_ITEM];
    const { result: created } = await invoices.createInvoice(input.subscriptionId, {
      invoice: {
        lineItems: items.map((li) => ({
          title: li.title,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
        })),
        ...(input.memo ? { memo: input.memo } : {}),
        status: CreateInvoiceStatus.Open,
      },
    });

    const uid = created.invoice?.uid;
    if (!uid) {
      throw new MaxioServiceError('UC5 issueInvoice: Maxio returned no invoice uid', 502);
    }

    let emailed = false;
    if (input.sendEmail) {
      await invoices.sendInvoice(uid, { recipientEmails: [input.clientEmail] });
      emailed = true;
    }

    // Read back the issued invoice for the authoritative amounts and hosted URL.
    const { result: inv } = await invoices.readInvoice(uid);

    return {
      uid,
      number: inv.number ?? created.invoice?.number ?? null,
      status: inv.status ? String(inv.status) : 'unknown',
      totalAmount: inv.totalAmount ?? null,
      dueAmount: inv.dueAmount ?? null,
      dueDate: inv.dueDate ?? null,
      publicUrl: inv.publicUrl ?? null,
      emailed,
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toServiceError(err, 'UC5 issueInvoice');
  }
}

const ACTIVE_STATES = new Set(['active', 'trialing']);
const DIGEST_CAVEAT =
  'Reporting data is for reconciliation, not real-time confirmation; counts may lag live state slightly.';

/**
 * UC6 — build a per-consultant billing activity digest. The consultant is a
 * MeterMate label, not a Maxio entity, so the consultant's scope is the set of
 * subscriptions MeterMate created for them (from the transaction store). For each
 * subscription it reads live state + MRR, lists open invoices (counting overdue),
 * and counts recent events in the window. Mirrors the Maxio reconciliation
 * caveat (plan §2 UC6).
 */
export async function buildDigest(consultantId: string, windowDays: number): Promise<DigestResult> {
  try {
    const consultant = findConsultant(consultantId);
    const txns = transactionStore.findSubscriptionsForConsultant(consultantId);

    // Dedupe to unique subscriptions, keeping the earliest creation time.
    const subs = new Map<number, { createdAt: number }>();
    for (const t of txns) {
      const id = t.subscriptionId as number;
      const existing = subs.get(id);
      if (!existing || t.createdAt < existing.createdAt) subs.set(id, { createdAt: t.createdAt });
    }

    const windowStartMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const subscriptions = getSubscriptionsController();
    const invoices = getInvoicesController();
    const events = getEventsController();

    let activeCount = 0;
    let mrrInCents = 0;
    let newSignups = 0;
    let churn = 0;
    let overdueInvoices = 0;
    let recentEvents = 0;

    for (const [subscriptionId, meta] of subs) {
      if (meta.createdAt >= windowStartMs) newSignups += 1;

      const { result: subRes } = await subscriptions.readSubscription(subscriptionId);
      const sub = subRes.subscription;
      const state = sub?.state ? String(sub.state) : 'unknown';
      if (ACTIVE_STATES.has(state)) {
        activeCount += 1;
        mrrInCents +=
          centsToNumber(sub?.productPriceInCents) ?? centsToNumber(sub?.product?.priceInCents) ?? 0;
      }
      if (state === 'canceled') churn += 1;

      const { result: invRes } = await invoices.listInvoices({
        subscriptionId,
        status: InvoiceStatus.Open,
        perPage: 100,
      });
      overdueInvoices += invRes.invoices.filter((inv) => inv.dueDate != null && inv.dueDate < today).length;

      // Recent events are supplementary. The SDK strictly validates event
      // payloads and can reject newer/unknown `event_specific_data` shapes, so a
      // failure here must not sink the whole digest (best-effort, like usage).
      try {
        const { result: evRes } = await events.listSubscriptionEvents({ subscriptionId, perPage: 100 });
        recentEvents += evRes.filter(
          (e) => e.event?.createdAt != null && new Date(e.event.createdAt).getTime() >= windowStartMs,
        ).length;
      } catch (evErr) {
        console.warn(`[maxio] listSubscriptionEvents(${subscriptionId}) skipped: ${String(evErr)}`);
      }
    }

    return {
      consultantId,
      consultantName: consultant?.name ?? consultantId,
      windowDays,
      subscriptionsConsidered: subs.size,
      activeCount,
      mrrInCents,
      newSignups,
      churn,
      overdueInvoices,
      recentEvents,
      caveat: DIGEST_CAVEAT,
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    throw toServiceError(err, 'UC6 buildDigest');
  }
}
