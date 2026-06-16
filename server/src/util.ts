/** Small, dependency-free helpers shared across the server. */

/**
 * Sanitize an arbitrary string into a Slack-safe slug: lowercase, only
 * [a-z0-9-_], collapsed and trimmed dashes. Slack channel names are limited to
 * lowercase letters, numbers, hyphens and underscores (≤ 80 chars total).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Derive a slug from an email's local part (before the @). */
export function emailSlug(email: string): string {
  const local = email.split('@')[0] ?? email;
  return slugify(local);
}

/**
 * Build a Slack channel name `txn-<consultant>-<client>-<seq>` clamped to Slack's
 * 80-char limit. The sequence segment is preserved; the party slugs are trimmed
 * proportionally if the combined name would exceed the limit.
 */
export function buildChannelName(consultantSlug: string, clientSlug: string, seq: number): string {
  const prefix = 'txn-';
  const suffix = `-${seq}`;
  const budget = 80 - prefix.length - suffix.length - 1; // 1 for the dash between parties
  let c = consultantSlug;
  let k = clientSlug;
  if (c.length + k.length > budget) {
    const half = Math.floor(budget / 2);
    c = c.slice(0, half);
    k = k.slice(0, budget - c.length);
  }
  return `${prefix}${c}-${k}${suffix}`.replace(/-{2,}/g, '-').slice(0, 80);
}

/** Stable key for the (consultant, client) pair used for channel reuse. */
export function pairKey(consultantId: string, clientEmail: string): string {
  return `${consultantId}::${clientEmail.trim().toLowerCase()}`;
}

/** Convert a possibly-bigint cents value to a finite number, or null. */
export function centsToNumber(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === 'bigint' ? Number(value) : value;
}

/** Format integer cents as a currency string, e.g. 9900 -> "$99.00". */
export function formatCents(cents: number | null, currency = 'USD'): string {
  if (cents == null) return 'n/a';
  const symbol = currency === 'USD' ? '$' : '';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
