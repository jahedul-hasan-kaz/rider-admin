"use client";

import { ExternalLink, FileX2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorKey } from "@/lib/action-errors";
import { openDocument } from "@/server/actions/supply";

type Loaded = { url: string; contentType: string; documentId: string };

/**
 * Shows a driver document from a 60-second signed URL. Every open is logged in
 * SQL (pii_access_logs). Images support zoom and rotation; PDFs are embedded.
 */
export function DocumentViewer({ documentId, className }: { documentId: string | null; className?: string }) {
  const t = useTranslations();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    openDocument({ documentId }).then((result) => {
      if (cancelled) return;
      if (result.ok) setLoaded({ url: result.data.url, contentType: result.data.contentType, documentId });
      else setError(t(`errors.${errorKey(result.error.code)}`));
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, t]);

  // Reset view state when switching documents (during render, no effect).
  const [viewFor, setViewFor] = useState(documentId);
  if (viewFor !== documentId) {
    setViewFor(documentId);
    setLoaded(null);
    setError(null);
    setZoom(1);
    setRotation(0);
  }

  const current = loaded && loaded.documentId === documentId ? loaded : null;

  return (
    <div className={className} aria-label={t("documents.viewer")}>
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1.5">
        {current && current.contentType !== "application/pdf" ? (
          <>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setZoom((z) => Math.min(z + 0.25, 3))} aria-label={t("documents.zoomIn")}>
              <ZoomIn className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))} aria-label={t("documents.zoomOut")}>
              <ZoomOut className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label={t("documents.rotate")}>
              <RotateCw className="size-4" />
            </Button>
            <span className="ml-1 text-xs text-muted-foreground tabular">{Math.round(zoom * 100)}%</span>
          </>
        ) : null}
        {current ? (
          <Button asChild variant="ghost" size="sm" className="ml-auto h-8">
            <a href={current.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              {t("documents.openNewTab")}
            </a>
          </Button>
        ) : null}
      </div>
      <div className="relative flex min-h-[420px] flex-1 items-center justify-center overflow-auto bg-muted/20 p-4">
        {!documentId ? (
          <p className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <FileX2 className="size-8" aria-hidden />
            {t("documents.noFile")}
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !current ? (
          <Skeleton className="h-[380px] w-full max-w-md" aria-label={t("documents.loading")} />
        ) : current.contentType === "application/pdf" ? (
          <iframe src={current.url} title={t("documents.viewer")} className="h-[70vh] w-full rounded border bg-white" />
        ) : (
          // Signed, short-lived storage URL; next/image optimisation would cache PII.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={t("documents.viewer")}
            className="max-w-full rounded shadow-sm transition-transform"
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: "center" }}
          />
        )}
      </div>
    </div>
  );
}
