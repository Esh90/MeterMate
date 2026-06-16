import { ApiError, CollectionMethod } from '@maxio-com/advanced-billing-sdk';
import { getSubscriptionsController } from '../maxioClient.js';
import { centsToNumber } from '../util.js';
import type { CollectionMethodInput, SubscriptionResult } from '../types.js';

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
