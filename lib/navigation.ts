import "server-only";

// Sidebar entries per panel. An entry shows only if the user holds its
// permission(s) and the clinic has its module. Hiding is cosmetic: every page
// and action enforces the same rule on the server.
import type { NavItem } from "@/components/app/app-shell";
import type { ModuleKey } from "@/lib/access/modules";
import type { Permission } from "@/lib/access/permissions";
import type { ClinicContext } from "@/features/auth/clinic-context.service";

type NavDef = NavItem & {
  /** All required. */
  permission?: Permission | Permission[];
  /** At least one required. */
  anyOf?: Permission[];
  module?: ModuleKey;
};

const CLINIC_NAV: NavDef[] = [
  { label: "Today", href: "/today", icon: "home", exact: true },
  { label: "Queue", href: "/queue", icon: "queue", permission: "queue:read" },
  { label: "Appointments", href: "/appointments", icon: "calendar", permission: "appointment:read" },
  { label: "Patients", href: "/patients", icon: "users", permission: "patient:read" },
  { label: "Lab", href: "/lab", icon: "lab", permission: "lab:result", module: "lab" },
  { label: "Billing", href: "/billing", icon: "billing", permission: "billing:read" },
  { label: "Pharmacy", href: "/pharmacy", icon: "pill", module: "pharmacy", anyOf: ["pharmacy:dispense", "pharmacy:sell"] },
  { label: "Stock", href: "/pharmacy/stock", icon: "package", module: "pharmacy", permission: "stock:manage" },
  { label: "Analytics", href: "/analytics", icon: "analytics", module: "analytics", permission: "analytics:read" },
  { label: "Broadcasts", href: "/broadcasts", icon: "message", module: "whatsapp", permission: "broadcast:send" },
  { label: "Purchases", href: "/pharmacy/purchases", icon: "truck", module: "pharmacy", anyOf: ["purchase:create", "purchase:approve", "stock:manage"] },

  { section: "Administration", label: "Clinic settings", href: "/settings/clinic", icon: "settings", permission: "settings:manage" },
  { section: "Administration", label: "Staff", href: "/settings/users", icon: "staff", permission: "staff:manage" },
  { section: "Administration", label: "Roles & permissions", href: "/settings/roles", icon: "shield", permission: "staff:manage" },
  { section: "Administration", label: "Services", href: "/settings/services", icon: "clipboard", permission: "settings:manage" },
  { section: "Administration", label: "Schedules", href: "/settings/schedules", icon: "calendar", permission: "settings:manage" },
  { section: "Administration", label: "Messaging", href: "/settings/messaging", icon: "message", permission: "settings:manage", module: "whatsapp" },
  { section: "Administration", label: "Import patients", href: "/settings/import", icon: "upload", permission: "import:run" },
  { section: "Administration", label: "Reports", href: "/reports", icon: "analytics", permission: "reports:read", module: "reports" },
  { section: "Administration", label: "Audit trail", href: "/audit", icon: "shield", permission: "audit:read" },
  { section: "Administration", label: "Medicines & catalogues", href: "/settings/catalog", icon: "pill", anyOf: ["medicine:manage", "catalog:manage"] },

  { section: "Account", label: "My account", href: "/account", icon: "key" },
];

export function clinicNav(ctx: ClinicContext): NavItem[] {
  return CLINIC_NAV.filter((item) => {
    if (item.module && !ctx.modules.has(item.module)) return false;
    const required = item.permission === undefined ? [] : Array.isArray(item.permission) ? item.permission : [item.permission];
    if (!required.every((p) => ctx.permissions.has(p))) return false;
    if (item.anyOf && !item.anyOf.some((p) => ctx.permissions.has(p))) return false;
    return true;
  }).map(({ label, href, icon, section, exact }) => ({ label, href, icon, section, exact }));
}

/** The compliance panel (/audit): its own layout and accent. */
export function complianceNav(ctx: ClinicContext): NavItem[] {
  const items: NavItem[] = [
    { label: "Audit trail", href: "/audit", icon: "shield", exact: true },
    { label: "Record access", href: "/audit/access", icon: "users" },
    { label: "Summary", href: "/audit/summary", icon: "analytics" },
    { section: "Account", label: "My account", href: "/account", icon: "key" },
  ];
  // People who also work in the clinic get a way back to it.
  if ([...ctx.permissions].some((p) => p !== "audit:read")) {
    items.push({ section: "Account", label: "Clinic panel", href: "/today", icon: "home" });
  }
  return items;
}

export const PLATFORM_NAV: NavItem[] = [
  { label: "Estate", href: "/platform", icon: "gauge", exact: true },
  { label: "Clinics", href: "/platform/tenants", icon: "building" },
  { label: "Plans", href: "/platform/plans", icon: "layers" },
  { label: "Operators", href: "/platform/operators", icon: "staff" },
  { label: "My password", href: "/platform/account/password", icon: "key", section: "Account" },
];
