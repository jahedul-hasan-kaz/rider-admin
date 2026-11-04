import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["en", "bn"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function toLocale(value: string | undefined): Locale {
  return value === "bn" ? "bn" : "en";
}

// No locale in the URL: the admin's choice is kept in a cookie (docs/spec/06-admin-ui.md §4.6).
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    locale,
    timeZone: "Asia/Dhaka",
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
