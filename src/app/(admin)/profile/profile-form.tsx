"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorKey } from "@/lib/action-errors";
import { updateOwnProfile } from "@/server/actions/profile";

export function ProfileForm({ fullName, preferredLanguage, version }: { fullName: string; preferredLanguage: string; version: number }) {
  const t = useTranslations();
  const router = useRouter();
  const [name, setName] = useState(fullName);
  const [language, setLanguage] = useState(preferredLanguage === "bn" ? "bn" : "en");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = name.trim() !== fullName || language !== preferredLanguage;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await updateOwnProfile({ fullName: name, preferredLanguage: language, expectedVersion: version });
          if (result.ok) {
            toast.success(t("profile.saved"));
            router.refresh();
          } else {
            setError(result.error.code === "STALE_VERSION" ? t("profile.staleVersion") : t(`errors.${errorKey(result.error.code)}`));
          }
        });
      }}
    >
      <FieldGroup>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <FieldLabel htmlFor="profile-name">{t("admins.fullName")}</FieldLabel>
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="profile-language">{t("profile.language")}</FieldLabel>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger id="profile-language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("profile.english")}</SelectItem>
              <SelectItem value="bn">{t("profile.bangla")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div>
          <Button type="submit" disabled={!dirty || pending}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
