import { z } from 'zod';

/**
 * UC6 — POST /api/digest (admin) request schema. Builds a per-consultant billing
 * activity digest over a rolling window. Validation runs before any Maxio/Slack
 * call (AC-18).
 */
export const digestSchema = z.object({
  sessionId: z.string().trim().min(1).max(200).optional(),
  consultantId: z.string().trim().min(1, 'consultantId is required').max(50),
  windowDays: z.number().int().positive().max(365).default(30),
});

export type DigestInputBody = z.infer<typeof digestSchema>;
