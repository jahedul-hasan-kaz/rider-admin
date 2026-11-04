"use server";

import { z } from "zod";
import {
  advanceIncidentSchema,
  assignTicketSchema,
  createBatchSchema,
  failPayoutSchema,
  hideRatingSchema,
  idReasonSchema,
  idSchema,
  markPaidSchema,
  reconcileSchema,
  recordDepositSchema,
  replyTicketSchema,
  requestAdjustmentSchema,
  requestRefundSchema,
  requestReversalSchema,
  reviewPayoutAccountSchema,
  reviewRefundSchema,
  savePromotionSchema,
  setPromotionStatusSchema,
  setTicketPrioritySchema,
  setTicketStatusSchema,
} from "@/lib/schemas/finance";
import { runAdminAction } from "@/server/actions/run";
import type { AdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";
import { orNull } from "@/server/http/handler";
import { getIncident, listIncidents } from "@/server/queries/care";

// M3 admin actions: permission → Zod → one RPC. Maker-checker, limits and audit live in SQL.

type RpcResult = { data: unknown; error: unknown };
async function rpc(promise: PromiseLike<RpcResult>) {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return data;
}
const api = (ctx: AdminContext) => ctx.supabase.schema("api");

// --- Payments and cash --------------------------------------------------------------

export async function recordCashDeposit(input: unknown) {
  return runAdminAction("payments.reconcile", recordDepositSchema, input, async (ctx, d) => {
    await rpc(
      api(ctx).rpc("record_cash_deposit", {
        p_driver_id: d.driverId,
        p_amount: d.amount,
        p_method: d.method,
        p_reference: orNull(d.reference),
        p_notes: orNull(d.notes),
      }),
    );
  });
}

export async function reconcilePayments(input: unknown) {
  return runAdminAction("payments.reconcile", reconcileSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("reconcile_payments", { p_payment_ids: d.paymentIds, p_note: orNull(d.note) }));
  });
}

// --- Ledger -------------------------------------------------------------------------

export async function runLedgerVerification() {
  return runAdminAction("ledger.adjust_approve", z.object({}), {}, async (ctx) => {
    const data = z.object({ drift: z.array(z.unknown()), unbalanced: z.array(z.unknown()) }).parse(await rpc(api(ctx).rpc("run_ledger_verification")));
    return { drift: data.drift.length, unbalanced: data.unbalanced.length };
  });
}

// --- Refunds, adjustments, reversals -------------------------------------------------

export async function requestRefund(input: unknown) {
  return runAdminAction("refunds.request", requestRefundSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("request_refund", { p_payment_id: d.paymentId, p_amount: d.amount, p_reason: d.reason, p_evidence: orNull(d.evidence) }));
  });
}

export async function requestAdjustment(input: unknown) {
  return runAdminAction("ledger.adjust_request", requestAdjustmentSchema, input, async (ctx, d) => {
    await rpc(
      api(ctx).rpc("request_adjustment", {
        p_account_id: d.accountId,
        p_direction: d.direction,
        p_amount: d.amount,
        p_reason: d.reason,
        p_evidence: orNull(d.evidence),
      }),
    );
  });
}

export async function requestReversal(input: unknown) {
  return runAdminAction("ledger.adjust_request", requestReversalSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("request_reversal", { p_transaction_id: d.transactionId, p_reason: d.reason }));
  });
}

/** The RPC checks refunds.approve or ledger.adjust_approve depending on the request kind. */
export async function reviewRefund(input: unknown) {
  return runAdminAction(null, reviewRefundSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("review_refund", { p_id: d.id, p_approve: d.approve, p_reason: orNull(d.reason) }));
  });
}

export async function cancelRefundRequest(input: unknown) {
  return runAdminAction(null, idSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("cancel_refund_request", { p_id: d.id }));
  });
}

// --- Payouts ------------------------------------------------------------------------

export async function createPayoutBatch(input: unknown) {
  return runAdminAction("payouts.create", createBatchSchema, input, async (ctx, d) => {
    const data = z.object({ id: z.uuid() }).parse(await rpc(api(ctx).rpc("create_payout_batch", { p_notes: orNull(d.notes) })));
    return { id: data.id };
  });
}

