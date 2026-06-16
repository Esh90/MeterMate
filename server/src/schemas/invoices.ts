import { z } from 'zod';

/**
 * UC5 — POST /api/invoices (admin) request schema. The transaction is resolved
 * by `txnRef` or `consultantId` + `email`. Line items are optional (a default is
 * used when none are given). `unitPrice` is a decimal string per the Maxio API.
 */
const lineItemSchema = z.object({
  title: z.string().trim().min(1).max(255),
  quantity: z.number().positive().finite(),
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,8})?$/, 'unitPrice must be a decimal string, e.g. "50.00"'),
});

export const invoiceSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(200).optional(),
    txnRef: z.string().trim().min(1).max(200).optional(),
    consultantId: z.string().trim().min(1).max(50).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    lineItems: z.array(lineItemSchema).max(50).optional(),
    memo: z.string().trim().max(1000).optional(),
    sendEmail: z.boolean().default(false),
  })
  .refine((d) => Boolean(d.txnRef) || (Boolean(d.consultantId) && Boolean(d.email)), {
    message: 'Provide either txnRef, or both consultantId and email.',
    path: ['txnRef'],
  });

export type InvoiceInputBody = z.infer<typeof invoiceSchema>;
