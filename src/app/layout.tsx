import type { Metadata } from "next";
import { Hind_Siliguri, Inter } from "next/font/google";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const hindSiliguri = Hind_Siliguri({
  variable: "--font-bengali",
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Rider Admin", template: "%s · Rider Admin" },
  description: "Operations control room for the ride-sharing platform.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Reading the nonce makes every page render per request, which the CSP needs.
  const [nonce, locale] = await Promise.all([
    headers().then((h) => h.get("x-nonce") ?? undefined),
    getLocale(),
  ]);

  return (
    <html lang={locale} className={`${inter.variable} ${hindSiliguri.variable} h-full antialiased`} suppressHydrationWarning>
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before React loads; only this element's own
          attributes are exempt from the hydration check, its children are still checked. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <NextIntlClientProvider>
          <Providers nonce={nonce}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
