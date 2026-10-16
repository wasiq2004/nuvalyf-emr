// Link-based tabs for pages with several sections (state lives in the URL,
// so every tab can be linked to and survives a refresh).
import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = { key: string; label: string; href: string; badge?: React.ReactNode };

export function TabNav({ tabs, active, label }: { tabs: TabItem[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 rounded-2xl border border-zinc-200/70 bg-white/80 p-1 shadow-sm backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/70">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                  current
                    ? "accent-gradient-x text-white shadow-md shadow-(--accent-shadow)"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white",
                )}
              >
                {tab.label}
                {tab.badge}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
