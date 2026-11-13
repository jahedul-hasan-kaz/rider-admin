"use client";

import { useTranslations } from "next-intl";

/** Translates any status enum value via the shared "status" namespace. */
export function useStatusLabel() {
  const t = useTranslations("status");
  return (status: string) => (t.has(status) ? t(status) : status.replaceAll("_", " "));
}

/** Translates a document type via the "documentTypes" namespace. */
export function useDocumentTypeLabel() {
  const t = useTranslations("documentTypes");
  return (type: string) => (t.has(type) ? t(type) : type.replaceAll("_", " "));
}
