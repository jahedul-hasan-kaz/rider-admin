import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { api, call, num, page, sortFallback } from "@/server/queries/rpc";

// Typed readers for the M3 money RPCs (permission-checked in SQL).

export const paymentRowSchema = z.object({
  id: z.uuid(),
  trip_id: z.uuid(),
  method: z.string(),
  amount: num,
  currency: z.string(),
  status: z.string(),
  collected_amount: num.nullable(),
  collected_at: z.string().nullable(),
  refunded_amount: num,
  reconciled_at: z.string().nullable(),
  created_at: z.string(),
  passenger_name: z.string().nullable(),
  driver_name: z.string().nullable(),
});
export type PaymentRow = z.infer<typeof paymentRowSchema>;

export const paymentsCountsSchema = z.object({ pending: num, overdue: num, unreconciled: num, unreconciled_amount: num });

export const paymentsOverviewSchema = z.object({
  collected_today: num,
  pending_cash: num,
  refunds_open: num,
  payouts_pending: num,
  dues_total: num,
});

export const driverDueSchema = z.object({
  driver_id: z.uuid(),
  driver_name: z.string().nullable(),
  balance: num,
  last_deposit_at: z.string().nullable(),
});
export type DriverDue = z.infer<typeof driverDueSchema>;

export const tripFinanceSchema = z.object({
  payment: paymentRowSchema.nullable(),
  earning: z
    .object({ gross_fare: num, discount: num, commission: num, net_earning: num, payout_status: z.string() })
    .nullable(),
  ledger_transaction_id: z.uuid().nullable(),
  ledger_lines: z.array(z.object({ account: z.string(), debit: num, credit: num })).nullable(),
});
export type TripFinance = z.infer<typeof tripFinanceSchema>;

export const ledgerOverviewSchema = z.object({
  platform: z.array(z.object({ id: z.uuid(), code: z.string(), kind: z.string(), balance: num })),
  owed_to_drivers: num,
  owed_by_drivers: num,
  owed_by_passengers: num,
  verification: z
    .object({ ran_at: z.string(), ok: z.boolean(), drift_count: num, unbalanced_count: num, accounts_checked: num })
    .nullable(),
});
export type LedgerOverview = z.infer<typeof ledgerOverviewSchema>;

export const ledgerAccountRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  owner_type: z.string(),
  kind: z.string(),
  balance: num,
  owner_name: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export type LedgerAccountRow = z.infer<typeof ledgerAccountRowSchema>;

export const ledgerAccountDetailSchema = z.object({
  account: z.object({ id: z.uuid(), code: z.string(), owner_type: z.string(), kind: z.string(), balance: num }),
  entries: z.array(
    z.object({
      id: num,
      transaction_id: z.uuid(),
      debit: num,
      credit: num,
      kind: z.string(),
      memo: z.string().nullable(),
      trip_id: z.uuid().nullable(),
      created_at: z.string(),
    }),
  ),
  next_cursor: z.string().nullable(),
});

export type LedgerEntry = z.infer<typeof ledgerAccountDetailSchema>["entries"][number];

export const ledgerTransactionRowSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  reference: z.string(),
  trip_id: z.uuid().nullable(),
  memo: z.string().nullable(),
  created_at: z.string(),
  reverses_id: z.uuid().nullable(),
  reversed: z.boolean(),
  amount: num,
});
export type LedgerTransactionRow = z.infer<typeof ledgerTransactionRowSchema>;

export const ledgerTransactionDetailSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  reference: z.string(),
  trip_id: z.uuid().nullable(),
  memo: z.string().nullable(),
  created_at: z.string(),
  reverses_id: z.uuid().nullable(),
  reversed_by: z.uuid().nullable(),
  created_by_name: z.string().nullable(),
  entries: z.array(z.object({ account_id: z.uuid(), account: z.string(), debit: num, credit: num })),
});
export type LedgerTransactionDetail = z.infer<typeof ledgerTransactionDetailSchema>;

export const refundRowSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["refund", "adjustment", "reversal"]),
  status: z.string(),
  amount: num,
  currency: z.string(),
  reason: z.string(),
  evidence: z.string().nullable(),
  trip_id: z.uuid().nullable(),
  payment_id: z.uuid().nullable(),
  direction: z.string().nullable(),
  reverses_transaction_id: z.uuid().nullable(),
  account_id: z.uuid().nullable(),
  account_code: z.string().nullable(),
  passenger_name: z.string().nullable(),
  requested_by: z.uuid(),
  requested_by_name: z.string().nullable(),
  approved_by_name: z.string().nullable(),
  second_approved_by_name: z.string().nullable(),
  needs_second_approval: z.boolean(),
  rejection_reason: z.string().nullable(),
  ledger_transaction_id: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RefundRow = z.infer<typeof refundRowSchema>;

export const payoutBatchSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  total_amount: num,
  payout_count: num,
  notes: z.string().nullable(),
  created_at: z.string(),
  approved_at: z.string().nullable(),
  created_by_name: z.string().nullable(),
  approved_by_name: z.string().nullable(),
  counts: z.object({ pending: num, approved: num, paid: num, failed: num }),
});
export type PayoutBatch = z.infer<typeof payoutBatchSchema>;

