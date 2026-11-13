"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const PasswordInput = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(function PasswordInput(
  { className, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
});

export function passwordScore(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  if (password.length >= 16 && score === 3) return 3;
  return Math.min(score, 2) as 0 | 1 | 2;
}

export function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations("auth");
  const score = passwordScore(password);
  const label = [t("strengthWeak"), t("strengthWeak"), t("strengthFair"), t("strengthStrong")][score];
  const color = ["bg-danger", "bg-danger", "bg-warning", "bg-success"][score];

  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className={cn("h-1.5 flex-1 rounded-full bg-muted", score >= i && color)} />
        ))}
      </div>
      {password ? <p className="text-xs text-muted-foreground">{label}</p> : null}
    </div>
  );
}
