import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * The illustrated side of the sign-in screens: a still, hand-sketched city map with a trip from a pickup to a
 * drop-off. No motion, only the picture of what the console runs.
 */
export async function AuthScene() {
  const t = await getTranslations("auth");

  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-800 p-10 text-white">
      <div className="relative z-10 max-w-md space-y-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/20">
          <span className="inline-flex size-2 rounded-full bg-emerald-300" />
          {t("heroBadge")}
        </span>
        <h2 className="text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">{t("heroTitle")}</h2>
        <p className="text-sm text-emerald-100/80">{t("heroBody")}</p>
      </div>

      <div className="relative -mx-6 my-6 flex-1">
        <svg viewBox="0 0 520 360" className="h-full w-full" role="img" aria-label={t("heroAlt")}>
          <defs>
            {/* A little wobble makes clean vectors look hand-drawn. */}
            <filter id="sketch">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" />
              <feDisplacementMap in="SourceGraphic" scale="3" />
            </filter>
          </defs>

          <g filter="url(#sketch)" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="text-white/25">
            {/* Blocks */}
            <rect x="30" y="40" width="110" height="70" rx="10" strokeWidth="1.5" />
            <rect x="170" y="35" width="90" height="110" rx="10" strokeWidth="1.5" />
            <rect x="290" y="210" width="120" height="80" rx="10" strokeWidth="1.5" />
            <rect x="40" y="150" width="100" height="90" rx="10" strokeWidth="1.5" />
            <rect x="430" y="150" width="70" height="120" rx="10" strokeWidth="1.5" />
            {/* Park and river */}
            <circle cx="370" cy="60" r="28" strokeWidth="1.5" className="text-emerald-300/40" />
            <path d="M0 330 C 120 300, 200 350, 300 320 S 450 300, 520 330" strokeWidth="6" className="text-teal-300/30" />
            {/* Streets */}
            <path d="M0 130 H 520 M 0 255 H 520 M 155 0 V 360 M 280 0 V 360 M 420 0 V 360" strokeWidth="10" className="text-white/10" />
          </g>

          {/* The trip: route, pickup, drop-off and the car on its way */}
          <g filter="url(#sketch)">
            <path d="M70 285 C 130 285, 140 215, 200 205 S 290 225, 320 170 S 380 90, 450 85" fill="none" stroke="rgba(167,243,208,0.3)" strokeWidth="10" strokeLinecap="round" />
            <path d="M70 285 C 130 285, 140 215, 200 205 S 290 225, 320 170 S 380 90, 450 85" fill="none" stroke="#a7f3d0" strokeWidth="2.5" strokeDasharray="10 10" strokeLinecap="round" />
          </g>
          <circle cx="70" cy="285" r="16" fill="rgba(52,211,153,0.25)" />
          <circle cx="70" cy="285" r="7" fill="#34d399" stroke="white" strokeWidth="2.5" />
          <path d="M450 37 c-11 0-19 8-19 18 0 14 19 30 19 30 s19-16 19-30 c0-10-8-18-19-18z" fill="#fbbf24" stroke="white" strokeWidth="2.5" />
          <circle cx="450" cy="55" r="5" fill="white" />
          <g transform="translate(262 205) rotate(-20)">
            <rect x="-15" y="-9" width="30" height="18" rx="6" fill="white" />
            <rect x="-3" y="-7" width="10" height="14" rx="3" fill="#10b981" />
            <circle cx="-9" cy="-10" r="2.5" fill="#064e3b" />
            <circle cx="-9" cy="10" r="2.5" fill="#064e3b" />
            <circle cx="9" cy="-10" r="2.5" fill="#064e3b" />
            <circle cx="9" cy="10" r="2.5" fill="#064e3b" />
          </g>
        </svg>
      </div>

      <p className="relative z-10 flex items-center gap-2 text-xs text-emerald-100/70">
        <ShieldCheck className="size-4" />
        {t("heroFooter")}
      </p>
    </div>
  );
}