export async function approvePayoutBatch(input: unknown) {
  return runAdminAction("payouts.approve", idSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("approve_payout_batch", { p_id: d.id }));
  });
}

export async function cancelPayoutBatch(input: unknown) {
  return runAdminAction("payouts.create", idReasonSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("cancel_payout_batch", { p_id: d.id, p_reason: d.reason }));
  });
}

export async function markPayoutPaid(input: unknown) {
  return runAdminAction("payouts.approve", markPaidSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("mark_payout_paid", { p_payout_id: d.payoutId, p_reference: d.reference }));
  });
}

export async function failPayout(input: unknown) {
  return runAdminAction("payouts.approve", failPayoutSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("fail_payout", { p_payout_id: d.payoutId, p_reason: d.reason }));
  });
}

export async function reviewPayoutAccount(input: unknown) {
  return runAdminAction("payouts.approve", reviewPayoutAccountSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("review_payout_account", { p_id: d.id, p_approve: d.approve, p_note: orNull(d.note) }));
  });
}

// --- Promotions ---------------------------------------------------------------------

export async function savePromotion(input: unknown) {
  return runAdminAction("promotions.manage", savePromotionSchema, input, async (ctx, d) => {
    const data = z
      .object({ id: z.uuid() })
      .parse(await rpc(api(ctx).rpc("save_promotion", { p_id: orNull(d.id ?? undefined), p_payload: d.payload, p_expected_version: orNull(d.expectedVersion ?? undefined) })));
    return { id: data.id };
  });
}

export async function setPromotionStatus(input: unknown) {
  return runAdminAction("promotions.manage", setPromotionStatusSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("set_promotion_status", { p_id: d.id, p_status: d.status, p_reason: d.reason }));
  });
}

// --- Support ------------------------------------------------------------------------

export async function replyTicket(input: unknown) {
  return runAdminAction("support.manage", replyTicketSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("reply_ticket", { p_id: d.id, p_body: d.body, p_internal: d.internal }));
  });
}

export async function assignTicket(input: unknown) {
  return runAdminAction("support.assign", assignTicketSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("assign_ticket", { p_id: d.id, p_assignee: d.toMe ? ctx.userId : orNull<string>(undefined) }));
  });
}

export async function setTicketStatus(input: unknown) {
  return runAdminAction("support.manage", setTicketStatusSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("set_ticket_status", { p_id: d.id, p_status: d.status, p_note: orNull(d.note) }));
  });
}

export async function setTicketPriority(input: unknown) {
  return runAdminAction("support.manage", setTicketPrioritySchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("set_ticket_priority", { p_id: d.id, p_priority: d.priority }));
  });
}

export async function hideRating(input: unknown) {
  return runAdminAction("support.manage", hideRatingSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("hide_rating", { p_id: d.id, p_reason: d.reason }));
  });
}

// --- Safety -------------------------------------------------------------------------

export async function advanceIncident(input: unknown) {
  return runAdminAction("safety.manage", advanceIncidentSchema, input, async (ctx, d) => {
    await rpc(
      api(ctx).rpc("advance_incident", { p_id: d.id, p_status: d.status, p_note: d.note, p_escalated_to: orNull(d.escalatedTo) }),
    );
  });
}

/** Polled by the safety queue every 5 s so a new SOS is seen (and heard) within seconds. */
export async function loadSafetyQueue() {
  return runAdminAction("safety.view", z.object({}), {}, async (ctx) => listIncidents(ctx, { status: "open" }));
}

export async function loadIncident(input: unknown) {
  return runAdminAction("safety.view", idSchema, input, async (ctx, d) => getIncident(ctx, d.id));
}

/** Assigns several tickets to the caller in one step (up to 100; each is audited like a single assignment). */
export async function assignTicketsToMe(input: unknown) {
  return runAdminAction("support.assign", z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) }), input, async (ctx, d) => {
    const count = await rpc(api(ctx).rpc("assign_tickets", { p_ids: d.ids, p_assignee: ctx.userId }));
    return { count: z.number().parse(count) };
  });
}
