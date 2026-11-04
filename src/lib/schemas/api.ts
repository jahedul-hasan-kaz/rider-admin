import { z } from "zod";

// Request bodies for the mobile REST API (docs/spec/05-api.md §2). Strict: unknown keys are rejected.

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);
const isoDate = z.iso.date();
const name = z.string().trim().min(1).max(120);

export const DOCUMENT_TYPES = [
  "profile_photo",
  "national_id",
  "driving_licence",
  "vehicle_registration",
  "fitness_certificate",
  "tax_token",
  "insurance",
  "route_permit",
] as const;
export const UPLOAD_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const updateMeSchema = z.strictObject({
  full_name: name,
  preferred_language: z.enum(["en", "bn"]),
  expected_version: z.number().int().positive(),
});

export const onboardingSchema = z.strictObject({ full_name: name });

export const pointQuerySchema = z.object({
  lat: z.coerce.number().pipe(latitude),
  lng: z.coerce.number().pipe(longitude),
});

export const optionalPointQuerySchema = z.object({
  lat: z.coerce.number().pipe(latitude).optional(),
  lng: z.coerce.number().pipe(longitude).optional(),
}).refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: "Send both lat and lng." });

export const driverDetailsSchema = z.strictObject({
  licence_number: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{5,30}$/).optional(),
  licence_expiry: isoDate.optional(),
  home_zone_id: z.uuid().optional(),
});

export const uploadUrlSchema = z.strictObject({
  document_type: z.enum(DOCUMENT_TYPES),
  vehicle_id: z.uuid().optional(),
  content_type: z.enum(UPLOAD_CONTENT_TYPES),
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});

export const completeDocumentSchema = z.strictObject({
  document_number: z.string().trim().min(3).max(40).optional(),
  issued_at: isoDate.optional(),
  expires_at: isoDate.optional(),
});

export const vehicleSchema = z.strictObject({
  category_id: z.uuid(),
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(30),
  registration_number: z.string().trim().min(3).max(24),
  year: z.number().int().min(1990).max(2100),
});

export const updateVehicleSchema = vehicleSchema.extend({ expected_version: z.number().int().positive() });

export const availabilitySchema = z.strictObject({
  online: z.boolean(),
  lat: latitude.optional(),
  lng: longitude.optional(),
  accuracy: z.number().min(0).max(10_000).optional(),
}).refine((v) => !v.online || (v.lat !== undefined && v.lng !== undefined), {
  path: ["lat"],
  message: "Send your location to go online.",
});

export const locationSchema = z.strictObject({
  points: z
    .array(
      z.strictObject({
        lat: latitude,
        lng: longitude,
        heading: z.number().min(0).max(360).optional(),
        speed: z.number().min(0).max(100).optional(),
        accuracy: z.number().min(0).max(10_000).optional(),
        recorded_at: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(20),
});

// --- M2: rides -------------------------------------------------------------

const place = z.strictObject({
  lat: latitude,
  lng: longitude,
  label: z.string().trim().max(200).optional(),
});

export const quoteSchema = z.strictObject({
  category_id: z.uuid(),
  pickup: place,
  destination: place,
});

export const PAYMENT_METHODS = ["cash", "bkash", "nagad", "card"] as const;
export const rideSchema = z.strictObject({
  quote_id: z.uuid(),
  payment_method: z.enum(PAYMENT_METHODS).default("cash"),
  pickup_note: z.string().trim().max(300).optional(),
});

export const cancelRideSchema = z.strictObject({ reason: z.string().trim().max(300).optional() });
export const rejectOfferSchema = z.strictObject({ reason: z.string().trim().max(200).optional() });
export const arrivedSchema = z.strictObject({ override: z.boolean().optional() });
export const driverCancelSchema = z.strictObject({ reason: z.string().trim().min(3).max(300) });

// --- M3: money, ratings, support, safety ----------------------------------------------

export const cashCollectedSchema = z.strictObject({ amount: z.number().min(0).max(1_000_000).optional() });
export const payoutAccountSchema = z.strictObject({
  method: z.enum(["bkash", "nagad", "bank"]),
  holder: z.string().trim().min(2).max(120),
  ref: z.string().trim().regex(/^[0-9A-Za-z-]{5,40}$/, "Enter a valid account or wallet number."),
});
export const promoSchema = z.strictObject({ code: z.string().trim().min(3).max(20) });
export const rateSchema = z.strictObject({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() });
export const sosSchema = z.strictObject({ note: z.string().trim().max(2000).optional() });
export const ticketSchema = z.strictObject({
  tripId: z.uuid().optional(),
  category: z.enum(["payment", "trip", "driver", "passenger", "safety", "account", "other"]),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(4000),
});
export const ticketReplySchema = z.strictObject({ body: z.string().trim().min(1).max(4000) });

export const startTripSchema = z.strictObject({ pin: z.string().regex(/^[0-9]{4}$/).optional() });

export const EVIDENCE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "audio/mp4", "video/mp4"] as const;
export const evidenceUploadSchema = z.strictObject({ content_type: z.enum(EVIDENCE_CONTENT_TYPES) });
export const evidenceCompleteSchema = z.strictObject({
  path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf|m4a|mp4)$/),
  content_type: z.enum(EVIDENCE_CONTENT_TYPES),
  description: z.string().trim().max(500).optional(),
});

export const deactivateSchema = z.strictObject({ confirm: z.literal(true), reason: z.string().trim().max(500).optional() });
