import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { api, call, num, page, sortFallback } from "@/server/queries/rpc";

// Typed readers for support, ratings and safety (M3).

export const ticketRowSchema = z.object({
  id: z.uuid(),
  ticket_no: num,
  subject: z.string(),
  category: z.string(),
  status: z.string(),
  priority: z.string(),
  channel: z.string(),
  requester_id: z.uuid(),
  requester_role: z.string(),
  requester_name: z.string().nullable(),
  assignee_id: z.uuid().nullable(),
  assignee_name: z.string().nullable(),
  trip_id: z.uuid().nullable(),
  sla_due_at: z.string(),
  first_response_at: z.string().nullable(),
  sla_breached: z.boolean(),
  tags: z.array(z.string()),
  version: num,
  created_at: z.string(),
  updated_at: z.string(),
});
export type TicketRow = z.infer<typeof ticketRowSchema>;

export const ticketDetailSchema = ticketRowSchema.extend({
  resolved_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  messages: z.array(
    z.object({
      id: num,
      author_type: z.enum(["user", "admin", "system"]),
      is_internal: z.boolean(),
      body: z.string(),
      created_at: z.string(),
      author_name: z.string().nullable(),
    }),
  ),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const ratingRowSchema = z.object({
  id: z.uuid(),
  trip_id: z.uuid(),
  score: num,
  comment: z.string().nullable(),
  reviewer_role: z.string(),
  reviewer_name: z.string().nullable(),
  reviewee_name: z.string().nullable(),
  hidden: z.boolean(),
  hidden_reason: z.string().nullable(),
  created_at: z.string(),
});
export type RatingRow = z.infer<typeof ratingRowSchema>;

export const incidentRowSchema = z.object({
  id: z.uuid(),
  incident_no: num,
  trip_id: z.uuid().nullable(),
  kind: z.string(),
  severity: z.string(),
  status: z.string(),
  reporter_role: z.string(),
  reporter_name: z.string().nullable(),
  assignee_name: z.string().nullable(),
  reported_at: z.string(),
  created_at: z.string(),
  acknowledged_at: z.string().nullable(),
  seconds_to_acknowledge: num.nullable(),
  open_seconds: num.nullable(),
});
export type IncidentRow = z.infer<typeof incidentRowSchema>;

export const incidentCountsSchema = z.object({ open: num, unacknowledged: num, critical: num });

export const incidentDetailSchema = incidentRowSchema.extend({
  description: z.string().nullable(),
  escalated_to: z.string().nullable(),
  resolution: z.string().nullable(),
  version: num,
  location: z.object({ lat: num, lng: num }).nullable(),
  events: z.array(
    z.object({
      id: num,
      from_status: z.string().nullable(),
      to_status: z.string(),
      note: z.string().nullable(),
      created_at: z.string(),
      actor_name: z.string().nullable(),
    }),
  ),
});
export type IncidentDetail = z.infer<typeof incidentDetailSchema>;

export const listTickets = (ctx: AdminContext, f: { status?: string; priority?: string; assignee?: string; q?: string; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(
    api(ctx).rpc("list_tickets", {
      p_status: f.status,
      p_priority: f.priority,
      p_assignee: f.assignee,
      p_search: f.q,
      p_cursor: f.cursor,
      p_limit: 50,
      p_sort: f.sort,
    }),
    page(ticketRowSchema).extend({ counts: z.object({ active: num, unassigned: num, breached: num, mine: num }) }),
  ));
export const getTicket = (ctx: AdminContext, id: string) => call(api(ctx).rpc("get_ticket", { p_id: id }), ticketDetailSchema);

export const listRatings = (ctx: AdminContext, f: { maxScore?: number; hidden?: boolean; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(
    api(ctx).rpc("list_ratings", { p_max_score: f.maxScore, p_hidden: f.hidden ?? false, p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }),
    page(ratingRowSchema),
  ));

export const listIncidents = (ctx: AdminContext, f: { status?: string; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(
    api(ctx).rpc("list_incidents", { p_status: f.status ?? "open", p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }),
    page(incidentRowSchema).extend({ counts: incidentCountsSchema }),
  ));
export const getIncident = (ctx: AdminContext, id: string) => call(api(ctx).rpc("get_incident", { p_id: id }), incidentDetailSchema);

export const evidenceRowSchema = z.object({
  id: z.uuid(),
  content_type: z.string(),
  size_bytes: num,
  description: z.string().nullable(),
  created_at: z.string(),
  uploaded_by_name: z.string().nullable(),
});
export type EvidenceRow = z.infer<typeof evidenceRowSchema>;
export const listIncidentEvidence = (ctx: AdminContext, incidentId: string) =>
  call(api(ctx).rpc("list_evidence", { p_incident_id: incidentId }), z.array(evidenceRowSchema));
