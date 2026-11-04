import type { Metadata } from "next";
import { early } from "@/server/queries/rpc";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getIncident, listIncidentEvidence } from "@/server/queries/care";
import { IncidentActions, IncidentBadges, IncidentBody } from "./incident-client";

export const metadata: Metadata = { title: "Safety incident" };

export default async function IncidentPage({ params }: PageProps<"/safety/[id]">) {
  const [{ id }, ctx] = await Promise.all([params, requirePagePermission("safety.view")]);
  if (!z.uuid().safeParse(id).success) notFound();

  const evidenceP = early(listIncidentEvidence(ctx, id));
  let incident;
  try {
    incident = await getIncident(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const evidence = await evidenceP;

  return (
    <>
      <PageHeader title={`#${incident.incident_no}`} badge={<IncidentBadges incident={incident} />} actions={<IncidentActions incident={incident} />} />
      <IncidentBody incident={incident} evidence={evidence} />
    </>
  );
}
