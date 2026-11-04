import { z } from "zod";
import { reasonSchema } from "@/lib/schemas/admins";

// Admin Server Action inputs for M3 money, promotions, support and safety (shared by forms and actions).

const uuid = z.uuid();
/** Taka with at most two decimals. */
export const amountSchema = z
  .number()
  .positive()
  .max(10_000_000)
  .refine((n) => Math.round(n * 100) / 100 === n, { message: "At most two decimals." });

export const DEPOSIT_METHODS = ["office", "bank", "bkash", "nagad"] as const;

export const recordDepositSchema = z.strictObject({
  driverId: uuid,
  amount: amountSchema,
  method: z.enum(DEPOSIT_METHODS),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const reconcileSchema = z.strictObject({
  paymentIds: z.array(uuid).min(1).max(500),
  note: z.string().trim().max(500).optional(),
});

export const requestRefundSchema = z.strictObject({
  paymentId: uuid,
  amount: amountSchema,
  reason: reasonSchema,
  evidence: z.string().trim().max(2000).optional(),
});

export const requestAdjustmentSchema = z.strictObject({
  accountId: uuid,
  direction: z.enum(["debit", "credit"]),
  amount: amountSchema,
  reason: reasonSchema,
  evidence: z.string().trim().max(2000).optional(),
});

export const requestReversalSchema = z.strictObject({ transactionId: uuid, reason: reasonSchema });

export const reviewRefundSchema = z.strictObject({
  id: uuid,
  approve: z.boolean(),
  reason: z.string().trim().max(1000).optional(),
});

export const idSchema = z.strictObject({ id: uuid });
export const idReasonSchema = z.strictObject({ id: uuid, reason: reasonSchema });

export const createBatchSchema = z.strictObject({ notes: z.string().trim().max(500).optional() });
export const markPaidSchema = z.strictObject({ payoutId: uuid, reference: z.string().trim().min(1).max(100) });
export const failPayoutSchema = z.strictObject({ payoutId: uuid, reason: reasonSchema });
export const reviewPayoutAccountSchema = z.strictObject({
  id: uuid,
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export const promotionPayloadSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,20}$/, "3 to 20 letters or digits."),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  discount_type: z.enum(["percent", "fixed"]),
  discount_value: z.number().positive().max(100_000),
  max_discount: z.number().positive().max(100_000).nullable().optional(),
  min_fare: z.number().min(0).max(100_000),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  zone_ids: z.array(uuid).max(50),
  category_ids: z.array(uuid).max(20),
  new_users_only: z.boolean(),
  per_user_limit: z.number().int().min(1).max(100),
  total_redemption_limit: z.number().int().positive().max(10_000_000).nullable().optional(),
  budget_limit: z.number().positive().max(100_000_000).nullable().optional(),
});
export type PromotionPayload = z.infer<typeof promotionPayloadSchema>;

export const savePromotionSchema = z.strictObject({
  id: uuid.nullable(),
  expectedVersion: z.number().int().positive().nullable(),
  payload: promotionPayloadSchema,
});

export const setPromotionStatusSchema = z.strictObject({
  id: uuid,
  status: z.enum(["active", "paused", "ended"]),
  reason: reasonSchema,
});

// --- Support and safety -------------------------------------------------------------

export const replyTicketSchema = z.strictObject({ id: uuid, body: z.string().trim().min(1).max(4000), internal: z.boolean() });
export const assignTicketSchema = z.strictObject({ id: uuid, toMe: z.boolean() });
export const setTicketStatusSchema = z.strictObject({
  id: uuid,
  status: z.enum(["open", "in_progress", "pending_user", "resolved", "closed"]),
  note: z.string().trim().max(1000).optional(),
});
export const setTicketPrioritySchema = z.strictObject({ id: uuid, priority: z.enum(["low", "normal", "high", "urgent"]) });
export const hideRatingSchema = z.strictObject({ id: uuid, reason: reasonSchema });
export const advanceIncidentSchema = z.strictObject({
  id: uuid,
  status: z.enum(["acknowledged", "investigating", "escalated", "resolved", "closed"]),
  note: reasonSchema,
  escalatedTo: z.string().trim().max(200).optional(),
});
