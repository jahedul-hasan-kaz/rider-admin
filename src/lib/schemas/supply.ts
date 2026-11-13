import { z } from "zod";
import { reasonSchema } from "@/lib/schemas/admins";

// Admin Server Action inputs for M1 (shared by forms and actions).

const uuid = z.uuid();
const optionalReason = z.string().trim().max(1000).optional();

export const reviewDocumentSchema = z.strictObject({
  documentId: uuid,
  decision: z.enum(["approve", "reject"]),
  reason: optionalReason,
  expectedVersion: z.number().int().positive(),
});

export const driverDecisionSchema = z.strictObject({ driverId: uuid, reason: optionalReason });
export const driverReasonSchema = z.strictObject({ driverId: uuid, reason: reasonSchema });
export const updateDriverSchema = z.strictObject({
  driverId: uuid,
  homeZoneId: uuid.nullable(),
  expectedVersion: z.number().int().positive(),
});

export const vehicleDecisionSchema = z.strictObject({ vehicleId: uuid, reason: optionalReason });
export const vehicleReasonSchema = z.strictObject({ vehicleId: uuid, reason: reasonSchema });
export const setCurrentVehicleSchema = z.strictObject({ driverId: uuid, vehicleId: uuid, reason: optionalReason });

export const CATEGORY_ICONS = ["bike", "car", "cng", "microbus", "ambulance", "truck"] as const;
export const categorySchema = z.strictObject({
  id: uuid.nullable(),
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,30}$/, "Use lowercase letters, digits and underscores."),
  name: z.string().trim().min(1).max(60),
  nameBn: z.string().trim().max(60).optional(),
  description: z.string().trim().max(300).optional(),
  passengerCapacity: z.number().int().min(1).max(20),
  icon: z.enum(CATEGORY_ICONS),
  active: z.boolean(),
  expectedVersion: z.number().int().positive().nullable(),
});
export const reorderCategoriesSchema = z.strictObject({ ids: z.array(uuid).min(1).max(50) });

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(position).min(4);
export const zoneGeometrySchema = z.union([
  z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ring).min(1)).min(1) }),
]);
export const saveZoneSchema = z.strictObject({
  id: uuid.nullable(),
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "Use lowercase letters, digits and underscores."),
  name: z.string().trim().min(1).max(80),
  geometry: zoneGeometrySchema,
  active: z.boolean(),
  expectedVersion: z.number().int().positive().nullable(),
  reason: reasonSchema,
});

export const updatePassengerSchema = z.strictObject({
  profileId: uuid,
  fullName: z.string().trim().min(1).max(120),
  preferredLanguage: z.enum(["en", "bn"]),
  expectedVersion: z.number().int().positive(),
});
export const passengerStatusSchema = z.strictObject({
  profileId: uuid,
  status: z.enum(["active", "suspended"]),
  reason: reasonSchema,
});

export const revealPiiSchema = z.strictObject({
  profileId: uuid,
  field: z.enum(["phone", "email", "licence_number"]),
  reason: reasonSchema,
});

export const openDocumentSchema = z.strictObject({ documentId: uuid });
