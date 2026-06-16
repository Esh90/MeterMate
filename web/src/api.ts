/**
 * Typed fetch wrappers for the MeterMate backend. Mirrors the contract in
 * plan §4.5; every mutating response is discriminated by `status`.
 */
import { getSessionId } from './session.ts';

export interface Consultant {
  id: string;
  name: string;
}

export interface SubscriptionResult {
  subscriptionId: number;
  customerId: number | null;
  state: string;
  productHandle: string;
  productName: string;
  mrrInCents: number;
  currency: string;
  nextAssessmentAt: string | null;
  currentPeriodEndsAt: string | null;
  couponCode: string | null;
}

export interface ChannelOutcome {
  created: boolean;
  reused: boolean;
  consultantInvited: boolean;
  clientInvited: boolean;
  clientNotifiedByEmail: boolean;
  notes: string[];
}

export interface BookRequest {
  firstName: string;
  lastName: string;
  email: string;
  consultantId: string;
  productHandle: string;
  collectionMethod: 'automatic' | 'remittance';
  couponCode?: string;
}

export type ValidationIssue = { path: string; message: string };

export type BookResponse =
  | {
      status: 'ok';
      idempotent?: boolean;
      txnId: string;
      channelId: string | null;
      channelName: string | null;
      subscription: SubscriptionResult;
      channel?: ChannelOutcome;
    }
  | {
      status: 'maxio_failed';
      txnId: string;
      channelId: string | null;
      channelName: string | null;
      error: string;
    }
  | { status: 'invalid'; errors: ValidationIssue[] }
  | { status: 'session_expired' }
  | { status: 'error'; message: string };

/** Network/transport failure surfaced to the UI as a discriminated value. */
export class ApiTransportError extends Error {}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiTransportError(err instanceof Error ? err.message : 'Network error');
  }
  // The backend returns a JSON `status`-discriminated body for ok and error
  // cases alike (200/400/409/500), so parse regardless of HTTP status.
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiTransportError(`Unexpected non-JSON response (HTTP ${res.status})`);
  }
}

export async function fetchConsultants(): Promise<Consultant[]> {
  let res: Response;
  try {
    res = await fetch('/api/consultants');
  } catch (err) {
    throw new ApiTransportError(err instanceof Error ? err.message : 'Network error');
  }
  const data = (await res.json()) as { status: string; consultants?: Consultant[] };
  return data.consultants ?? [];
}

export async function book(req: BookRequest): Promise<BookResponse> {
  return postJson<BookResponse>('/api/book', { sessionId: getSessionId(), ...req });
}

export interface Component {
  handle: string;
  name: string;
  unitName: string;
}

export async function fetchComponents(): Promise<Component[]> {
  let res: Response;
  try {
    res = await fetch('/api/components');
  } catch (err) {
    throw new ApiTransportError(err instanceof Error ? err.message : 'Network error');
  }
  const data = (await res.json()) as { status: string; components?: Component[] };
  return data.components ?? [];
}

export interface UsageRecord {
  componentHandle: string;
  componentName: string;
  recordedAs: 'metered' | 'event';
  quantity: number;
  periodTotal: number | null;
  unitName: string;
  memo: string | null;
  accruesToNextInvoice: true;
}

export interface UsageRequest {
  txnRef?: string;
  consultantId?: string;
  email?: string;
  componentHandle: string;
  quantity: number;
  memo?: string;
  timestamp?: string;
}

export type UsageResponse =
  | {
      status: 'ok';
      txnId: string;
      channelId: string | null;
      channelName: string | null;
      usage: UsageRecord;
    }
  | {
      status: 'maxio_failed';
      txnId: string;
      channelId: string | null;
      channelName: string | null;
      error: string;
    }
  | { status: 'invalid'; errors: ValidationIssue[] }
  | { status: 'session_expired'; message?: string }
  | { status: 'error'; message: string };

export async function recordUsage(req: UsageRequest): Promise<UsageResponse> {
  return postJson<UsageResponse>('/api/usage', { sessionId: getSessionId(), ...req });
}

export interface PlanChangePreviewData {
  fromHandle: string;
  fromName: string;
  toHandle: string;
  toName: string;
  proratedAdjustmentInCents: number;
  chargeInCents: number;
  creditAppliedInCents: number;
  paymentDueInCents: number;
}

export interface PlanChangeData {
  fromHandle: string;
  fromName: string;
  toHandle: string;
  toName: string;
  timing: 'prorate' | 'at-renewal';
  effectiveAt: string | null;
  state: string;
}

type FailedShape = {
  status: 'maxio_failed';
  txnId: string;
  channelId: string | null;
  channelName: string | null;
  error: string;
};

export type PlanPreviewResponse =
  | { status: 'ok'; txnId: string; channelId: string | null; channelName: string | null; preview: PlanChangePreviewData }
  | FailedShape
  | { status: 'invalid'; errors: ValidationIssue[] }
  | { status: 'session_expired'; message?: string }
  | { status: 'error'; message: string };

export type PlanChangeResponse =
  | { status: 'ok'; txnId: string; channelId: string | null; channelName: string | null; change: PlanChangeData }
  | FailedShape
  | { status: 'invalid'; errors: ValidationIssue[] }
  | { status: 'session_expired'; message?: string }
  | { status: 'error'; message: string };

export interface PlanChangeRequest {
  txnRef: string;
  targetHandle: string;
  timing: 'prorate' | 'at-renewal';
}

export async function previewPlanChange(
  req: Pick<PlanChangeRequest, 'txnRef' | 'targetHandle'>,
): Promise<PlanPreviewResponse> {
  return postJson<PlanPreviewResponse>('/api/plan-change/preview', {
    sessionId: getSessionId(),
    ...req,
  });
}

export async function applyPlanChange(req: PlanChangeRequest): Promise<PlanChangeResponse> {
  return postJson<PlanChangeResponse>('/api/plan-change', { sessionId: getSessionId(), ...req });
}
