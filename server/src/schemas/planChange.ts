import { z } from 'zod';

/** Shared transaction-resolution fields: txnRef OR consultantId + email. */
const txnResolveShape = {
  sessionId: z.string().trim().min(1).max(200).optional(),
  txnRef: z.string().trim().min(1).max(200).optional(),
  consultantId: z.string().trim().min(1).max(50).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
};

const requireResolution = (d: { txnRef?: string; consultantId?: string; email?: string }) =>
  Boolean(d.txnRef) || (Boolean(d.consultantId) && Boolean(d.email));

const resolutionError = {
  message: 'Provide either txnRef, or both consultantId and email.',
  path: ['txnRef'],
};

/** UC3 — POST /api/plan-change/preview. */
export const planChangePreviewSchema = z
  .object({
    ...txnResolveShape,
    targetHandle: z.string().trim().min(1, 'targetHandle is required').max(100),
  })
  .refine(requireResolution, resolutionError);

/** UC3 — POST /api/plan-change. */
export const planChangeSchema = z
  .object({
    ...txnResolveShape,
    targetHandle: z.string().trim().min(1, 'targetHandle is required').max(100),
    timing: z.enum(['prorate', 'at-renewal']),
  })
  .refine(requireResolution, resolutionError);

export type PlanChangePreviewInput = z.infer<typeof planChangePreviewSchema>;
export type PlanChangeCommitInput = z.infer<typeof planChangeSchema>;
