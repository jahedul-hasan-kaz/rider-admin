import { z } from "zod";
import { reasonSchema } from "@/lib/schemas/admins";

// Admin Server Action inputs for M2 (shared by forms and actions).

const uuid = z.uuid();
const money = z.number().min(0).max(100_000);
const COMPONENTS = ["base", "distance", "time", "waiting", "surge"] as const;

export const fareValuesSchema = z.strictObject({
  base_fare: money,
  per_km: money,
  per_minute: money,
  minimum_fare: money,
  booking_fee: money,
  waiting_per_minute: money,
  free_waiting_minutes: z.number().int().min(0).max(60),
  cancellation_fee: money,
  platform_commission_pct: z.number().min(0).max(0.5),
  max_surge_multiplier: z.number().min(1).max(3),
  commissionable_components: z.array(z.enum(COMPONENTS)).max(5),
});
export type FareValues = z.infer<typeof fareValuesSchema>;

export const saveFareDraftSchema = z.strictObject({
  id: uuid.nullable(),
  categoryId: uuid,
  zoneId: uuid.nullable(),
  values: fareValuesSchema,
  changeNote: z.string().trim().max(300).optional(),
  expectedVersion: z.number().int().positive().nullable(),
});

export const ruleIdSchema = z.strictObject({ ruleId: uuid });
export const discardDraftSchema = z.strictObject({ ruleId: uuid, reason: reasonSchema });
export const publishFareSchema = z.strictObject({
  ruleId: uuid,
  effectiveFrom: z.iso.datetime({ offset: true }).nullable(),
  reason: reasonSchema,
});
export const retireFareSchema = z.strictObject({ ruleId: uuid, reason: reasonSchema });

export const simulateFareSchema = z.strictObject({
  values: fareValuesSchema,
  distanceM: z.number().int().min(0).max(300_000),
  durationS: z.number().int().min(0).max(86_400),
  waitingS: z.number().int().min(0).max(7_200),
  surge: z.number().min(1).max(3),
  compareRuleId: uuid.nullable(),
});

export const requestReasonSchema = z.strictObject({ requestId: uuid, reason: reasonSchema });
export const tripReasonSchema = z.strictObject({ tripId: uuid, reason: reasonSchema });
export const tripNoteSchema = z.strictObject({ tripId: uuid, body: z.string().trim().min(1).max(4000) });
