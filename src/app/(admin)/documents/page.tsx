import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { DOCUMENT_QUEUES, listDocumentQueue, type DocumentQueue } from "@/server/queries/supply";
import { DocumentQueueTable } from "./document-queue-table";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("documents.view"), searchParams, getTranslations("documents")]);
  const queue: DocumentQueue = DOCUMENT_QUEUES.find((q) => q === params.queue) ?? "pending";
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const data = await listDocumentQueue(ctx, { queue, cursor, sort: typeof params.sort === "string" ? params.sort : undefined });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={queue}
        tabs={[
          { key: "pending", label: t("queuePending"), href: "/documents", count: data.counts.pending },
          { key: "expiring", label: t("queueExpiring"), href: "/documents?queue=expiring", count: data.counts.expiring },
          { key: "expired", label: t("queueExpired"), href: "/documents?queue=expired", count: data.counts.expired },
          { key: "rejected", label: t("queueRejected"), href: "/documents?queue=rejected" },
        ]}
      />
      <DocumentQueueTable rows={data.rows} nextCursor={data.next_cursor ?? null} queue={queue} />
    </>
  );
}
