import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getTicket } from "@/server/queries/care";
import { TicketActions, TicketBadges, TicketThread } from "./ticket-client";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketPage({ params }: PageProps<"/support/[id]">) {
  const [{ id }, ctx] = await Promise.all([params, requirePagePermission("support.view")]);
  if (!z.uuid().safeParse(id).success) notFound();

  let ticket;
  try {
    ticket = await getTicket(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={`#${ticket.ticket_no} ${ticket.subject}`}
        badge={<TicketBadges ticket={ticket} />}
        actions={<TicketActions ticket={ticket} me={ctx.userId} />}
      />
      <TicketThread ticket={ticket} />
    </>
  );
}
