"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { signOut } from "@/server/actions/auth";

const IDLE_MS = 30 * 60 * 1000;
const WARNING_MS = 60 * 1000;
const STORAGE_KEY = "ra:last-activity";
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

function readShared(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * 30-minute idle sign-out with a 60-second warning (docs/spec/06-admin-ui.md §3).
 * Activity is shared across tabs. The proxy enforces the same limit server-side.
 */
export function IdleTimeout() {
  const t = useTranslations("idle");
  const router = useRouter();
  const lastActivity = useRef(0); // set on mount by markActive()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const signingOut = useRef(false);

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, String(lastActivity.current));
    } catch {
      // Storage may be unavailable; this tab still tracks its own activity.
    }
  }, []);

  const doSignOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    const result = await signOut("idle");
    router.replace((result.ok ? result.data.redirectTo : "/login?reason=idle") as Route);
    router.refresh();
  }, [router]);

  useEffect(() => {
    markActive();
    const onActivity = () => {
      if (secondsLeft === null) markActive();
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true });

    const timer = setInterval(() => {
      const last = Math.max(lastActivity.current, readShared());
      const remaining = IDLE_MS - (Date.now() - last);
      if (remaining <= 0) void doSignOut();
      else if (remaining <= WARNING_MS) setSecondsLeft(Math.ceil(remaining / 1000));
      else setSecondsLeft(null);
    }, 1000);

    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity);
      clearInterval(timer);
    };
  }, [doSignOut, markActive, secondsLeft]);

  return (
    <AlertDialog open={secondsLeft !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription aria-live="assertive">{t("body", { seconds: secondsLeft ?? 0 })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => void doSignOut()}>{t("signOut")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              markActive();
              setSecondsLeft(null);
              router.refresh(); // touches the server so the proxy's idle cookie is renewed
            }}
          >
            {t("stay")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
