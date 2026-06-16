import { z } from 'zod';

/**
 * UC1 — POST /api/book request schema. Validation runs before any Maxio/Slack
 * call (AC-18); invalid input returns 400 with no side effects.
 */
export const bookSchema = z.object({
  sessionId: z.string().trim().min(1).max(200).optional(),
  firstName: z.string().trim().min(1, 'firstName is required').max(100),
  lastName: z.string().trim().min(1, 'lastName is required').max(100),
  email: z.string().trim().toLowerCase().email('a valid email is required').max(254),
  consultantId: z.string().trim().min(1, 'consultantId is required').max(50),
  productHandle: z.string().trim().min(1, 'productHandle is required').max(100),
  collectionMethod: z.enum(['automatic', 'remittance']),
  couponCode: z.string().trim().min(1).max(100).optional(),
});

export type BookInput = z.infer<typeof bookSchema>;
