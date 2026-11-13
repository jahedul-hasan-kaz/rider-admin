import { z } from "zod";
import { reasonSchema } from "@/lib/schemas/admins";

// Staff create / update / delete forms (supabase/migrations/20261110090000_m7_admin_crud.sql).

const uuid = z.uuid();
const name = z.string().trim().min(2, "Enter a name of 2 to 100 characters.").max(100);
// Same rules as private.normalize_phone: local Bangladeshi forms become +880…, everything is stored as +<digits>.
export function normalizePhone(v: string): string {
  const d = v.replace(/[\s().-]/g, "");
  if (/^01[3-9][0-9]{8}$/.test(d)) return `+88${d}`;
  if (/^8801[3-9][0-9]{8}$/.test(d)) return `+${d}`;
  return d;
}
const phone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(z.union([z.literal(""), z.string().regex(/^\+[1-9][0-9]{7,14}$/, "Enter a phone number like 01712345678 or +8801712345678.")]));
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const label = z.string().trim().max(200);

export const createAccountSchema = z.strictObject({
  role: z.enum(["passenger", "driver"]),
  fullName: name,
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  phone,
  password: z.union([z.literal(""), z.string().min(6, "Use at least 6 characters.").max(72)]),
  homeZoneId: uuid.nullable(),
  reason: reasonSchema,
});

export const updateContactSchema = z.strictObject({ profileId: uuid, fullName: name, phone, reason: reasonSchema });
export const deleteAccountSchema = z.strictObject({ profileId: uuid, reason: reasonSchema });

export const saveVehicleSchema = z.strictObject({
  id: uuid.nullable(),
  driverId: uuid.nullable(),
  categoryId: uuid,
  make: z.string().trim().min(1, "Enter the make.").max(40),
  model: z.string().trim().min(1, "Enter the model.").max(40),
  color: z.string().trim().min(1, "Enter the colour.").max(30),
  registrationNumber: z.string().trim().min(3, "Enter the registration number.").max(20),
  year: z.coerce.number().int().min(1990).max(new Date().getFullYear() + 1),
  reason: reasonSchema,
});
export const retireVehicleSchema = z.strictObject({ vehicleId: uuid, reason: reasonSchema });

const dateOrNull = z.union([z.literal(""), z.iso.date()]).transform((v) => (v === "" ? null : v));
export const updateDocumentSchema = z.strictObject({ documentId: uuid, issuedAt: dateOrNull, expiresAt: dateOrNull, reason: reasonSchema });
export const withdrawDocumentSchema = z.strictObject({ documentId: uuid, reason: reasonSchema });
export const uploadDocumentSchema = z.strictObject({
  driverId: uuid,
  documentType: z.string().min(1).max(40),
  vehicleId: z.union([z.literal(""), uuid]).transform((v) => (v === "" ? null : v)),
  documentNumber: z.string().trim().max(40),
  issuedAt: dateOrNull,
  expiresAt: dateOrNull,
  reason: reasonSchema,
});

export const bookRideSchema = z.strictObject({
  passengerId: uuid,
  categoryId: uuid,
  pickup: z.strictObject({ lat, lng, label }),
  destination: z.strictObject({ lat, lng, label }),
  paymentMethod: z.literal("cash"),
  pickupNote: z.string().trim().max(200),
  reason: reasonSchema,
});
export const updateRequestSchema = z.strictObject({ requestId: uuid, pickupNote: z.string().trim().max(200), reason: reasonSchema });
export const cancelRequestSchema = z.strictObject({ requestId: uuid, reason: reasonSchema });
export const assignDriverSchema = z.strictObject({ requestId: uuid, driverId: uuid, reason: reasonSchema });

export const createAlertSchema = z.strictObject({
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string().trim().min(5, "Write a title of 5 to 200 characters.").max(200),
  detail: z.string().trim().max(2000),
  reason: reasonSchema,
});
export const resolveAlertSchema = z.strictObject({ id: uuid, reason: reasonSchema });

export const confirmCashSchema = z.strictObject({ tripId: uuid, amount: z.coerce.number().min(0).max(1_000_000), reason: reasonSchema });
export const updateRefundSchema = z.strictObject({ id: uuid, amount: z.coerce.number().positive().max(1_000_000), reason: reasonSchema });

export const pickPeopleSchema = z.strictObject({ role: z.enum(["passenger", "driver"]), query: z.string().trim().max(60) });
