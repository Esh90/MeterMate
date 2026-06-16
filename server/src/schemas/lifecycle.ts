import { z } from 'zod';

/**
 * UC4 — POST /api/lifecycle request schema. The transaction is resolved by
 * `txnRef` or `consultantId` + `email`. `cancelType` is required only when
 * `action` is `cancel`. Validation runs before any Maxio/Slack call (AC-18).
 */
export const lifecycleSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(200).optional(),
    txnRef: z.string().trim().min(1).max(200).optional(),
    consultantId: z.string().trim().min(1).max(50).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    action: z.enum(['pause', 'resume', 'cancel', 'reactivate']),
    cancelType: z.enum(['immediate', 'end-of-period']).optional(),
    reasonCode: z.string().trim().max(100).optional(),
  })
  .refine((d) => Boolean(d.txnRef) || (Boolean(d.consultantId) && Boolean(d.email)), {
    message: 'Provide either txnRef, or both consultantId and email.',
    path: ['txnRef'],
  });

export type LifecycleInputBody = z.infer<typeof lifecycleSchema>;
