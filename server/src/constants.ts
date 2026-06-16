import { config } from './config.js';
import { slugify } from './util.js';
import type { Consultant } from './types.js';

/**
 * Seeded consultants. The consultant is a label on a transaction (plan §1.6),
 * not a billing rate. Slack emails come from env so the demo can seed real
 * workspace members; an empty email exercises the email-only fallback tier.
 */
export const CONSULTANTS: readonly Consultant[] = Object.freeze([
  {
    id: 'c1',
    name: 'Avery Stone',
    slug: slugify('Avery Stone'),
    slackEmail: config.CONSULTANT_C1_EMAIL || null,
  },
  {
    id: 'c2',
    name: 'Priya Nair',
    slug: slugify('Priya Nair'),
    slackEmail: config.CONSULTANT_C2_EMAIL || null,
  },
]);

export function findConsultant(id: string): Consultant | undefined {
  return CONSULTANTS.find((c) => c.id === id);
}

/** Product family for all MeterMate plans (created/looked up by the seed). */
export const PRODUCT_FAMILY = Object.freeze({
  name: 'MeterMate Consulting',
  handle: 'metermate-consulting',
});

/**
 * The global pricing model (plan §1.6). Recurring products are seeded with
 * explicit price points so nothing relies on a Maxio default. Component handles
 * are listed for later use cases.
 */
export const PLANS = Object.freeze([
  {
    handle: 'basic',
    name: 'Basic Plan',
    description: 'Flat monthly retainer — Basic.',
    priceInCents: 9900,
    interval: 1,
  },
  {
    handle: 'pro',
    name: 'Pro Plan',
    description: 'Flat monthly retainer — Pro.',
    priceInCents: 29900,
    interval: 1,
  },
] as const);

export type PlanHandle = (typeof PLANS)[number]['handle'];

export const PLAN_HANDLES: readonly string[] = PLANS.map((p) => p.handle);

export function findPlan(handle: string): (typeof PLANS)[number] | undefined {
  return PLANS.find((p) => p.handle === handle);
}
