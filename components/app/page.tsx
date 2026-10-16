// Page layout primitives shared by every panel. Colours come from the
// nearest data-accent ancestor (see globals.css), so these never hard-code
// a panel's palette.
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const WIDTHS = {
  narrow: "max-w-3xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
} as const;

export function PageShell({
  children,
  width = "wide",
  className,
}: {
  children: React.ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
}) {
  return (
    <div className={cn("accent-page min-h-full p-6 lg:p-10", className)}>
      <div className={cn("mx-auto space-y-8", WIDTHS[width])}>{children}</div>
    </div>
  );
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  eyebrow,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
      <div className="flex items-start gap-5">
        <div className="accent-gradient flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl shadow-lg">
          <Icon className="h-7 w-7 text-white" aria-hidden />
        </div>
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-(--accent-text)">{eyebrow}</div>
          )}
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">{title}</h1>
          {description && (
            <p className="mt-2 max-w-2xl text-base text-zinc-600 sm:text-lg dark:text-zinc-400">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

/** The main white card surface. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  /** No body padding: for tables and lists that run edge to edge. */
  flush?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/95 shadow-xl shadow-zinc-200/40 backdrop-blur-xl",
        "dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-none",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-col gap-3 border-b border-zinc-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-8 dark:border-zinc-800">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{title}</h2>}
            {description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
          {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(flush ? "py-2" : "p-6 lg:p-8", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white/70 p-6 shadow-sm backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</p>
          {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--accent-soft-border) bg-(--accent-soft)">
          <Icon className="h-5 w-5 text-(--accent-text)" aria-hidden />
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-6 py-14 text-center dark:border-zinc-800">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
        <Icon className="h-6 w-6 text-zinc-400" aria-hidden />
      </div>
      <p className="text-lg font-medium text-zinc-800 dark:text-zinc-200">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Two-column label/value list used on detail pages. */
export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wider text-zinc-500">{item.label}</dt>
          <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
