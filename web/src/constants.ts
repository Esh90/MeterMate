/**
 * Plan options for the booking dropdown. Mirrors the seeded global pricing
 * (plan §1.6). Kept in sync with the server seed; the consultant list is fetched
 * live from /api/consultants.
 */
export interface PlanOption {
  handle: string;
  label: string;
}

export const PLAN_OPTIONS: readonly PlanOption[] = [
  { handle: 'basic', label: 'Basic — $99 / month' },
  { handle: 'pro', label: 'Pro — $299 / month' },
];
