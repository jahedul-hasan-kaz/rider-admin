import {
  Activity,
  BookOpen,
  Banknote,
  ChartNoAxesCombined,
  FileSpreadsheet,
  Settings,
  UserRoundX,
  Siren,
  CarFront,
  HandCoins,
  LifeBuoy,
  ReceiptText,
  ShieldAlert,
  Star,
  Ticket,
  FileCheck2,
  KeyRound,
  Layers,
  LayoutDashboard,
  Receipt,
  Route as RouteIcon,
  MapPinned,
  ScrollText,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import type { Permission } from "@/lib/permissions";

export type NavItem = {
  /** Message key under "nav". */
  key: string;
  href: Route;
  icon: LucideIcon;
  /** Hidden unless the admin holds this permission (UX only; pages re-check). */
  permission?: Permission;
  /** Two-key "g <key>" shortcut. */
  shortcut?: string;
  /** Key in the nav counts payload shown as a badge (pending work). */
  countKey?: "documents" | "applications";
};

export type NavGroup = { key: string; items: NavItem[] };

// Only routes that exist are listed; each milestone adds its own groups
// (Operations, Finance, Care, Insights — docs/spec/06-admin-ui.md §3).
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "groupOverview",
    items: [{ key: "dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view", shortcut: "d" }],
  },
  {
    key: "groupOperations",
    items: [
      { key: "live", href: "/live", icon: Activity, permission: "dispatch.view", shortcut: "l" },
      { key: "requests", href: "/requests", icon: RouteIcon, permission: "trips.view" },
      { key: "trips", href: "/trips", icon: CarFront, permission: "trips.view", shortcut: "t" },
      { key: "alerts", href: "/alerts", icon: Siren, permission: "dashboard.view" },
    ],
  },
  {
    key: "groupInsights",
    items: [
      { key: "analytics", href: "/analytics", icon: ChartNoAxesCombined, permission: "analytics.view", shortcut: "n" },
      { key: "exports", href: "/exports", icon: FileSpreadsheet, permission: "analytics.export" },
    ],
  },
  {
    key: "groupPeople",
    items: [
      { key: "passengers", href: "/passengers", icon: Users, permission: "passengers.view" },
      { key: "drivers", href: "/drivers", icon: UserRound, permission: "drivers.view", shortcut: "r", countKey: "applications" },
      { key: "documents", href: "/documents", icon: FileCheck2, permission: "documents.view", countKey: "documents" },
      { key: "vehicles", href: "/vehicles", icon: CarFront, permission: "vehicles.view" },
    ],
  },
  {
    key: "groupPricing",
    items: [
      { key: "fares", href: "/fares", icon: Receipt, permission: "fares.view" },
      { key: "zones", href: "/zones", icon: MapPinned, permission: "zones.view" },
      { key: "categories", href: "/categories", icon: Layers, permission: "categories.manage" },
    ],
  },
  {
    key: "groupFinance",
    items: [
      { key: "payments", href: "/payments", icon: Banknote, permission: "payments.view", shortcut: "m" },
      { key: "ledger", href: "/ledger", icon: BookOpen, permission: "ledger.view" },
      { key: "refunds", href: "/refunds", icon: ReceiptText, permission: "refunds.request" },
      { key: "payouts", href: "/payouts", icon: HandCoins, permission: "payouts.view" },
      { key: "promotions", href: "/promotions", icon: Ticket, permission: "promotions.view" },
    ],
  },
  {
    key: "groupCare",
    items: [
      { key: "support", href: "/support", icon: LifeBuoy, permission: "support.view", shortcut: "s" },
      { key: "ratings", href: "/ratings", icon: Star, permission: "support.view" },
      { key: "safety", href: "/safety", icon: ShieldAlert, permission: "safety.view", shortcut: "f" },
    ],
  },
  {
    key: "groupAdmin",
    items: [
      { key: "admins", href: "/admins", icon: ShieldCheck, permission: "admins.view", shortcut: "a" },
      { key: "templates", href: "/admins/templates", icon: KeyRound, permission: "admins.view" },
      { key: "audit", href: "/audit", icon: ScrollText, permission: "audit.view", shortcut: "u" },
      { key: "settings", href: "/settings", icon: Settings, permission: "settings.view" },
      { key: "privacy", href: "/privacy", icon: UserRoundX, permission: "passengers.update" },
    ],
  },
];

export const PROFILE_ITEM: NavItem = { key: "profile", href: "/profile", icon: UserRound, shortcut: "p" };

/** Label key for each path segment, for breadcrumbs. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "dashboard",
  admins: "admins",
  templates: "templates",
  audit: "audit",
  profile: "profile",
  passengers: "passengers",
  drivers: "drivers",
  documents: "documents",
  vehicles: "vehicles",
  zones: "zones",
  categories: "categories",
  live: "live",
  requests: "requests",
  trips: "trips",
  fares: "fares",
  payments: "payments",
  ledger: "ledger",
  accounts: "accounts",
  transactions: "transactions",
  refunds: "refunds",
  payouts: "payouts",
  promotions: "promotions",
  support: "support",
  ratings: "ratings",
  safety: "safety",
  alerts: "alerts",
  analytics: "analytics",
  exports: "exports",
  settings: "settings",
  privacy: "privacy",
  review: "review",
  new: "new",
};
