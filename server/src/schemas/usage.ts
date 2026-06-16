import { z } from 'zod';

/**
 * UC2 — POST /api/usage request schema. The transaction is resolved either by
 * `txnRef` (a txnId) or by `consultantId` + `email`; at least one path must be
 * provided. Validation runs before any Maxio/Slack call (AC-18).
 */
export const usageSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(200).optional(),
    txnRef: z.string().trim().min(1).max(200).optional(),
    consultantId: z.string().trim().min(1).max(50).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    componentHandle: z.string().trim().min(1, 'componentHandle is required').max(100),
    quantity: z.number().positive('quantity must be greater than 0').finite(),
    memo: z.string().trim().max(255).optional(),
    // Optional ISO-8601 timestamp for event-based usage.
    timestamp: z.string().datetime({ message: 'timestamp must be ISO-8601' }).optional(),
  })
  .refine((d) => Boolean(d.txnRef) || (Boolean(d.consultantId) && Boolean(d.email)), {
    message: 'Provide either txnRef, or both consultantId and email.',
    path: ['txnRef'],
  });

export type UsageInput = z.infer<typeof usageSchema>;
