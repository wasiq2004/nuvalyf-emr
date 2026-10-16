"use client";

// The frame shared by all three panels: sidebar (collapsible on desktop, a
// drawer on mobile) and a top bar. Panels differ only by `accent`.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, LogOut, Menu } from "lucide-react";
import { BrandMark } from "./brand";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { ICONS, type IconName } from "./icons";

export type Accent = "clinic" | "compliance" | "platform";

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  section?: string;
  /** Match only the exact path (for section home links). */
  exact?: boolean;
};

type Props = {
  accent: Accent;
  panelLabel: string;
  title: string;
  nav: NavItem[];
  user: { name: string; subtitle?: string };
  signOut: () => Promise<void>;
  headerSlot?: React.ReactNode;
  children: React.ReactNode;
};

function matches(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The most specific matching entry, so /pharmacy/stock lights "Stock", not "Pharmacy" too. */
function activeHref(pathname: string, nav: NavItem[]) {
  return nav.filter((item) => matches(pathname, item)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

function groupBySection(nav: NavItem[]) {
  const groups: { section?: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

function NavLinks({
  nav,
  pathname,
  collapsed = false,
  onNavigate,
}: {
  nav: NavItem[];
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const current = activeHref(pathname, nav);
  return (
    <div className="space-y-5">
      {groupBySection(nav).map((group, index) => (
        <div key={group.section ?? `group-${index}`} className="space-y-1">
          {group.section && !collapsed && (
            <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">{group.section}</p>
          )}
          {group.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = item.href === current;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-(--accent-soft) text-(--accent-text) ring-1 ring-(--accent-soft-border)"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white",
                )}
              >
                <Icon className="h-[18px] w-[18px] flex-shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Brand({ panelLabel, title, collapsed = false }: { panelLabel: string; title: string; collapsed?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BrandMark />
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-white">{title}</p>
          <p className="truncate text-xs font-medium text-zinc-500 dark:text-zinc-400">{panelLabel}</p>
        </div>
      )}
    </div>
  );
}

function SignOutButton({ signOut, collapsed = false }: { signOut: () => Promise<void>; collapsed?: boolean }) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40",
          collapsed && "justify-center px-0",
        )}
        title={collapsed ? "Sign out" : undefined}
      >
        <LogOut className="h-[18px] w-[18px]" aria-hidden />
        {!collapsed && "Sign out"}
      </button>
    </form>
  );
}

export function AppShell({ accent, panelLabel, title, nav, user, signOut, headerSlot, children }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div data-accent={accent} className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden flex-shrink-0 flex-col border-r border-zinc-200 bg-white/95 transition-[width] duration-200 md:flex dark:border-zinc-800 dark:bg-zinc-950/95",
          collapsed ? "w-20" : "w-68",
        )}
      >
        <div className={cn("flex items-center gap-2 border-b border-zinc-100 px-5 py-5 dark:border-zinc-800", collapsed && "justify-center px-0")}>
          <Brand panelLabel={panelLabel} title={title} collapsed={collapsed} />
        </div>
        <nav className="flex-1 overflow-y-auto p-3" aria-label="Main">
          <NavLinks nav={nav} pathname={pathname} collapsed={collapsed} />
        </nav>
        <div className="space-y-1 border-t border-zinc-100 p-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900",
              collapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-[18px] w-[18px]" /> : <ChevronLeft className="h-[18px] w-[18px]" />}
            {!collapsed && "Collapse"}
          </button>
          <SignOutButton signOut={signOut} collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur-xl md:px-6 dark:border-zinc-800 dark:bg-zinc-950/90">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-900"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0" data-accent={accent}>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">Main navigation</SheetDescription>
              <div className="border-b border-zinc-100 px-5 py-5 dark:border-zinc-800">
                <Brand panelLabel={panelLabel} title={title} />
              </div>
              <nav className="p-3" aria-label="Main">
                <NavLinks nav={nav} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
              </nav>
              <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
                <SignOutButton signOut={signOut} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">{headerSlot}</div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="hidden text-right sm:block">
              <p className="max-w-48 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{user.name}</p>
              {user.subtitle && <p className="max-w-48 truncate text-xs text-zinc-500">{user.subtitle}</p>}
            </div>
            <div className="accent-gradient flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white">
              {user.name.trim().charAt(0).toUpperCase() || "?"}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