export const payoutBatchDetailSchema = payoutBatchSchema.extend({
  payouts: z.array(
    z.object({
      id: z.uuid(),
      driver_id: z.uuid(),
      driver_name: z.string().nullable(),
      amount: num,
      status: z.string(),
      reference: z.string().nullable(),
      failure_reason: z.string().nullable(),
      method: z.string(),
      masked: z.string(),
      paid_at: z.string().nullable(),
    }),
  ),
});
export type PayoutBatchDetail = z.infer<typeof payoutBatchDetailSchema>;

export const payoutAccountSchema = z.object({
  id: z.uuid(),
  driver_id: z.uuid(),
  driver_name: z.string().nullable(),
  method: z.string(),
  account_holder: z.string(),
  masked: z.string(),
  status: z.string(),
  review_note: z.string().nullable(),
  created_at: z.string(),
});
export type PayoutAccount = z.infer<typeof payoutAccountSchema>;

export const promotionSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  discount_type: z.enum(["percent", "fixed"]),
  discount_value: num,
  max_discount: num.nullable(),
  min_fare: num,
  starts_at: z.string(),
  ends_at: z.string(),
  zone_ids: z.array(z.uuid()),
  category_ids: z.array(z.uuid()),
  new_users_only: z.boolean(),
  per_user_limit: num,
  total_redemption_limit: num.nullable(),
  budget_limit: num.nullable(),
  budget_spent: num,
  status: z.string(),
  version: num,
  created_at: z.string(),
  redemptions: num,
  live: z.boolean(),
});
export type Promotion = z.infer<typeof promotionSchema>;

export const promotionDetailSchema = promotionSchema.extend({
  roi: z.object({
    applied: num,
    reserved: num,
    released: num,
    discount_spend: num,
    gross_fares: num,
    contribution: num,
    new_passengers: num,
  }),
});
export type PromotionDetail = z.infer<typeof promotionDetailSchema>;

export const listPayments = (ctx: AdminContext, f: { status?: string; method?: string; unreconciled?: boolean; q?: string; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(
    api(ctx).rpc("list_payments", {
      p_status: f.status,
      p_method: f.method,
      p_unreconciled: f.unreconciled ?? false,
      p_search: f.q,
      p_cursor: f.cursor,
      p_limit: 50,
      p_sort: f.sort,
    }),
    page(paymentRowSchema).extend({ counts: paymentsCountsSchema }),
  ));
export const getPaymentsOverview = (ctx: AdminContext) => call(api(ctx).rpc("payments_overview"), paymentsOverviewSchema);
export const listDriverDues = (ctx: AdminContext) => call(api(ctx).rpc("list_driver_dues"), z.array(driverDueSchema));
export const getTripFinance = (ctx: AdminContext, tripId: string) =>
  call(api(ctx).rpc("get_trip_finance", { p_trip_id: tripId }), tripFinanceSchema);

export const getLedgerOverview = (ctx: AdminContext) => call(api(ctx).rpc("ledger_overview"), ledgerOverviewSchema);
export const listLedgerAccounts = (ctx: AdminContext, f: { ownerType?: string; q?: string }) =>
  call(api(ctx).rpc("list_ledger_accounts", { p_owner_type: f.ownerType, p_search: f.q, p_limit: 200 }), z.array(ledgerAccountRowSchema));
export const getLedgerAccount = (ctx: AdminContext, id: string, cursor?: number) =>
  call(api(ctx).rpc("get_ledger_account", { p_id: id, p_cursor: cursor, p_limit: 50 }), ledgerAccountDetailSchema);
export const listLedgerTransactions = (ctx: AdminContext, f: { kind?: string; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(api(ctx).rpc("list_ledger_transactions", { p_kind: f.kind, p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }), page(ledgerTransactionRowSchema)));
export const getLedgerTransaction = (ctx: AdminContext, id: string) =>
  call(api(ctx).rpc("get_ledger_transaction", { p_id: id }), ledgerTransactionDetailSchema);

export const listRefunds = (ctx: AdminContext, f: { status?: string; cursor?: string }) =>
  call(
    api(ctx).rpc("list_refunds", { p_status: f.status, p_cursor: f.cursor, p_limit: 50 }),
    page(refundRowSchema).extend({ counts: z.object({ open: num }) }),
  );

export const listPayoutBatches = (ctx: AdminContext) => call(api(ctx).rpc("list_payout_batches"), z.array(payoutBatchSchema));
export const getPayoutBatch = (ctx: AdminContext, id: string) => call(api(ctx).rpc("get_payout_batch", { p_id: id }), payoutBatchDetailSchema);
export const listPayoutAccounts = (ctx: AdminContext, status: string | null) =>
  call(api(ctx).rpc("list_payout_accounts", { p_status: status ?? undefined }), z.array(payoutAccountSchema));

export const listPromotions = (ctx: AdminContext, status?: string) =>
  call(api(ctx).rpc("list_promotions", { p_status: status }), z.array(promotionSchema));
export const getPromotion = (ctx: AdminContext, id: string) => call(api(ctx).rpc("get_promotion", { p_id: id }), promotionDetailSchema);
